import { getConfig, type ContentPost } from "@/lib/db/repositories";
import {
  cancelPlannedPost,
  createPlannedPost,
  deleteContentPost,
  findPostByExternalRef,
  getContentPost,
  hasAiGeneratedColumn,
  hasMusicColumns,
  MEDIA_REMOVED_NOTE,
  updatePlannedPost,
  type PostPackage,
} from "@/lib/db/content-planner";
import { deleteR2Object, isProtectedKey, keyFromPublicUrl } from "@/lib/content/r2";
import { confirmEarlierPublish, publishPostNow } from "@/lib/content/scheduler";
import { isReelType } from "@/lib/content/package";
import { facebookAccessToken, getFacebookConnection } from "@/lib/db/facebook-connections";
import { MUSIC_FACEBOOK_EXPIRED, MUSIC_NEEDS_FACEBOOK } from "@/lib/facebook/audio";

/** Regras comuns da tela de Conteúdo e do Molde: criar/atualizar, publicar agora, cancelar e apagar. */
export class ContentError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Aviso em português quando o pacote pede "feito com IA" mas a migração 0006 ainda não foi colada (o aviso não é guardado). */
export const AI_COLUMN_MISSING_WARNING = "Falta colar a atualização 0006 no Supabase: o aviso de IA não foi guardado.";

export async function aiColumnWarning(input: { aiGenerated?: boolean }): Promise<string | undefined> {
  if (input.aiGenerated !== true) return undefined;
  return (await hasAiGeneratedColumn()) ? undefined : AI_COLUMN_MISSING_WARNING;
}

/** Aviso quando o pacote traz música mas a 0009 ainda não foi colada (a música não é guardada; o post sai sem ela). */
export const MUSIC_COLUMN_MISSING_WARNING = "Falta colar a atualização 0009 no Supabase: a música não foi guardada.";

/**
 * Avisos da música do Instagram depois de salvar: 0009 faltando, ou Reel com música agendado numa conta sem a conexão
 * pelo Facebook (na hora de publicar ele vira "Com erro" com a mesma frase, sem sair sem música).
 */
export async function musicWarning(input: { music?: unknown }, post: ContentPost | null): Promise<string | undefined> {
  if (input.music && !(await hasMusicColumns())) return MUSIC_COLUMN_MISSING_WARNING;
  if (!post?.musica_audio_id || !isReelType(post.publish_type)) return undefined;
  if (post.status !== "scheduled" && post.status !== "draft") return undefined;
  const connection = await getFacebookConnection(post.account_id);
  if (!connection) return MUSIC_NEEDS_FACEBOOK;
  return facebookAccessToken(connection) ? undefined : MUSIC_FACEBOOK_EXPIRED;
}

/** Todos os avisos do pacote salvo (IA e música), numa frase só. */
export async function packageWarning(input: { aiGenerated?: boolean; music?: unknown }, post: ContentPost | null): Promise<string | undefined> {
  const warnings = [await aiColumnWarning(input), await musicWarning(input, post)].filter(Boolean);
  return warnings.length ? warnings.join(" ") : undefined;
}

export async function savePostPackage(input: PostPackage, publishNow: boolean): Promise<{ post: ContentPost | null; created: boolean }> {
  const config = await getConfig(input.accountId);
  const needsInstagram = publishNow || Boolean(input.scheduledAt);
  if (needsInstagram && (!config.account_id || !config.instagram_user_id || !config.instagram_access_token)) {
    throw new ContentError("Instagram não conectado para este perfil. Conecte o perfil antes de agendar ou publicar.");
  }
  const pkg: PostPackage = { ...input, accountId: config.account_id ?? input.accountId ?? null };

  // Mesmo item do Molde mandado de novo: atualiza em vez de duplicar.
  let post: ContentPost | null = null;
  let created = false;
  if (pkg.externalRef && pkg.accountId) {
    const existing = await findPostByExternalRef(pkg.accountId, pkg.source ?? "manual", pkg.externalRef);
    if (existing) {
      if (existing.status === "published" || existing.status === "publishing") {
        throw new ContentError(
          existing.status === "published"
            ? "Este item já foi publicado. Para postar de novo, mande como um item novo."
            : "Este item está sendo publicado agora. Espere 1 minuto.",
          409,
        );
      }
      const alreadyPublished = await ensureNotPublishedYet(existing);
      if (alreadyPublished) return { post: alreadyPublished, created: false };
      post = await updatePlannedPost(existing.id, pkg);
    }
  }
  if (!post) {
    post = await createPlannedPost(pkg);
    created = true;
  }
  if (publishNow && post) post = await publishPostNow(post.id);
  return { post, created };
}

