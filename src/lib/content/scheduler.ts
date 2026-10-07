import { createAutomation, getConfig, updateContentPostMediaItems, updateContentPostStatus, type Config, type ContentMediaItem, type ContentPost } from "@/lib/db/repositories";
import {
  claimDueContentPosts,
  claimPostNow,
  failContentPost,
  getContentPost,
  listClaimedMediaIds,
  listPostsForMediaCleanup,
  listPostsMissingAfterPublish,
  listPostsNeedingInsights,
  listPublishingPosts,
  markMediaDeleted,
  markPublishRequested,
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
  listRecentInstagramMedia,
  publishInstagramMediaContainer,
  type InstagramPublishType,
} from "@/lib/instagram/client";
import { deleteR2Object, keyFromPublicUrl } from "@/lib/content/r2";
import { findMatchingMedia, parseMetaTimestamp, type FeedMedia } from "@/lib/content/publish-check";
import { notifyPostFailed, TELEGRAM_TIMEOUT_MS } from "@/lib/notify";

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

/** Texto mostrado depois do "Publicar agora" (tela Conteúdo e Molde). */
export const PUBLISH_NOW_NOTICE = "Vai ao ar em até 2 minutos.";

/** Nota gravada quando a Meta confirma que publicou, mas o post não aparece no feed. */
export const PUBLISHED_WITHOUT_LINK_NOTE = "Publicado; não consegui buscar o link";

/**
 * Depois de um pedido de publicação (media_publish), quanto tempo esperar antes de pedir de novo ou de desistir
 * de achar o post no feed. Um pedido cortado no meio solta a trava na hora e, com a tela Conteúdo aberta, o ciclo
 * leve roda a cada 20 s: nesse intervalo a Meta pode ter recebido o pedido e ainda não mostrar o post.
 */
export const PUBLISH_RECHECK_MS = 3 * 60_000;

/**
 * "Publicar agora": marca o post para sair já e, se couber no tempo, cria o container na Meta (passo rápido).
 * NUNCA chama o media_publish aqui: quem publica é o relógio (/api/queue/drain, a cada ~2 min).
 * Assim a resposta volta rápido e um corte do Netlify (10 s) não deixa o post sair em dobro.
 */
export async function publishPostNow(id: string, budgetMs = 4000) {
  const deadline = Date.now() + budgetMs;
  const post = await claimPostNow(id);
  if (!post) return null;
  const pending: PendingNotice[] = [];
  try {
    const config = await getConfig(post.account_id);
    await startPost(post, config, deadline);
  } catch (error) {
    await markPostFailed(post, translateError(error), { pending });
  } finally {
    await unlockPost(post.id).catch(() => undefined);
  }
  await sendPendingNotices(pending, null, deadline);
  return getContentPost(post.id);
}

export async function runContentCycle(
  budgetMs = Number(process.env.CYCLE_BUDGET_MS || 8000),
  /** origin: endereço do pedido, para o link do aviso quando APP_BASE_URL não estiver definida. */
  options: { light?: boolean; origin?: string | null } = {},
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

  // Avisos de "Com erro" do ciclo: juntados aqui e mandados juntos no fim, dentro do tempo que sobrar
  // (um Telegram lento não pode segurar os outros posts, nem passar do limite da função).
  const pending: PendingNotice[] = [];
  try {
    return await runCycleSteps(out, configFor, timeLeft, deadline, pending, options);
  } finally {
    await sendPendingNotices(pending, options.origin, deadline);
  }
}

