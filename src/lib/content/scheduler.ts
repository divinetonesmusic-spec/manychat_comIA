import { createAutomation, getConfig, updateContentPostMediaItems, updateContentPostStatus, type Config, type ContentMediaItem, type ContentPost } from "@/lib/db/repositories";
import {
  claimDueContentPosts,
  claimPostNow,
  getContentPost,
  listPostsForMediaCleanup,
  listPostsMissingAfterPublish,
  listPostsNeedingInsights,
  listPublishingPosts,
  markMediaDeleted,
  recoverStuckPosts,
  saveInsights,
  setPostAutomation,
  setPostFirstComment,
  touchContentPost,
  tryLockPost,
  unlockPost,
} from "@/lib/db/content-planner";
import {
  createInstagramCarouselContainer,
  createInstagramCarouselItemContainer,
  createInstagramMediaComment,
  createInstagramMediaContainer,
  getInstagramMediaContainerStatus,
  getInstagramMediaInsights,
  getPublishedInstagramMedia,
  publishInstagramMediaContainer,
  type InstagramPublishType,
} from "@/lib/instagram/client";
import { deleteR2Object, keyFromPublicUrl } from "@/lib/content/r2";

/**
 * Relógio do planner: roda junto com o /api/queue/drain (a cada minuto).
 * Cada passo é curto e respeita um limite de tempo, para caber em funções serverless (Netlify/Render/etc).
 */
export type ContentCycleResult = {
  started: number;
  published: number;
  failed: number;
  waiting: number;
  comments: number;
  automations: number;
  insights: number;
  cleaned: number;
  stoppedEarly: boolean;
};

const MAX_PUBLISHING_HOURS = 2;

/**
 * Publica um post agora: cria o container e, se a Meta for rápida (imagem), já publica.
 * Vídeo/carrossel continuam no relógio de 1 em 1 minuto. Nunca passa de ~6 s.
 */
