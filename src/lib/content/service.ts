import { getConfig, type ContentPost } from "@/lib/db/repositories";
import {
  cancelPlannedPost,
  createPlannedPost,
  deleteContentPost,
  findPostByExternalRef,
  getContentPost,
  hasAiGeneratedColumn,
  MEDIA_REMOVED_NOTE,
  updatePlannedPost,
  type PostPackage,
} from "@/lib/db/content-planner";
import { deleteR2Object, isProtectedKey, keyFromPublicUrl } from "@/lib/content/r2";
import { confirmEarlierPublish, publishPostNow } from "@/lib/content/scheduler";

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