async function runCycleSteps(
  out: ContentCycleResult,
  configFor: (accountId: string | null) => Promise<Config>,
  timeLeft: () => number,
  deadline: number,
  pending: PendingNotice[],
  options: { light?: boolean },
): Promise<ContentCycleResult> {
  // Presos em "publicando" depois de 3 tentativas viram "Com erro": 1 aviso para cada um.
  for (const post of await recoverStuckPosts()) pending.push({ post, motivo: post.last_error ?? "" });

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
        await markPostFailed(post, translateError(error), { pending });
      }
    }
  }

  // 2) Posts em processamento: confere e publica quando a Meta terminar.
  if (timeLeft() > 2000) {
    for (const post of await listPublishingPosts(8)) {
      if (timeLeft() < 1500) { out.stoppedEarly = true; break; }
      try {
        const config = await configFor(post.account_id);
        const result = await advancePost(post, config, deadline, pending);
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
    await touchContentPost(post.id, "A Meta está preparando os itens do carrossel.");
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
  await updateContentPostStatus({ id: post.id, status: "publishing", containerId: container.id, lastError: "A Meta está processando a mídia." });
}

/** Avança um post em "publicando". Retorna o que aconteceu. */
export async function advancePost(post: ContentPost, config: Config, deadline = Date.now() + 8000, pending?: PendingNotice[]): Promise<"published" | "failed" | "waiting"> {
  assertConnected(config);
  if (!(await tryLockPost(post.id, 90))) return "waiting"; // outro relógio já está cuidando deste post
  try {
    // Relê depois de pegar a trava: o post pode ter mudado (outro relógio publicou, alguém cancelou...).
    const fresh = await getContentPost(post.id);
    if (!fresh || fresh.status !== "publishing") return "waiting";
    return await advanceLocked(fresh, config, deadline, pending);
  } finally {
    await unlockPost(post.id).catch(() => undefined);
  }
}

async function advanceLocked(post: ContentPost, config: Config, deadline: number, pending?: PendingNotice[]): Promise<"published" | "failed" | "waiting"> {
  const startedAt = new Date(post.publishing_started_at ?? post.scheduled_at ?? post.created_at).getTime();
  const tooOld = Date.now() - startedAt > MAX_PUBLISHING_HOURS * 3600_000;
  // Sem container na Meta não há o que conferir: passou do tempo, desiste. Com container, confere antes (pode já ter saído).
  if (tooOld && !post.container_id) return failTooOld(post, pending);

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
          await markPostFailed(post, `Item ${index + 1}: ${status.status || status.status_code}`, { pending });
          return "failed";
        }
      }
      await updateContentPostMediaItems(post.id, items);
      if (items.some((item) => item.status !== "finished")) {
        if (tooOld) return failTooOld(post, pending);
        await touchContentPost(post.id, "A Meta ainda está processando os itens do carrossel.");
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

  let status: Awaited<ReturnType<typeof getInstagramMediaContainerStatus>>;
  try {
    status = await getInstagramMediaContainerStatus(post.container_id as string, config.instagram_access_token as string);
  } catch (error) {
    if (tooOld) return failTooOld(post, pending);
    throw error;
  }

  // PUBLISHED: a Meta já publicou (a função anterior foi cortada antes de gravar). É sucesso, nunca publicar de novo.
  // PUBLISHED é final: se o feed não responder, espera o próximo relógio para pegar o id (1º comentário,
  // automação e resultados dependem dele). Só desiste do link depois de 2 h.
  if (status.status_code === "PUBLISHED") {
    let media: FeedMedia | null = null;
    let feedOk = true;
    try {
      media = await findPublishedMedia(post, config);
    } catch {
      feedOk = false;
    }
    // feed fora do ar, ou pedido recente e o post ainda não apareceu: continua "publicando" e confere no próximo relógio
    if (!tooOld && (!feedOk || (!media && publishRequestedRecently(post)))) {
      await touchContentPost(post.id, "A Meta publicou. Buscando o link do post.");
      return "waiting";
    }
    await finishPublished(post, config, media, { locked: true });
    return "published";
  }

  // Houve um pedido de publicação antes (execução cortada): confere o feed antes de pedir de novo.
  if (post.publish_requested_at) {
    let media: FeedMedia | null;
    try {
      media = await findPublishedMedia(post, config);
    } catch (error) {
      if (tooOld) return failTooOld(post, pending);
      throw error; // sem conferir, não arrisca: espera o próximo relógio
    }
    if (media) {
      await finishPublished(post, config, media, { locked: true });
      return "published";
    }
    // Pedido recente e nada no feed ainda: a Meta pode ter recebido. Não pede de novo antes de PUBLISH_RECHECK_MS.
    if (!tooOld && publishRequestedRecently(post)) {
      await touchContentPost(post.id, "Conferindo se a Meta já publicou.");
      return "waiting";
    }
  }

  if (tooOld) return failTooOld(post, pending);

  if (status.status_code === "FINISHED") {
    // Grava o pedido ANTES de chamar a Meta: se a função cair no meio, a próxima rodada confere em vez de repetir.
    await markPublishRequested(post.id);
    const published = await publishInstagramMediaContainer({
      instagramUserId: config.instagram_user_id as string,
      accessToken: config.instagram_access_token as string,
      containerId: post.container_id as string,
    });
    const media = await getPublishedInstagramMedia(published.id, config.instagram_access_token as string).catch(() => null);
    await finishPublished(post, config, { id: published.id, permalink: media?.permalink ?? null }, { locked: true });
    return "published";
  }
  if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
    await markPostFailed(post, translateError(new Error(status.status || `Container ${status.status_code}`)), { containerId: post.container_id, pending });
    return "failed";
  }
  if (tooOld) return failTooOld(post, pending);
  await touchContentPost(post.id, "A Meta está processando a mídia.");
  return "waiting";
}