export async function publishPostNow(id: string, budgetMs = 6000) {
  const deadline = Date.now() + budgetMs;
  const post = await claimPostNow(id);
  if (!post) return null;
  const config = await getConfig(post.account_id);
  try {
    await startPost(post, config);
  } catch (error) {
    await updateContentPostStatus({ id: post.id, status: "failed", lastError: translateError(error) });
    return getContentPost(post.id);
  }
  while (deadline - Date.now() > 2500) {
    const current = await getContentPost(post.id);
    if (!current || current.status !== "publishing") return current;
    const result = await advancePost(current, config).catch(async (error) => {
      await touchContentPost(post.id, translateError(error));
      return "waiting" as const;
    });
    if (result !== "waiting") break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return getContentPost(post.id);
}

export async function runContentCycle(
  budgetMs = Number(process.env.CYCLE_BUDGET_MS || 8000),
  options: { light?: boolean } = {},
): Promise<ContentCycleResult> {
  const deadline = Date.now() + budgetMs;
  const timeLeft = () => deadline - Date.now();
  const out: ContentCycleResult = { started: 0, published: 0, failed: 0, waiting: 0, comments: 0, automations: 0, insights: 0, cleaned: 0, stoppedEarly: false };
  const configs = new Map<string, Config>();
  const configFor = async (accountId: string | null) => {
    const key = accountId ?? "default";
    if (!configs.has(key)) configs.set(key, await getConfig(accountId));
    return configs.get(key) as Config;
  };

  await recoverStuckPosts();

  // 1) Posts que chegaram na hora: cria o container na Meta.
  if (timeLeft() > 2500) {
    for (const post of await claimDueContentPosts(3)) {
      if (timeLeft() < 1500) { out.stoppedEarly = true; break; }
      try {
        const config = await configFor(post.account_id);
        await startPost(post, config, deadline);
        out.started += 1;
      } catch (error) {
        out.failed += 1;
        await updateContentPostStatus({ id: post.id, status: "failed", lastError: translateError(error) });
      }
    }
  }

  // 2) Posts em processamento: confere e publica quando a Meta terminar.
  if (timeLeft() > 2000) {
    for (const post of await listPublishingPosts(8)) {
      if (timeLeft() < 1500) { out.stoppedEarly = true; break; }
      try {
        const config = await configFor(post.account_id);
        const result = await advancePost(post, config, deadline);
        if (result === "published") out.published += 1;
        else if (result === "failed") out.failed += 1;
        else out.waiting += 1;
      } catch (error) {
        await touchContentPost(post.id, translateError(error));
        out.waiting += 1;
      }
    }
  }

  // 3) 1º comentário e automação que ficaram para trás (se a Meta falhou na hora).
  if (timeLeft() > 2000) {
    for (const post of await listPostsMissingAfterPublish(5)) {
      if (timeLeft() < 1500) { out.stoppedEarly = true; break; }
      const config = await configFor(post.account_id);
      const done = await afterPublish(post, config, post.published_media_id as string).catch(() => ({ comment: false, automation: false }));
      out.comments += done.comment ? 1 : 0;
      out.automations += done.automation ? 1 : 0;
    }
  }

  // 4) Resultados (views, alcance, comentários...).
  if (!options.light && timeLeft() > 2500) {
    for (const post of await listPostsNeedingInsights(4)) {
      if (timeLeft() < 2000) { out.stoppedEarly = true; break; }
      try {
        const config = await configFor(post.account_id);
        const insights = await getInstagramMediaInsights({
          mediaId: post.published_media_id as string,
          accessToken: config.instagram_access_token ?? "",
          isReel: post.publish_type === "reel_video" || post.publish_type === "feed_video",
        });
        await saveInsights(post.id, insights);
        out.insights += 1;
      } catch {
        await saveInsights(post.id, post.insights ?? {});
      }
    }
  }

  // 5) Limpa a mídia do R2 depois de publicada (o original continua no Mac).
  if (!options.light && timeLeft() > 1500) {
    for (const post of await listPostsForMediaCleanup(10)) {
      if (timeLeft() < 1000) { out.stoppedEarly = true; break; }
      const keys = new Set<string>(post.media_keys ?? []);
      for (const url of [post.media_url, post.cover_url, ...(post.media_items ?? []).flatMap((item) => [item.url, item.cover_url])]) {
        const key = url ? keyFromPublicUrl(url) : null;
        if (key) keys.add(key);
      }
      let ok = true;
      for (const key of keys) ok = (await deleteR2Object(key).catch(() => false)) && ok;
      if (ok) {
        await markMediaDeleted(post.id);
        out.cleaned += 1;
      }
    }
  }

  return out;
}

export async function startPost(post: ContentPost, config: Config, deadline = Date.now() + 8000) {
  assertConnected(config);
  if (post.publish_type === "carousel") {
    const items = (post.media_items ?? []).map((item) => ({ ...item, status: item.status ?? "pending" })) as ContentMediaItem[];
    if (items.length < 2) throw new Error("Carrossel precisa de pelo menos 2 itens.");
    let made = 0;
    for (let index = 0; index < items.length; index += 1) {
      if (items[index].container_id) continue;
      if (made > 0 && deadline - Date.now() < 1500) break; // o resto fica para o próximo minuto
      const child = await createInstagramCarouselItemContainer({
        instagramUserId: config.instagram_user_id as string,
        accessToken: config.instagram_access_token as string,
        item: { type: items[index].type, url: items[index].url, coverUrl: items[index].cover_url ?? null },
      });
      items[index] = { ...items[index], container_id: child.id, status: "processing", error: null };
      made += 1;
      await updateContentPostMediaItems(post.id, items); // salva na hora: se a função cair, nada é recriado
    }
    await touchContentPost(post.id, "A Meta esta preparando os itens do carrossel.");
    return;
  }

  const container = await createInstagramMediaContainer({
    instagramUserId: config.instagram_user_id as string,
    accessToken: config.instagram_access_token as string,
    publishType: toInstagramPublishType(post.publish_type),
    mediaUrl: post.media_url,
    coverUrl: post.cover_url,
    caption: post.caption,
  });
  await updateContentPostStatus({ id: post.id, status: "publishing", containerId: container.id, lastError: "A Meta esta processando a midia." });
}

/** Avança um post em "publicando". Retorna o que aconteceu. */
export async function advancePost(post: ContentPost, config: Config, deadline = Date.now() + 8000): Promise<"published" | "failed" | "waiting"> {
  assertConnected(config);
  if (!(await tryLockPost(post.id, 90))) return "waiting"; // outro relógio já está cuidando deste post
  try {
    return await advanceLocked(post, config, deadline);
  } finally {
    await unlockPost(post.id).catch(() => undefined);
  }
}

async function advanceLocked(post: ContentPost, config: Config, deadline: number): Promise<"published" | "failed" | "waiting"> {
  const startedAt = new Date(post.publishing_started_at ?? post.scheduled_at ?? post.created_at).getTime();
  const tooOld = Date.now() - startedAt > MAX_PUBLISHING_HOURS * 3600_000;
  if (tooOld) return failTooOld(post);

  if (post.publish_type === "carousel") {
    const items = (post.media_items ?? []) as ContentMediaItem[];
    if (!items.length || items.some((item) => !item.container_id)) {
      await startPost(post, config, deadline);
      return "waiting";
    }
    if (!post.container_id) {
      for (let index = 0; index < items.length; index += 1) {
        if (items[index].status === "finished") continue;
        const status = await getInstagramMediaContainerStatus(items[index].container_id as string, config.instagram_access_token as string);
        if (status.status_code === "FINISHED") items[index] = { ...items[index], status: "finished", error: null };
        else if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
          await updateContentPostMediaItems(post.id, items);
          await updateContentPostStatus({ id: post.id, status: "failed", lastError: `Item ${index + 1}: ${status.status || status.status_code}` });
          return "failed";
        }
      }
      await updateContentPostMediaItems(post.id, items);
      if (items.some((item) => item.status !== "finished")) {
        if (tooOld) return failTooOld(post);
        await touchContentPost(post.id, "A Meta ainda esta processando os itens do carrossel.");
        return "waiting";
      }
      const parent = await createInstagramCarouselContainer({
        instagramUserId: config.instagram_user_id as string,
        accessToken: config.instagram_access_token as string,
        children: items.map((item) => item.container_id as string),
        caption: post.caption,
      });
      await updateContentPostStatus({ id: post.id, status: "publishing", containerId: parent.id, lastError: "Montando o carrossel na Meta." });
      return "waiting";
    }
  } else if (!post.container_id) {
    await startPost(post, config, deadline);
    return "waiting";
  }

  const status = await getInstagramMediaContainerStatus(post.container_id as string, config.instagram_access_token as string);
  if (status.status_code === "FINISHED") {
    const published = await publishInstagramMediaContainer({
      instagramUserId: config.instagram_user_id as string,
      accessToken: config.instagram_access_token as string,
      containerId: post.container_id as string,
    });
    const media = await getPublishedInstagramMedia(published.id, config.instagram_access_token as string).catch(() => null);
    const updated = await updateContentPostStatus({
      id: post.id,
      status: "published",
      containerId: post.container_id,
      publishedMediaId: published.id,
      permalink: media?.permalink ?? null,
      lastError: null,
      publishedAt: new Date(),
    });
    // já estamos com a trava do post: faz o 1º comentário e liga a automação na hora
    await afterPublishLocked((await getContentPost(post.id)) ?? updated ?? post, config, published.id, { comment: false, automation: false }).catch(() => undefined);
    return "published";
  }
  if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
    await updateContentPostStatus({ id: post.id, status: "failed", containerId: post.container_id, lastError: translateError(new Error(status.status || `Container ${status.status_code}`)) });
    return "failed";
  }
  if (tooOld) return failTooOld(post);
  await touchContentPost(post.id, "A Meta esta processando a midia.");
  return "waiting";
}

