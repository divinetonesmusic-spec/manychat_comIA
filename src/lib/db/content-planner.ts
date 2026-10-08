import { query } from "@/lib/db/client";
import { getDefaultInstagramAccount, type ContentMediaItem, type ContentPost, type ContentPublishType } from "@/lib/db/repositories";
import { formatSaoPauloTime } from "@/lib/time";

/** Tudo o que um post leva: mídia, legenda, horário e o funil (palavra → DM → link). */
export type PostPackage = {
  accountId?: string | null;
  publishType: ContentPublishType;
  title?: string;
  caption?: string;
  mediaUrl?: string;
  coverUrl?: string | null;
  mediaItems?: ContentMediaItem[];
  mediaKeys?: string[];
  scheduledAt?: Date | null;
  firstComment?: string;
  keyword?: string;
  dmText?: string;
  linkUrl?: string;
  linkLabel?: string;
  publicReply?: string;
  /** Textos da automação no idioma do avatar: quickReplyLabel, linkText, reminderText, publicReplies[], requireFollower. */
  automationOptions?: AutomationOptions;
  /** "Feito com IA": o Instagram mostra o aviso no post. Ausente = não mexe (post novo começa sem aviso). */
  aiGenerated?: boolean;
  source?: string;
  externalRef?: string | null;
};

export type AutomationOptions = {
  quickReplyLabel?: string;
  linkText?: string;
  reminderText?: string;
  publicReplies?: string[];
  requireFollower?: boolean;
};

const EDITABLE_STATUSES = ["draft", "scheduled", "failed", "canceled"];

export async function createPlannedPost(input: PostPackage): Promise<ContentPost> {
  const accountId = input.accountId ?? (await getDefaultInstagramAccount())?.id ?? null;
  const status = input.scheduledAt ? "scheduled" : "draft";
  // A coluna ai_generated vem da migração 0006; sem ela, grava como antes (e o aviso de IA não vai).
  const withAi = await hasAiGeneratedColumn();
  const { rows } = await query<ContentPost>(
    `insert into public.content_posts (
       account_id, publish_type, title, caption, media_url, cover_url, media_items, media_keys, status,
       scheduled_at, first_comment, keyword, dm_text, link_url, link_label, public_reply, source, external_ref,
       automation_options${withAi ? ", ai_generated" : ""}
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19${withAi ? ",$20" : ""})
     returning *`,
    [
      accountId,
      input.publishType,
      (input.title ?? "").slice(0, 200),
      input.caption ?? "",
      input.publishType === "carousel" ? input.mediaItems?.[0]?.url ?? "" : input.mediaUrl ?? "",
      input.coverUrl ?? null,
      JSON.stringify(input.mediaItems ?? []),
      input.mediaKeys ?? [],
      status,
      input.scheduledAt ?? null,
      input.firstComment ?? "",
      (input.keyword ?? "").trim(),
      input.dmText ?? "",
      input.linkUrl ?? "",
      input.linkLabel ?? "",
      input.publicReply ?? "",
      input.source ?? "manual",
      input.externalRef ?? null,
      JSON.stringify(input.automationOptions ?? {}),
      ...(withAi ? [input.aiGenerated === true] : []),
    ],
  );
  return rows[0];
}

