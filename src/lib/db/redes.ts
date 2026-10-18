import { query } from "@/lib/db/client";
import type { ContentPost } from "@/lib/db/repositories";
import { listFacebookConnections, type FacebookConnection } from "@/lib/db/facebook-connections";
import { redesExtras, type RedeExtra, type RedeResultado, type RedeStatus } from "@/lib/redes/redes";

/**
 * Outras redes (migração 0010): resultado de cada rede extra por post (content_post_redes) e as conexões do Threads e
 * do YouTube. Os tokens daqui NUNCA saem do servidor: para as telas e o Molde, use connectedRedesByAccount (só sim/não)
 * e toRedeResultado (sem o estado interno).
 */

/** Aviso quando a 0010 ainda não foi colada no Supabase. */
export const MIGRATION_0010_MISSING = "Falta colar a atualização 0010 no Supabase para usar Facebook, Threads, YouTube e vendas.";

function tableProbe(table: string) {
  let cached: { exists: boolean; checkedAt: number } | null = null;
  return async () => {
    if (cached && (cached.exists || Date.now() - cached.checkedAt < 60_000)) return cached.exists;
    const { rows } = await query<{ exists: boolean }>("select to_regclass($1) is not null as exists", [`public.${table}`]);
    cached = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
    return cached.exists;
  };
}

/** A 0010 foi colada? (content_post_redes, as conexões novas e as colunas redes/youtube_* chegam juntas.) */
export const hasRedesTables = tableProbe("content_post_redes");
export const hasVendasTable = tableProbe("vendas");

let scopesColumn: { exists: boolean; checkedAt: number } | null = null;
async function hasGrantedScopesColumn() {
  if (scopesColumn && (scopesColumn.exists || Date.now() - scopesColumn.checkedAt < 60_000)) return scopesColumn.exists;
  const { rows } = await query<{ exists: boolean }>(
    `select exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'instagram_facebook_connections' and column_name = 'granted_scopes') as exists`,
  );
  scopesColumn = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
  return scopesColumn.exists;
}

/* ---------------- Facebook (Página): permissões da conexão ---------------- */

/** Grava as permissões que a pessoa deu no Login do Facebook (precisa da 0010; sem ela, não faz nada). */
export async function setFacebookGrantedScopes(accountId: string, scopes: string[]) {
  if (!(await hasGrantedScopesColumn())) return false;
  await query("update public.instagram_facebook_connections set granted_scopes = $2 where account_id = $1", [accountId, scopes]);
  return true;
}

/** A conexão pelo Facebook pode publicar Reels na Página? (token da Página e pages_manage_posts concedida.) */
export function facebookCanPublish(connection: (FacebookConnection & { granted_scopes?: string[] | null }) | null | undefined) {
  if (!connection?.page_access_token) return false;
  return Array.isArray(connection.granted_scopes) && connection.granted_scopes.includes("pages_manage_posts");
}

/* ---------------- Threads ---------------- */

export type ThreadsConnection = {
  account_id: string;
  threads_user_id: string;
  threads_username: string | null;
  access_token: string;
  token_expires_at: string | null;
  last_token_refresh_at: string | null;
  connected_at: string;
  updated_at: string;
};

export async function getThreadsConnection(accountId: string | null | undefined): Promise<ThreadsConnection | null> {
  if (!accountId || !(await hasRedesTables())) return null;
  const { rows } = await query<ThreadsConnection>("select * from public.threads_connections where account_id = $1", [accountId]);
  return rows[0] ?? null;
}

export async function listThreadsConnections(): Promise<ThreadsConnection[]> {
  if (!(await hasRedesTables())) return [];
  const { rows } = await query<ThreadsConnection>("select * from public.threads_connections order by connected_at asc");
  return rows;
}

export async function saveThreadsConnection(input: { accountId: string; threadsUserId: string; username: string | null; accessToken: string; expiresAt: Date | null }) {
  const { rows } = await query<ThreadsConnection>(
    `insert into public.threads_connections (account_id, threads_user_id, threads_username, access_token, token_expires_at, last_token_refresh_at, connected_at, updated_at)
     values ($1, $2, $3, $4, $5, now(), now(), now())
     on conflict (account_id) do update set
       threads_user_id = excluded.threads_user_id, threads_username = excluded.threads_username,
       access_token = excluded.access_token, token_expires_at = excluded.token_expires_at,
       last_token_refresh_at = now(), connected_at = now(), updated_at = now()
     returning *`,
    [input.accountId, input.threadsUserId, input.username, input.accessToken, input.expiresAt],
  );
  return rows[0];
}

