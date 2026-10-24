import { getConfig, type ContentPost } from "@/lib/db/repositories";
import { hasSequenciaTables, MIGRATION_0012_SEQUENCIA } from "@/lib/db/dm-sequencias";
import {
  cancelPlannedPost,
  createPlannedPost,
  deleteContentPost,
  findPostByExternalRef,
  getContentPost,
  hasAiGeneratedColumn,
  hasDestinoColumns,
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
import { attachRedesOne, connectedRedesByAccount, hasRedesTables, retryRede, syncPostRedes } from "@/lib/db/redes";
import { getInstagramAccountById } from "@/lib/db/repositories";
import { isRedeExtra, REDE_NOME, redesCompativeis, REDES_SO_REEL, redesExtras } from "@/lib/redes/redes";

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

/** Aviso quando o pacote traz redes mas a 0010 ainda não foi colada (o post sai só no Instagram). */
export const REDES_COLUMN_MISSING_WARNING = "Falta colar a atualização 0010 no Supabase: o post sai só no Instagram (as outras redes não foram guardadas).";

/**
 * Avisos das outras redes depois de salvar: 0010 faltando, ou rede escolhida que não está conectada nesta conta
 * (o post é salvo do mesmo jeito; o Instagram sai normalmente e aquela rede fica "Com erro" se continuar sem conexão).
 */
export async function redesWarning(input: { redes?: unknown }, post: ContentPost | null): Promise<string | undefined> {
  if (input.redes === undefined) return undefined;
  if (!(await hasRedesTables())) return REDES_COLUMN_MISSING_WARNING;
  const extras = redesExtras(post?.redes);
  if (!post?.account_id || !extras.length) return undefined;
  const account = await getInstagramAccountById(post.account_id);
  if (!account) return undefined;
  const conexoes = (await connectedRedesByAccount([account])).get(account.id);
  const faltando = extras.filter((rede) => !conexoes?.[rede].conectado);
  if (!faltando.length) return undefined;
  return `Não conectado nesta conta: ${faltando.map((rede) => REDE_NOME[rede]).join(", ")}. Conecte em Perfis antes do horário; o Instagram sai normalmente.`;
}

/** Aviso quando o pacote traz o destino do post mas a 0011 ainda não foi colada (o destino não é guardado). */
export const DESTINO_COLUMN_MISSING_WARNING = "Falta colar a atualização 0011 no Supabase: o destino do post não foi guardado.";

export async function destinoWarning(input: { destinoTipo?: unknown }): Promise<string | undefined> {
  if (input.destinoTipo === undefined) return undefined;
  return (await hasDestinoColumns()) ? undefined : DESTINO_COLUMN_MISSING_WARNING;
}

/** Aviso quando o pacote traz a sequência de DM mas a 0012 ainda não foi colada (a DM sai só com a 1ª mensagem). */
export async function sequenciaWarning(input: { automationOptions?: { sequencia?: unknown } }): Promise<string | undefined> {
  if (!input.automationOptions?.sequencia) return undefined;
  return (await hasSequenciaTables()) ? undefined : MIGRATION_0012_SEQUENCIA;
}

/** Todos os avisos do pacote salvo (IA, música, redes, destino e sequência de DM), numa frase só. */
export async function packageWarning(input: { aiGenerated?: boolean; music?: unknown; redes?: unknown; destinoTipo?: unknown; automationOptions?: { sequencia?: unknown } }, post: ContentPost | null, avisos: string[] = []): Promise<string | undefined> {
  const warnings = [...avisos, await aiColumnWarning(input), await musicWarning(input, post), await redesWarning(input, post), await destinoWarning(input), await sequenciaWarning(input)].filter(Boolean);
  return warnings.length ? warnings.join(" ") : undefined;
}

/** «Tentar de novo» de uma rede extra (só a que está com erro). */
export async function retryPostRede(id: string, rede: unknown) {
  if (!isRedeExtra(rede)) throw new ContentError("rede inválida: use facebook, threads ou youtube.");
  const current = await getContentPost(id);
  if (!current) throw new ContentError("Post não encontrado.", 404);
  if (!(await hasRedesTables())) throw new ContentError(REDES_COLUMN_MISSING_WARNING, 409);
  if (!(await retryRede(id, rede))) throw new ContentError(`${REDE_NOME[rede]} não está com erro neste post.`, 409);
  return attachRedesOne(await getContentPost(id));
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
  if (post) await syncPostRedes(post, { restart: !created });
  if (publishNow && post) post = await publishPostNow(post.id);
  return { post: await attachRedesOne(post), created };
}

export async function editPost(id: string, input: Partial<PostPackage>, publishNow: boolean) {
  const current = await getContentPost(id);
  if (!current) throw new ContentError("Post não encontrado.", 404);
  if (input.music && !isReelType(input.publishType ?? current.publish_type)) throw new ContentError("Música do Instagram só vale para Reel.");
  if (!redesCompativeis(input.publishType ?? current.publish_type, redesExtras(input.redes ?? current.redes)) && (input.redes !== undefined || input.publishType !== undefined)) {
    throw new ContentError(REDES_SO_REEL);
  }
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
  if (post && Object.keys(input).length) await syncPostRedes(post, { restart: true });
  if (publishNow) post = await publishPostNow(id);
  return attachRedesOne(post);
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