export async function getContentPost(id: string): Promise<ContentPost | null> {
  const { rows } = await query<ContentPost>(
    `select cp.*, ia.instagram_username as account_username
     from public.content_posts cp left join public.instagram_accounts ia on ia.id = cp.account_id
     where cp.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findPostByExternalRef(accountId: string, source: string, externalRef: string): Promise<ContentPost | null> {
  const { rows } = await query<ContentPost>(
    "select * from public.content_posts where account_id = $1 and source = $2 and external_ref = $3 limit 1",
    [accountId, source, externalRef],
  );
  return rows[0] ?? null;
}

/** Edita um post que ainda não foi publicado (reagendar, trocar legenda, mídia, funil). */
export async function updatePlannedPost(id: string, input: Partial<PostPackage>): Promise<ContentPost | null> {
  const current = await getContentPost(id);
  if (!current) return null;
  if (!EDITABLE_STATUSES.includes(current.status)) {
    throw new Error("Este post já está sendo publicado ou já foi publicado; não dá para editar.");
  }

  const next = {
    publish_type: input.publishType ?? current.publish_type,
    title: input.title ?? current.title ?? "",
    caption: input.caption ?? current.caption,
    // Containers da Meta vencem em 24 h: ao reagendar, os itens começam do zero.
    media_items: (input.mediaItems ?? current.media_items ?? []).map((item) => ({ type: item.type, url: item.url, cover_url: item.cover_url ?? null, status: "pending" as const })),
    cover_url: input.coverUrl === undefined ? current.cover_url : input.coverUrl,
    media_keys: input.mediaKeys ?? current.media_keys ?? [],
    scheduled_at: input.scheduledAt === undefined ? current.scheduled_at : input.scheduledAt,
    first_comment: input.firstComment ?? current.first_comment ?? "",
    keyword: (input.keyword ?? current.keyword ?? "").trim(),
    dm_text: input.dmText ?? current.dm_text ?? "",
    link_url: input.linkUrl ?? current.link_url ?? "",
    link_label: input.linkLabel ?? current.link_label ?? "",
    public_reply: input.publicReply ?? current.public_reply ?? "",
    automation_options: input.automationOptions ?? current.automation_options ?? {},
  };
  const mediaUrl = next.publish_type === "carousel"
    ? (next.media_items as ContentMediaItem[])[0]?.url ?? ""
    : input.mediaUrl ?? current.media_url;
  const status = next.scheduled_at ? "scheduled" : "draft";
  const newMedia = input.mediaUrl !== undefined || input.mediaItems !== undefined;
  if (current.media_deleted_at && !newMedia) {
    throw new Error("A mídia deste post já foi apagada do armazenamento. Envie o arquivo de novo antes de reagendar.");
  }

  // Conteúdo novo, tentativa nova: some o container antigo e o registro do pedido de publicação (0003).
  const resetRequest = (await hasPublishRequestedColumn()) ? ", publish_requested_at = null" : "";
  // Só mexe no aviso de IA quando a edição traz o campo (e a coluna da 0006 existe); sem o campo, mantém o que está.
  const setAi = input.aiGenerated !== undefined && (await hasAiGeneratedColumn());
  const aiClause = setAi ? ", ai_generated = $19" : "";
  const { rows } = await query<ContentPost>(
    `update public.content_posts set
       publish_type = $2, title = $3, caption = $4, media_url = $5, cover_url = $6, media_items = $7,
       media_keys = $8, scheduled_at = $9, first_comment = $10, keyword = $11, dm_text = $12,
       link_url = $13, link_label = $14, public_reply = $15, status = $16, last_error = null,
       container_id = null, attempts = 0, automation_options = $17, publishing_started_at = null, lock_until = null,
       media_deleted_at = case when $18 then null else media_deleted_at end${aiClause}${resetRequest}
     where id = $1
     returning *`,
    [
      id, next.publish_type, next.title, next.caption, mediaUrl, next.cover_url, JSON.stringify(next.media_items),
      next.media_keys, next.scheduled_at, next.first_comment, next.keyword, next.dm_text, next.link_url,
      next.link_label, next.public_reply, status, JSON.stringify(next.automation_options), newMedia,
      ...(setAi ? [input.aiGenerated === true] : []),
    ],
  );
  return rows[0] ?? null;
}

export async function cancelPlannedPost(id: string) {
  const { rows } = await query<ContentPost>(
    `update public.content_posts set status = 'canceled', last_error = null
     where id = $1 and status in ('draft', 'scheduled', 'failed')
     returning *`,
    [id],
  );
  return rows[0] ?? null;
}

/** Apaga o registro (não apaga nada do Instagram). */
export async function deleteContentPost(id: string) {
  const { rows } = await query<{ id: string; media_keys: string[]; status: string }>(
    "delete from public.content_posts where id = $1 and status <> 'publishing' returning id, media_keys, status",
    [id],
  );
  return rows[0] ?? null;
}

export async function claimDueContentPosts(limit = 3): Promise<ContentPost[]> {
  const { rows } = await query<ContentPost>("select * from public.claim_due_content_posts($1)", [limit]);
  return rows;
}

/**
 * "Publicar agora": pega um post específico (rascunho, agendado ou com erro) e marca como publicando.
 * Já sai com a trava curta (o relógio não mexe nele enquanto a requisição cria o container); quem chama solta a trava.
 */
export async function claimPostNow(id: string, lockSeconds = 60): Promise<ContentPost | null> {
  const resetRequest = (await hasPublishRequestedColumn())
    ? ", publish_requested_at = case when status = 'failed' then null else publish_requested_at end"
    : "";
  const { rows } = await query<ContentPost>(
    `update public.content_posts
     set status = 'publishing', attempts = attempts + 1, last_error = null,
         scheduled_at = now(), publishing_started_at = now(), lock_until = now() + make_interval(secs => $2),
         container_id = case when status = 'failed' then null else container_id end,
         media_items = case when status = 'failed'
           then coalesce((select jsonb_agg(item - 'container_id' - 'status' - 'error') from jsonb_array_elements(media_items) item), '[]'::jsonb)
           else media_items end${resetRequest}
     where id = $1 and status in ('draft', 'scheduled', 'failed', 'canceled') and media_deleted_at is null
     returning *`,
    [id, lockSeconds],
  );
  return rows[0] ?? null;
}

/**
 * Colunas que vêm de migrações ainda não coladas no Supabase (publish_requested_at: 0003; ai_generated: 0006).
 * Enquanto a migração não foi colada, o código segue sem elas (comportamento antigo). Confere no banco uma vez por
 * processo e guarda o "sim" para sempre; o "não" é conferido de novo a cada minuto, para pegar a migração assim
 * que ela for aplicada.
 */
function columnProbe(column: string) {
  let cached: { exists: boolean; checkedAt: number } | null = null;
  return async () => {
    if (cached && (cached.exists || Date.now() - cached.checkedAt < 60_000)) return cached.exists;
    const { rows } = await query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'content_posts' and column_name = $1
       ) as exists`,
      [column],
    );
    cached = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
    return cached.exists;
  };
}