export async function editPost(id: string, input: Partial<PostPackage>, publishNow: boolean) {
  const current = await getContentPost(id);
  if (!current) throw new ContentError("Post não encontrado.", 404);
  if (input.music && !isReelType(input.publishType ?? current.publish_type)) throw new ContentError("Música do Instagram só vale para Reel.");
  if ((publishNow || input.scheduledAt) && current.account_id) {
    const config = await getConfig(current.account_id);
    if (!config.instagram_user_id || !config.instagram_access_token) throw new ContentError("Instagram não conectado para este perfil.");
  }
  // Mídia apagada do R2 (post parado há 14 dias): publicar ou tentar de novo só com mídia nova.
  const sameUrls = (a: Array<{ url: string }>, b: Array<{ url: string }>) => a.length === b.length && a.every((item, index) => item.url === b[index]?.url);
  const newMedia = (input.mediaUrl !== undefined && input.mediaUrl !== current.media_url)
    || (input.mediaItems !== undefined && !sameUrls(input.mediaItems, current.media_items ?? []));
  if (publishNow && current.media_deleted_at && !newMedia && current.status !== "published") {
    throw new ContentError(MEDIA_REMOVED_NOTE, 409);
  }
  if (current.status !== "published" && current.status !== "publishing") {
    const alreadyPublished = await ensureNotPublishedYet(current);
    if (alreadyPublished) return alreadyPublished;
  }
  let post: ContentPost | null = current;
  if (Object.keys(input).length) {
    try {
      post = await updatePlannedPost(id, input);
    } catch (error) {
      throw new ContentError(error instanceof Error ? error.message : "Não deu para editar.", 409);
    }
  }
  if (publishNow) post = await publishPostNow(id);
  return post;
}

/**
 * Nunca publicar em dobro: se o post já foi mandado para a Meta antes (container, pedido de publicação
 * ou id da mídia), confere no Instagram antes de reagendar ou "Tentar de novo".
 * Devolve o post já marcado como publicado se ele tinha saído; null se é seguro seguir.
 */
async function ensureNotPublishedYet(post: ContentPost): Promise<ContentPost | null> {
  const check = await confirmEarlierPublish(post);
  if (check.state === "published") return check.post;
  if (check.state === "unknown") {
    throw new ContentError("Não consegui conferir no Instagram se este post já saiu, então não publiquei de novo. Tente de novo em alguns minutos.", 409);
  }
  return null;
}

export async function cancelPost(id: string) {
  const post = await cancelPlannedPost(id);
  if (!post) throw new ContentError("Só dá para cancelar rascunho, agendado ou com erro.", 409);
  return post;
}

/** Apaga o registro e a mídia guardada no R2 (o post no Instagram, se publicado, continua lá). */
export async function removePost(id: string) {
  const current = await getContentPost(id);
  if (!current) throw new ContentError("Post não encontrado.", 404);
  const removed = await deleteContentPost(id);
  if (!removed) throw new ContentError("Este post está sendo publicado agora. Espere 1 minuto e tente de novo.", 409);

  const keys = new Set<string>((current.media_keys ?? []).filter((key) => !isProtectedKey(key)));
  if (!current.media_deleted_at) {
    for (const url of [current.media_url, current.cover_url, ...(current.media_items ?? []).flatMap((item) => [item.url, item.cover_url])]) {
      const key = url ? keyFromPublicUrl(url) : null;
      if (key && !isProtectedKey(key)) keys.add(key);
    }
  }
  let mediaRemoved = 0;
  for (const key of keys) if (await deleteR2Object(key).catch(() => false)) mediaRemoved += 1;
  return { id, mediaRemoved, wasPublished: current.status === "published" };
}