async function failTooOld(post: ContentPost, pending?: PendingNotice[]) {
  await markPostFailed(post, `A Meta não terminou de processar em ${MAX_PUBLISHING_HOURS} h. Tente agendar de novo.`, { containerId: post.container_id, pending });
  return "failed" as const;
}

/** Aviso de "Com erro" ainda não mandado (o relógio junta os do ciclo e manda no fim). */
export type PendingNotice = { post: ContentPost; motivo: string };

/**
 * Marca o post como "Com erro" e avisa no Telegram (se configurado) uma vez por mudança:
 * um post que já estava com erro não gera outro aviso. Com `pending`, o aviso é guardado para sair no fim
 * do ciclo (sendPendingNotices); sem ele, sai na hora. O aviso nunca quebra o relógio.
 */
export async function markPostFailed(
  post: Pick<ContentPost, "id">,
  lastError: string,
  options: { containerId?: string | null; origin?: string | null; pending?: PendingNotice[] } = {},
) {
  const result = await failContentPost({ id: post.id, lastError, containerId: options.containerId });
  if (result?.changed) {
    if (options.pending) options.pending.push({ post: result.post, motivo: lastError });
    else await notifyPostFailed(result.post, lastError, options.origin);
  }
  return result?.post ?? null;
}

/**
 * Manda os avisos guardados todos ao mesmo tempo, com um prazo só: o que sobra até `deadline` menos 0,5 s
 * (no máximo 5 s). Sem tempo sobrando, não manda e registra no console (o "Com erro" já está gravado).
 */
async function sendPendingNotices(pending: PendingNotice[], origin: string | null | undefined, deadline: number) {
  if (!pending.length) return;
  const timeoutMs = Math.min(TELEGRAM_TIMEOUT_MS, deadline - Date.now() - 500);
  if (timeoutMs <= 0) {
    console.warn(`[aviso] Sem tempo neste ciclo para mandar ${pending.length} aviso(s) de post com erro.`);
    return;
  }
  await Promise.all(pending.map((notice) => notifyPostFailed(notice.post, notice.motivo, origin, { timeoutMs })));
}

/**
 * Marca como publicado e segue o pós-publicação de sempre (1º comentário e automação da palavra).
 * Sem o id da mídia (a Meta confirmou, mas o feed não trouxe), marca publicado com nota e não cria automação solta.
 */
async function finishPublished(post: ContentPost, config: Config, media: FeedMedia | null, options: { locked: boolean }) {
  const updated = await updateContentPostStatus({
    id: post.id,
    status: "published",
    containerId: post.container_id,
    publishedMediaId: media?.id ?? null,
    permalink: media?.permalink ?? null,
    lastError: media?.id ? null : PUBLISHED_WITHOUT_LINK_NOTE,
    publishedAt: parseMetaTimestamp(media?.timestamp) ?? new Date(),
  });
  if (media?.id) {
    const fresh = (await getContentPost(post.id)) ?? updated ?? post;
    // com a trava do post: faz o 1º comentário e liga a automação na hora; sem ela, afterPublish pega a trava
    if (options.locked) await afterPublishLocked(fresh, config, media.id, { comment: false, automation: false }).catch(() => undefined);
    else await afterPublish(fresh, config, media.id).catch(() => undefined);
  }
  return (await getContentPost(post.id)) ?? updated;
}

function publishRequestedRecently(post: ContentPost) {
  if (!post.publish_requested_at) return false;
  return Date.now() - new Date(post.publish_requested_at).getTime() < PUBLISH_RECHECK_MS;
}

/**
 * Procura no feed do perfil o post que já saiu (mesma legenda, a partir do pedido), sem pegar mídia que já é
 * de outro post do UaiFlow. Erro da Meta sobe para quem chamou.
 */