export async function updateThreadsToken(input: { accountId: string; accessToken: string; expiresAt: Date | null }) {
  await query(
    `update public.threads_connections set access_token = $2, token_expires_at = $3, last_token_refresh_at = now(), updated_at = now()
     where account_id = $1`,
    [input.accountId, input.accessToken, input.expiresAt],
  );
}

/** Token do Threads ainda válido (com 5 min de folga), ou null. */
export function threadsAccessToken(connection: ThreadsConnection | null, now = Date.now()) {
  if (!connection?.access_token) return null;
  const expires = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : Number.POSITIVE_INFINITY;
  return expires - now > 5 * 60_000 ? connection.access_token : null;
}

/* ---------------- YouTube ---------------- */

export type YoutubeConnection = {
  account_id: string;
  channel_id: string | null;
  channel_title: string | null;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  scope: string | null;
  connected_at: string;
  updated_at: string;
};

export async function getYoutubeConnection(accountId: string | null | undefined): Promise<YoutubeConnection | null> {
  if (!accountId || !(await hasRedesTables())) return null;
  const { rows } = await query<YoutubeConnection>("select * from public.youtube_connections where account_id = $1", [accountId]);
  return rows[0] ?? null;
}

export async function saveYoutubeConnection(input: { accountId: string; refreshToken: string; accessToken: string | null; expiresAt: Date | null; scope: string | null; channelId?: string | null; channelTitle?: string | null }) {
  const { rows } = await query<YoutubeConnection>(
    `insert into public.youtube_connections (account_id, channel_id, channel_title, refresh_token, access_token, access_token_expires_at, scope, connected_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now(), now())
     on conflict (account_id) do update set
       channel_id = coalesce(excluded.channel_id, public.youtube_connections.channel_id),
       channel_title = coalesce(excluded.channel_title, public.youtube_connections.channel_title),
       refresh_token = excluded.refresh_token, access_token = excluded.access_token,
       access_token_expires_at = excluded.access_token_expires_at, scope = excluded.scope,
       connected_at = now(), updated_at = now()
     returning *`,
    [input.accountId, input.channelId ?? null, input.channelTitle ?? null, input.refreshToken, input.accessToken, input.expiresAt, input.scope],
  );
  return rows[0];
}

export async function updateYoutubeAccessToken(input: { accountId: string; accessToken: string; expiresAt: Date | null; refreshToken?: string | null }) {
  await query(
    `update public.youtube_connections set access_token = $2, access_token_expires_at = $3,
       refresh_token = coalesce($4, refresh_token), updated_at = now()
     where account_id = $1`,
    [input.accountId, input.accessToken, input.expiresAt, input.refreshToken ?? null],
  );
}

export async function setYoutubeChannel(accountId: string, channelId: string | null) {
  if (!channelId) return;
  await query("update public.youtube_connections set channel_id = coalesce(channel_id, $2), updated_at = now() where account_id = $1", [accountId, channelId]);
}

/* ---------------- Quem está conectado (para telas e Molde, sem token) ---------------- */

export type RedeConexao = { conectado: boolean; configurado: boolean; motivo?: string; nome?: string | null };
export type RedesConectadas = { instagram: RedeConexao; facebook: RedeConexao; threads: RedeConexao; youtube: RedeConexao };

/** O servidor tem as variáveis de cada rede? (sem elas o botão de conectar avisa que falta configurar) */
export function redesConfiguradas() {
  return {
    facebook: Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    threads: Boolean(process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET),
    youtube: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  };
}