async function failTooOld(post: ContentPost) {
  await updateContentPostStatus({ id: post.id, status: "failed", containerId: post.container_id, lastError: `A Meta nao terminou de processar em ${MAX_PUBLISHING_HOURS} h. Tente agendar de novo.` });
  return "failed" as const;
}

/** Depois de publicar: 1º comentário e a automação "comentou a palavra → recebe a DM com o link". */
export async function afterPublish(post: ContentPost, config: Config, mediaId: string) {
  const done = { comment: false, automation: false };
  if (!(await tryLockPost(post.id, 60))) return done;
  try {
    const fresh = (await getContentPost(post.id)) ?? post;
    return await afterPublishLocked(fresh, config, mediaId, done);
  } finally {
    await unlockPost(post.id).catch(() => undefined);
  }
}

async function afterPublishLocked(post: ContentPost, config: Config, mediaId: string, done: { comment: boolean; automation: boolean }) {
  if (post.first_comment && !post.first_comment_id) {
    try {
      const comment = await createInstagramMediaComment({ mediaId, accessToken: config.instagram_access_token as string, message: post.first_comment });
      await setPostFirstComment(post.id, comment.id);
      done.comment = true;
    } catch (error) {
      await touchContentPost(post.id, `Publicado, mas o 1o comentario falhou: ${translateError(error)}`);
    }
  }

  if (post.keyword && (post.dm_text || post.link_url) && !post.automation_id) {
    try {
      const options = post.automation_options ?? {};
      const publicReplies = [post.public_reply, ...(options.publicReplies ?? [])].map((text) => (text || "").trim()).filter(Boolean);
      const automation = await createAutomation({
        account_id: post.account_id,
        name: `Post · ${post.title || post.keyword}`.slice(0, 80),
        active: true,
        triggers: ["comments"],
        keywords: post.keyword.split(/[,\n]/).map((word) => word.trim()).filter(Boolean),
        match_type: "contains",
        post_id: mediaId,
        public_replies: Array.from(new Set(publicReplies)).slice(0, 8),
        welcome_dm: post.dm_text || "Oi! Toque no botao abaixo para receber.",
        quick_reply_label: (options.quickReplyLabel || "").slice(0, 20) || undefined,
        link_text: options.linkText || undefined,
        link_url: post.link_url || "",
        link_button_label: (post.link_label || "").slice(0, 20) || undefined,
        reminder_text: options.reminderText || undefined,
        require_follower: options.requireFollower ?? false,
      });
      if (automation?.id) {
        await setPostAutomation(post.id, automation.id);
        done.automation = true;
      }
    } catch (error) {
      await touchContentPost(post.id, `Publicado, mas a automacao da DM falhou: ${translateError(error)}`);
    }
  }
  return done;
}