export const hasPublishRequestedColumn = columnProbe("publish_requested_at");
export const hasAiGeneratedColumn = columnProbe("ai_generated");

/** Grava a hora do pedido de publicação ANTES de chamar o media_publish. Sem a 0003, não faz nada. */
export async function markPublishRequested(id: string) {
  if (!(await hasPublishRequestedColumn())) return false;
  await query("update public.content_posts set publish_requested_at = now() where id = $1", [id]);
  return true;
}

/** O Instagram aceita 100 publicações por perfil em 24 h; o UaiFlow para em 95 (margem para o que sai fora dele). */
export const MAX_POSTS_PER_24H = 95;

/**
 * Quantos posts o perfil já gastou da cota de 24 h: os publicados nas últimas 24 h mais os que estão sendo
 * publicados agora (carrossel conta 1). `exceptPostId` deixa de fora o próprio post que vai começar.
 * Posts publicados fora do UaiFlow não aparecem aqui.
 */
export async function publishedLast24h(accountId: string | null, exceptPostId?: string | null): Promise<number> {
  const { rows } = await query<{ count: number }>(
    `select count(*)::int as count from public.content_posts
     where ${accountId ? "account_id = $1" : "account_id is null and $1::uuid is null"}
       and ($2::uuid is null or id <> $2)
       and ((status = 'published' and published_at > now() - interval '24 hours') or status = 'publishing')`,
    [accountId, exceptPostId ?? null],
  );
  return rows[0]?.count ?? 0;
}

/**
 * O perfil está no limite: o post que ia começar volta para "agendado" no horário em que a vaga abre
 * (o publicado mais antigo da janela + 24 h + 1 min) com a nota para a pessoa ler. Não gasta tentativa e nunca vira "Com erro".
 */