/** Para cada conta: Instagram, Facebook (Página), Threads e YouTube conectados ou não, com o motivo. Nunca token. */
export async function connectedRedesByAccount(accounts: Array<{ id: string; instagram_access_token?: string | null; instagram_user_id?: string | null }>): Promise<Map<string, RedesConectadas>> {
  const configuradas = redesConfiguradas();
  const withTables = await hasRedesTables().catch(() => false);
  const [facebook, threads, youtube] = await Promise.all([
    listFacebookConnections().catch(() => [] as FacebookConnection[]),
    withTables ? query<{ account_id: string; threads_username: string | null; token_expires_at: string | null }>("select account_id, threads_username, token_expires_at from public.threads_connections").then((r) => r.rows).catch(() => []) : [],
    withTables ? query<{ account_id: string; channel_title: string | null }>("select account_id, channel_title from public.youtube_connections").then((r) => r.rows).catch(() => []) : [],
  ]);
  const fbBy = new Map(facebook.map((row) => [row.account_id, row]));
  const thBy = new Map(threads.map((row) => [row.account_id, row]));
  const ytBy = new Map(youtube.map((row) => [row.account_id, row]));
  const result = new Map<string, RedesConectadas>();
  const sem0010 = withTables ? undefined : MIGRATION_0010_MISSING;
  for (const account of accounts) {
    const fb = fbBy.get(account.id) as (FacebookConnection & { granted_scopes?: string[] | null }) | undefined;
    const th = thBy.get(account.id);
    const yt = ytBy.get(account.id);
    const thVencido = th?.token_expires_at ? new Date(th.token_expires_at).getTime() < Date.now() : false;
    result.set(account.id, {
      instagram: { conectado: Boolean(account.instagram_access_token && account.instagram_user_id), configurado: true },
      facebook: facebookCanPublish(fb)
        ? { conectado: true, configurado: configuradas.facebook, nome: fb?.page_name ?? null }
        : {
            conectado: false,
            configurado: configuradas.facebook,
            motivo: sem0010 ?? (fb ? "Reconecte pelo Facebook em Perfis para liberar a publicação na Página (pages_manage_posts)." : "Conecte pelo Facebook em Perfis."),
          },
      threads: th && !thVencido
        ? { conectado: true, configurado: configuradas.threads, nome: th.threads_username }
        : { conectado: false, configurado: configuradas.threads, motivo: sem0010 ?? (th ? "A conexão do Threads venceu. Reconecte em Perfis." : "Conecte o Threads em Perfis.") },
      youtube: yt
        ? { conectado: true, configurado: configuradas.youtube, nome: yt.channel_title }
        : { conectado: false, configurado: configuradas.youtube, motivo: sem0010 ?? "Conecte o YouTube em Perfis." },
    });
  }
  return result;
}

/* ---------------- Resultado de cada rede por post ---------------- */