function assertConnected(config: Config) {
  if (!config.instagram_user_id || !config.instagram_access_token) throw new Error("Instagram nao conectado para este perfil.");
}

function toInstagramPublishType(value: ContentPost["publish_type"]): InstagramPublishType {
  if (value === "reel_video" || value === "feed_video") return "reel_video"; // vídeo no feed = Reel (a Meta não aceita mais VIDEO)
  if (value === "story_image") return "story_image";
  if (value === "story_video") return "story_video";
  return "feed_image";
}

export function translateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Erro desconhecido.");
  if (/content_publish|permission/i.test(message)) return "Falta a permissao de publicar. Reconecte o perfil aceitando instagram_business_content_publish.";
  if (/Media ID is not available|not ready/i.test(message)) return "A midia ainda nao terminou de processar na Meta.";
  if (/aspect ratio|resolution|duration|codec/i.test(message)) return "A Meta recusou o video (formato, duracao ou resolucao). Reels: MP4 H.264, 9:16, de 3 s a 15 min.";
  if (/Invalid parameter|url|download/i.test(message)) return "A Meta nao conseguiu baixar a midia. Confira se o link e publico.";
  return message.replace(/^Instagram Graph v\d+\.\d+:\s*/i, "Meta: ").slice(0, 400);
}