async function findPublishedMedia(post: ContentPost, config: Config): Promise<FeedMedia | null> {
  const feed = await listRecentInstagramMedia(config.instagram_user_id as string, config.instagram_access_token as string, 10);
  const since = new Date(post.publish_requested_at ?? post.publishing_started_at ?? post.scheduled_at ?? post.created_at);
  const data = feed.data ?? [];
  const excludeIds = await listClaimedMediaIds(data.map((media) => media.id), post.id);
  return findMatchingMedia(data, { caption: post.caption, since, excludeIds });
}

export type EarlierPublishCheck =
  | { state: "published"; post: ContentPost }
  | { state: "not_published" }
  /** Não deu para conferir agora (Instagram desconectado, feed fora do ar ou pedido recente): não mexer no post. */
  | { state: "unknown" };

/**
 * Antes de "Tentar de novo", reagendar ou reenviar um post que já foi mandado para a Meta:
 * confere se ele não saiu. Se saiu, marca como publicado (e faz o pós-publicação). Nunca publica em dobro.
 */
export async function confirmEarlierPublish(post: ContentPost): Promise<EarlierPublishCheck> {
  if (!post.published_media_id && !post.publish_requested_at && !post.container_id) return { state: "not_published" };
  const config = await getConfig(post.account_id);
  if (!config.instagram_user_id || !config.instagram_access_token) return { state: "unknown" };

  if (post.published_media_id) {
    const published = await finishPublished(post, config, { id: post.published_media_id, permalink: post.permalink }, { locked: false });
    return { state: "published", post: published ?? post };
  }

  let containerStatus: string | null = null;
  let containerUnknown = false;
  if (post.container_id) {
    try {
      containerStatus = (await getInstagramMediaContainerStatus(post.container_id, config.instagram_access_token)).status_code ?? null;
    } catch {
      containerUnknown = true;
    }
  }

  let media: FeedMedia | null = null;
  if (containerStatus === "PUBLISHED" || post.publish_requested_at || containerUnknown) {
    try {
      media = await findPublishedMedia(post, config);
    } catch {
      // Sem o feed: nem publicar de novo, nem marcar publicado sem id (perderia 1º comentário e automação).
      return { state: "unknown" };
    }
  }
  // Pedido recente e o post ainda fora do feed: pode só estar atrasado. Melhor tentar daqui a alguns minutos.
  if (!media && publishRequestedRecently(post)) return { state: "unknown" };

  if (containerStatus === "PUBLISHED" || media) {
    const published = await finishPublished(post, config, media, { locked: false });
    return { state: "published", post: published ?? post };
  }
  return { state: "not_published" };
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
      await touchContentPost(post.id, `Publicado, mas o 1º comentário falhou: ${translateError(error)}`);
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
        welcome_dm: post.dm_text || "Oi! Toque no botão abaixo para receber.",
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
      await touchContentPost(post.id, `Publicado, mas a automação da DM falhou: ${translateError(error)}`);
    }
  }
  return done;
}

function assertConnected(config: Config) {
  if (!config.instagram_user_id || !config.instagram_access_token) throw new Error("Instagram não conectado para este perfil.");
}

function toInstagramPublishType(value: ContentPost["publish_type"]): InstagramPublishType {
  if (value === "reel_video" || value === "feed_video") return "reel_video"; // vídeo no feed = Reel (a Meta não aceita mais VIDEO)
  if (value === "story_image") return "story_image";
  if (value === "story_video") return "story_video";
  return "feed_image";
}

export function translateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Erro desconhecido.");
  if (/content_publish|permission/i.test(message)) return "Falta a permissão de publicar. Reconecte o perfil aceitando instagram_business_content_publish.";
  if (/Media ID is not available|not ready/i.test(message)) return "A mídia ainda não terminou de processar na Meta.";
  if (/aspect ratio|resolution|duration|codec/i.test(message)) return "A Meta recusou o vídeo (formato, duração ou resolução). Reels: MP4 H.264, 9:16, de 3 s a 15 min.";
  if (/Invalid parameter|url|download/i.test(message)) return "A Meta não conseguiu baixar a mídia. Confira se o link é público.";
  return message.replace(/^Instagram Graph v\d+\.\d+:\s*/i, "Meta: ").slice(0, 400);
}