export async function deferPostForPublishLimit(post: Pick<ContentPost, "id" | "account_id">): Promise<ContentPost | null> {
  const { rows: slotRows } = await query<{ slot: Date }>(
    `select greatest(
              coalesce(min(published_at) + interval '24 hours 1 minute', now() + interval '30 minutes'),
              now() + interval '1 minute'
            ) as slot
     from public.content_posts
     where ${post.account_id ? "account_id = $1" : "account_id is null and $1::uuid is null"}
       and status = 'published' and published_at > now() - interval '24 hours'`,
    [post.account_id],
  );
  const availableAt = slotRows[0].slot;
  const note = `Limite de 100 publicações em 24 h do Instagram: sai às ${formatSaoPauloTime(availableAt)}.`;
  const { rows } = await query<ContentPost>(
    `update public.content_posts
     set status = 'scheduled', scheduled_at = $2, last_error = $3, attempts = greatest(attempts - 1, 0),
         publishing_started_at = null, lock_until = null
     where id = $1 and status = 'publishing'
     returning *`,
    [post.id, availableAt, note],
  );
  return rows[0] ?? null;
}

/** Ids de mídia do Instagram que já pertencem a outro post do UaiFlow (a conferência do feed não pode pegá-los). */
export async function listClaimedMediaIds(mediaIds: string[], exceptPostId: string): Promise<Set<string>> {
  if (!mediaIds.length) return new Set();
  const { rows } = await query<{ media_id: string }>(
    "select published_media_id as media_id from public.content_posts where published_media_id = any($1::text[]) and id <> $2",
    [mediaIds, exceptPostId],
  );
  return new Set(rows.map((row) => row.media_id));
}

/** Trava curta: só um "relógio" mexe no post por vez (cron, tela aberta e Molde podem rodar juntos). */
export async function tryLockPost(id: string, seconds = 60) {
  const { rows } = await query<{ id: string }>(
    `update public.content_posts set lock_until = now() + make_interval(secs => $2)
     where id = $1 and (lock_until is null or lock_until < now())
     returning id`,
    [id, seconds],
  );
  return Boolean(rows[0]);
}

export async function unlockPost(id: string) {
  await query("update public.content_posts set lock_until = null where id = $1", [id]);
}

export async function listPublishingPosts(limit = 8): Promise<ContentPost[]> {
  const { rows } = await query<ContentPost>(
    `select * from public.content_posts
     where status = 'publishing' and (lock_until is null or lock_until < now())
     order by updated_at asc
     limit $1`,
    [limit],
  );
  return rows;
}

/**
 * Posts presos em "publicando" sem container final há mais de 15 min voltam para a fila (até 3 tentativas).
 * Carrossel também: os itens que já têm container são aproveitados na próxima rodada.
 * Devolve os que acabaram de passar para "Com erro" (para o aviso no Telegram).
 */
export async function recoverStuckPosts(): Promise<ContentPost[]> {
  const { rows } = await query<ContentPost>(
    `update public.content_posts cp
     set status = case when attempts >= 3 then 'failed' else 'scheduled' end,
         lock_until = null,
         last_error = case when attempts >= 3 then 'Não consegui iniciar a publicação depois de 3 tentativas.' else last_error end
     where status = 'publishing'
       and container_id is null
       and coalesce(publishing_started_at, updated_at) < now() - interval '15 minutes'
       and (lock_until is null or lock_until < now())
     returning cp.*, (select ia.instagram_username from public.instagram_accounts ia where ia.id = cp.account_id) as account_username`,
  );
  return rows.filter((row) => row.status === "failed");
}

/**
 * Marca o post como "Com erro". `changed` diz se ele acabou de mudar para esse estado: um post que já
 * estava com erro tem o motivo atualizado, mas não gera outro aviso. A trava da linha (for update) faz
 * dois relógios ao mesmo tempo verem a mudança uma vez só.
 */
export async function failContentPost(input: { id: string; lastError: string; containerId?: string | null }) {
  const { rows } = await query<ContentPost & { previous_status: ContentPost["status"] }>(
    `with previous as (
       select id, status from public.content_posts where id = $1 for update
     )
     update public.content_posts cp
     set status = 'failed', container_id = coalesce($3, cp.container_id), last_error = $2
     from previous
     where cp.id = previous.id
     returning cp.*, previous.status as previous_status,
       (select ia.instagram_username from public.instagram_accounts ia where ia.id = cp.account_id) as account_username`,
    [input.id, input.lastError, input.containerId ?? null],
  );
  if (!rows[0]) return null;
  const { previous_status: previousStatus, ...post } = rows[0];
  return { post: post as ContentPost, changed: previousStatus !== "failed" };
}

