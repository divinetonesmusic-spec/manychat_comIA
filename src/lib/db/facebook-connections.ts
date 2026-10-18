import { query } from "@/lib/db/client";

/**
 * Segunda conexão (opcional) de cada conta do Instagram, feita pelo Login do Facebook (migração 0009).
 * Serve só para a música do Instagram nos Reels. Os tokens daqui NUNCA saem do servidor: para as telas, use
 * listFacebookConnectedAccountIds (só os ids das contas) ou toPublicFacebookConnection.
 */
export type FacebookConnection = {
  account_id: string;
  instagram_user_id: string;
  facebook_user_id: string | null;
  page_id: string;
  page_name: string | null;
  user_access_token: string;
  user_token_expires_at: string | null;
  page_access_token: string | null;
  last_token_refresh_at: string | null;
  connected_at: string;
  updated_at: string;
};

/** O que uma tela pode saber da conexão pelo Facebook (sem token). */
export type PublicFacebookConnection = { accountId: string; pageName: string | null; userTokenExpiresAt: string | null };

export function toPublicFacebookConnection(connection: FacebookConnection): PublicFacebookConnection {
  return {
    accountId: connection.account_id,
    pageName: connection.page_name ?? null,
    userTokenExpiresAt: connection.user_token_expires_at ? new Date(connection.user_token_expires_at).toISOString() : null,
  };
}

/** Aviso quando a 0009 ainda não foi colada no Supabase. */
export const MIGRATION_0009_MISSING = "Falta colar a atualização 0009 no Supabase para usar a música do Instagram.";

/**
 * A tabela da 0009 existe? Confere uma vez por processo e guarda o "sim"; o "não" é conferido de novo a cada minuto
 * (para pegar a migração assim que for colada). Mesmo jeito das colunas novas de content_posts.
 */
let tableCache: { exists: boolean; checkedAt: number } | null = null;
export async function hasFacebookConnectionsTable() {
  if (tableCache && (tableCache.exists || Date.now() - tableCache.checkedAt < 60_000)) return tableCache.exists;
  const { rows } = await query<{ exists: boolean }>("select to_regclass('public.instagram_facebook_connections') is not null as exists");
  tableCache = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
  return tableCache.exists;
}

export async function getFacebookConnection(accountId: string | null | undefined): Promise<FacebookConnection | null> {
  if (!accountId || !(await hasFacebookConnectionsTable())) return null;
  const { rows } = await query<FacebookConnection>("select * from public.instagram_facebook_connections where account_id = $1", [accountId]);
  return rows[0] ?? null;
}

export async function listFacebookConnections(): Promise<FacebookConnection[]> {
  if (!(await hasFacebookConnectionsTable())) return [];
  const { rows } = await query<FacebookConnection>("select * from public.instagram_facebook_connections order by connected_at asc");
  return rows;
}

/** Só os ids das contas que já têm a conexão pelo Facebook (para as telas mostrarem o botão certo). */
export async function listFacebookConnectedAccountIds(): Promise<string[]> {
  if (!(await hasFacebookConnectionsTable())) return [];
  const { rows } = await query<{ account_id: string }>("select account_id from public.instagram_facebook_connections");
  return rows.map((row) => row.account_id);
}

/** Grava (ou troca) a conexão pelo Facebook da conta. Não mexe em public.instagram_accounts (nem na conta principal). */
export async function saveFacebookConnection(input: {
  accountId: string;
  instagramUserId: string;
  facebookUserId: string | null;
  pageId: string;
  pageName: string | null;
  userAccessToken: string;
  userTokenExpiresAt: Date | null;
  pageAccessToken: string | null;
}) {
  const { rows } = await query<FacebookConnection>(
    `insert into public.instagram_facebook_connections (
       account_id, instagram_user_id, facebook_user_id, page_id, page_name, user_access_token, user_token_expires_at,
       page_access_token, last_token_refresh_at, connected_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), now())
     on conflict (account_id) do update set
       instagram_user_id = excluded.instagram_user_id,
       facebook_user_id = excluded.facebook_user_id,
       page_id = excluded.page_id,
       page_name = excluded.page_name,
       user_access_token = excluded.user_access_token,
       user_token_expires_at = excluded.user_token_expires_at,
       page_access_token = excluded.page_access_token,
       last_token_refresh_at = now(),
       connected_at = now(),
       updated_at = now()
     returning *`,
    [input.accountId, input.instagramUserId, input.facebookUserId, input.pageId, input.pageName, input.userAccessToken, input.userTokenExpiresAt, input.pageAccessToken],
  );
  return rows[0];
}

/** Grava os tokens renovados (o da Página só muda quando veio um novo). */
export async function updateFacebookTokens(input: { accountId: string; userAccessToken: string; userTokenExpiresAt: Date | null; pageAccessToken: string | null }) {
  await query(
    `update public.instagram_facebook_connections
     set user_access_token = $2, user_token_expires_at = $3, page_access_token = coalesce($4, page_access_token),
         last_token_refresh_at = now(), updated_at = now()
     where account_id = $1`,
    [input.accountId, input.userAccessToken, input.userTokenExpiresAt, input.pageAccessToken],
  );
}

/**
 * Token para falar com a Meta por esta conexão: o da pessoa enquanto vale (a Audio API pede o token da pessoa), senão o
 * da Página (não vence). Os dois servem para a conta do Instagram ligada à Página. Sem nenhum válido: null.
 */
export function facebookAccessToken(connection: FacebookConnection, now = Date.now()) {
  const expires = connection.user_token_expires_at ? new Date(connection.user_token_expires_at).getTime() : Number.POSITIVE_INFINITY;
  if (connection.user_access_token && expires - now > 5 * 60_000) return connection.user_access_token;
  return connection.page_access_token || null;
}