export type RedeRow = {
  post_id: string;
  rede: RedeExtra;
  status: RedeStatus;
  etapa: string | null;
  estado: Record<string, unknown>;
  external_id: string | null;
  permalink: string | null;
  last_error: string | null;
  attempts: number;
  next_attempt_at: string;
  lock_until: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export function toRedeResultado(row: RedeRow): RedeResultado {
  return {
    rede: row.rede,
    status: row.status,
    externalId: row.external_id ?? null,
    permalink: row.permalink ?? null,
    erro: row.last_error ?? null,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    tentativas: row.attempts ?? 0,
  };
}

export async function listRedeRows(postIds: string[]): Promise<RedeRow[]> {
  if (!postIds.length || !(await hasRedesTables())) return [];
  const { rows } = await query<RedeRow>("select * from public.content_post_redes where post_id = any($1::uuid[]) order by rede", [postIds]);
  return rows;
}

/** Junta a cada post o resultado das redes extras (redes_resultado). Sem a 0010: lista vazia. */
export async function attachRedes<T extends ContentPost | null>(posts: T[]): Promise<T[]> {
  const ids = posts.filter((post): post is NonNullable<T> => Boolean(post)).map((post) => post.id);
  const rows = await listRedeRows(ids).catch(() => [] as RedeRow[]);
  const by = new Map<string, RedeResultado[]>();
  for (const row of rows) by.set(row.post_id, [...(by.get(row.post_id) ?? []), toRedeResultado(row)]);
  return posts.map((post) => (post ? { ...post, redes_resultado: by.get(post.id) ?? [] } : post));
}

export async function attachRedesOne<T extends ContentPost | null>(post: T): Promise<T> {
  return (await attachRedes([post]))[0];
}

/**
 * Deixa as linhas de content_post_redes de acordo com post.redes: cria as que faltam ("pending"), apaga as das redes que
 * saíram (se ainda não publicaram nem estão no meio) e, com `restart` (o post foi editado/reagendado), volta as que
 * falharam para "pending" do zero. Publicada nunca volta (nunca publica em dobro).
 */
export async function syncPostRedes(post: Pick<ContentPost, "id" | "redes">, options: { restart?: boolean } = {}) {
  if (!(await hasRedesTables())) return;
  const extras = redesExtras(post.redes);
  await query(
    `delete from public.content_post_redes where post_id = $1 and not (rede = any($2::text[])) and status in ('pending', 'failed')`,
    [post.id, extras],
  );
  for (const rede of extras) {
    await query(
      `insert into public.content_post_redes (post_id, rede) values ($1, $2)
       on conflict (post_id, rede) do update set
         status = case when $3 and public.content_post_redes.status = 'failed' then 'pending' else public.content_post_redes.status end,
         attempts = case when $3 and public.content_post_redes.status = 'failed' then 0 else public.content_post_redes.attempts end,
         etapa = case when $3 and public.content_post_redes.status = 'failed' then null else public.content_post_redes.etapa end,
         estado = case when $3 and public.content_post_redes.status = 'failed' then '{}'::jsonb else public.content_post_redes.estado end,
         last_error = case when $3 and public.content_post_redes.status = 'failed' then null else public.content_post_redes.last_error end,
         next_attempt_at = case when $3 and public.content_post_redes.status = 'failed' then now() else public.content_post_redes.next_attempt_at end,
         updated_at = now()`,
      [post.id, rede, Boolean(options.restart)],
    );
  }
}

/** "Tentar de novo" de uma rede: só a que falhou volta para "pending" do zero. Devolve false se não estava com erro. */
export async function retryRede(postId: string, rede: RedeExtra) {
  if (!(await hasRedesTables())) return false;
  const { rowCount } = await query(
    `update public.content_post_redes
     set status = 'pending', attempts = 0, etapa = null, estado = '{}'::jsonb, last_error = null, next_attempt_at = now(),
         lock_until = null, updated_at = now()
     where post_id = $1 and rede = $2 and status = 'failed'`,
    [postId, rede],
  );
  return Boolean(rowCount);
}

/**
 * Pega até `limit` redes na vez: pendentes ou no meio, com a hora da tentativa vencida, sem trava, e cujo post do
 * Instagram já terminou (publicado ou com erro: o Instagram com erro não segura as outras). Trava cada uma por 90 s.
 */
export async function claimDueRedes(limit = 4): Promise<Array<RedeRow & { post: ContentPost }>> {
  if (!(await hasRedesTables())) return [];
  const { rows } = await query<RedeRow>(
    `with due as (
       select r.post_id, r.rede
       from public.content_post_redes r join public.content_posts p on p.id = r.post_id
       where r.status in ('pending', 'processing')
         and r.next_attempt_at <= now()
         and (r.lock_until is null or r.lock_until < now())
         and p.status in ('published', 'failed')
       order by r.next_attempt_at asc
       limit $1
       for update of r skip locked
     )
     update public.content_post_redes r set lock_until = now() + interval '90 seconds'
     from due where r.post_id = due.post_id and r.rede = due.rede
     returning r.*`,
    [limit],
  );
  if (!rows.length) return [];
  const { rows: posts } = await query<ContentPost>(
    `select cp.*, ia.instagram_username as account_username
     from public.content_posts cp left join public.instagram_accounts ia on ia.id = cp.account_id
     where cp.id = any($1::uuid[])`,
    [rows.map((row) => row.post_id)],
  );
  const byId = new Map(posts.map((post) => [post.id, post]));
  return rows.filter((row) => byId.has(row.post_id)).map((row) => ({ ...row, post: byId.get(row.post_id) as ContentPost }));
}

/** Grava o andamento de uma rede (e solta a trava, a não ser que `keepLock`). */
export async function saveRede(
  postId: string,
  rede: RedeExtra,
  patch: Partial<Pick<RedeRow, "status" | "etapa" | "estado" | "external_id" | "permalink" | "last_error" | "attempts" | "published_at">> & { nextAttemptInMs?: number; keepLock?: boolean },
) {
  const sets: string[] = [];
  const values: unknown[] = [postId, rede];
  const add = (column: string, value: unknown) => {
    values.push(column === "estado" ? JSON.stringify(value ?? {}) : value);
    sets.push(`${column} = $${values.length}`);
  };
  for (const key of ["status", "etapa", "estado", "external_id", "permalink", "last_error", "attempts", "published_at"] as const) {
    if (patch[key] !== undefined) add(key, patch[key]);
  }
  if (patch.nextAttemptInMs !== undefined) {
    values.push(Math.max(0, Math.round(patch.nextAttemptInMs / 1000)));
    sets.push(`next_attempt_at = now() + make_interval(secs => $${values.length})`);
  }
  if (!patch.keepLock) sets.push("lock_until = null");
  sets.push("updated_at = now()");
  await query(`update public.content_post_redes set ${sets.join(", ")} where post_id = $1 and rede = $2`, values);
}

export async function getRedeRow(postId: string, rede: RedeExtra): Promise<RedeRow | null> {
  if (!(await hasRedesTables())) return null;
  const { rows } = await query<RedeRow>("select * from public.content_post_redes where post_id = $1 and rede = $2", [postId, rede]);
  return rows[0] ?? null;
}