export async function touchContentPost(id: string, note: string | null) {
  await query("update public.content_posts set last_error = $2, updated_at = now() where id = $1", [id, note]);
}

export async function setPostFirstComment(id: string, commentId: string) {
  await query("update public.content_posts set first_comment_id = $2 where id = $1", [id, commentId]);
}

export async function setPostAutomation(id: string, automationId: string) {
  await query("update public.content_posts set automation_id = $2 where id = $1", [id, automationId]);
}

/** Posts publicados há pouco que ainda não ganharam o 1º comentário ou a automação (repete se falhou). */
export async function listPostsMissingAfterPublish(limit = 5): Promise<ContentPost[]> {
  const { rows } = await query<ContentPost>(
    `select * from public.content_posts
     where status = 'published' and published_media_id is not null
       and published_at > now() - interval '2 days'
       and (lock_until is null or lock_until < now())
       and ((first_comment <> '' and first_comment_id is null)
         or (keyword <> '' and (dm_text <> '' or link_url <> '') and automation_id is null))
     order by published_at asc
     limit $1`,
    [limit],
  );
  return rows;
}

export async function listPostsNeedingInsights(limit = 5): Promise<ContentPost[]> {
  const { rows } = await query<ContentPost>(
    `select * from public.content_posts
     where status = 'published' and published_media_id is not null
       and published_at > now() - interval '30 days'
       and published_at < now() - interval '1 hour'
       and (insights_at is null or insights_at < now() - interval '6 hours')
     order by insights_at asc nulls first
     limit $1`,
    [limit],
  );
  return rows;
}

export async function saveInsights(id: string, insights: Record<string, number>) {
  await query("update public.content_posts set insights = $2, insights_at = now() where id = $1", [id, JSON.stringify(insights)]);
}

/** Vídeos no R2 podem ser apagados 3 dias depois de publicados (o original fica no Mac). */
export async function listPostsForMediaCleanup(limit = 10): Promise<ContentPost[]> {
  const { rows } = await query<ContentPost>(
    `select * from public.content_posts
     where media_deleted_at is null
       and ((status = 'published' and published_at < now() - interval '3 days')
         or (status = 'canceled' and updated_at < now() - interval '14 days'))
     order by coalesce(published_at, updated_at) asc
     limit $1`,
    [limit],
  );
  return rows;
}

export async function markMediaDeleted(id: string) {
  await query("update public.content_posts set media_deleted_at = now() where id = $1", [id]);
}

export async function listContentPostsInRange(input: { accountId?: string | null; from: Date; to: Date }): Promise<ContentPost[]> {
  const { rows } = await query<ContentPost>(
    `select cp.*, ia.instagram_username as account_username
     from public.content_posts cp left join public.instagram_accounts ia on ia.id = cp.account_id
     where ($1::uuid is null or cp.account_id = $1)
       and coalesce(cp.scheduled_at, cp.published_at, cp.created_at) >= $2
       and coalesce(cp.scheduled_at, cp.published_at, cp.created_at) < $3
     order by coalesce(cp.scheduled_at, cp.published_at, cp.created_at) asc
     limit 500`,
    [input.accountId ?? null, input.from, input.to],
  );
  return rows;
}

export async function listPostsBySource(input: { accountId?: string | null; source: string; externalRefs?: string[]; limit?: number }) {
  const { rows } = await query<ContentPost>(
    `select cp.*, ia.instagram_username as account_username
     from public.content_posts cp left join public.instagram_accounts ia on ia.id = cp.account_id
     where cp.source = $1
       and ($2::uuid is null or cp.account_id = $2)
       and ($3::text[] is null or cp.external_ref = any($3))
     order by coalesce(cp.scheduled_at, cp.published_at, cp.created_at) desc
     limit $4`,
    [input.source, input.accountId ?? null, input.externalRefs?.length ? input.externalRefs : null, input.limit ?? 200],
  );
  return rows;
}
