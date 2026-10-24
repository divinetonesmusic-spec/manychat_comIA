import { query } from "@/lib/db/client";
import { listInstagramAccounts, updateToken } from "@/lib/db/repositories";
import { listFacebookConnections, updateFacebookTokens } from "@/lib/db/facebook-connections";
import { listThreadsConnections, updateThreadsToken } from "@/lib/db/redes";
import { refreshLongLivedToken, withMetaDeadline } from "@/lib/instagram/client";
import { exchangeForLongLivedUserToken, getFacebookPageToken } from "@/lib/facebook/client";
import { refreshThreadsToken } from "@/lib/redes/threads";
import { tokenIssuedRecently, tokenRefreshAlerts, type TokenAlert, type TokenRefreshResult } from "@/lib/instagram/token-refresh";
import { notifyTokenAlerts } from "@/lib/notify";
import { redactSecrets } from "@/lib/secrets";

/**
 * Renovação dos tokens no relógio (v133, U-SEG-05). Antes, a renovação só rodava no /api/token/refresh (1 vez por semana,
 * todas as contas numa função só: com várias contas a função do Netlify podia ser cortada antes das últimas). Agora o
 * relógio de cada minuto renova, no tempo que sobrar, as conexões que precisam (uma por vez, com prazo):
 * - TODAS as contas do Instagram conectadas (não só a padrão), as conexões pelo Facebook (música) e as do Threads;
 * - "precisa" = o token tem mais de 7 dias (vence em menos de 53) e não foi renovado com sucesso nos últimos 7 dias;
 * - deu erro: tenta de novo depois de 6 h;
 * - aviso no Telegram quando a renovação falha ou falta pouco (menos de 10 dias) para vencer, no máximo 1 por conexão a
 *   cada 24 h (se o Telegram não estiver configurado, nada é enviado).
 * O estado de cada conexão fica em public.app_status (chave "token:<tipo>:<conta>"; a tabela vem da 0004/0007/0008).
 * Roda no máximo a cada 15 min (entre todos os servidores). Nunca lança erro e nunca devolve token.
 */
export const TOKEN_CLOCK_EVERY_MINUTES = 15;
export const TOKEN_REFRESH_AFTER_DAYS = 7;
export const TOKEN_RETRY_HOURS = 6;
export const TOKEN_ALERT_EVERY_HOURS = 24;
const TOKEN_LIFETIME_DAYS = 60;
const DAY = 86_400_000;
/** Menos que isto de tempo no relógio: nem começa uma renovação (a Meta pode levar alguns segundos). */
const MIN_TIME_FOR_REFRESH_MS = 2500;

export type TokenKind = "instagram" | "facebook" | "threads";

export type TokenItem = {
  kind: TokenKind;
  accountId: string;
  username: string;
  expiresAt: string | null;
  lastRefreshAt: string | null;
  /** Renova e salva; devolve o vencimento novo (ISO) ou null quando a Meta não informa. */
  refresh: (now: Date) => Promise<string | null>;
};

type ItemState = { okEm?: string; erroEm?: string; erro?: string; avisoEm?: string };

export type TokenClockResult = {
  ran: boolean;
  renovadas: number;
  falhas: number;
  avisos: number;
  pendentes: number;
  motivo?: "cedo" | "sem_tempo" | "sem_migracao" | "erro";
};

let lastRunInProcess = 0;

/** Só para os testes: esquece a última rodada deste processo. */
export function resetTokenClockMemory() {
  lastRunInProcess = 0;
}

export async function runTokenClock(options: { deadline: number; origin?: string | null; now?: Date; force?: boolean }): Promise<TokenClockResult> {
  const out: TokenClockResult = { ran: false, renovadas: 0, falhas: 0, avisos: 0, pendentes: 0 };
  const now = options.now ?? new Date();
  const timeLeft = () => options.deadline - Date.now();
  if (!options.force && Date.now() - lastRunInProcess < TOKEN_CLOCK_EVERY_MINUTES * 60_000) return { ...out, motivo: "cedo" };
  if (timeLeft() < 800) return { ...out, motivo: "sem_tempo" };

  try {
    // Só um servidor por vez a cada 15 min: a linha 'tokens_relogio' só muda se já passou o intervalo.
    const claimed = await query(
      `insert into public.app_status (chave, valor, atualizado_em) values ('tokens_relogio', '{}'::jsonb, now())
       on conflict (chave) do update set atualizado_em = now()
         where public.app_status.atualizado_em < now() - make_interval(mins => $1)`,
      [options.force ? 0 : TOKEN_CLOCK_EVERY_MINUTES],
    );
    lastRunInProcess = Date.now();
    if (!claimed.rowCount) return { ...out, motivo: "cedo" };
    out.ran = true;

    const items = await listTokenItems();
    const states = await readStates(items);
    const results: TokenRefreshResult[] = [];

    for (const item of items) {
      const state = states.get(stateKey(item)) ?? {};
      if (!isDue(item, state, now)) continue;
      if (timeLeft() < MIN_TIME_FOR_REFRESH_MS) {
        out.pendentes += 1; // fica para o próximo minuto
        continue;
      }
      const base = { accountId: item.accountId, username: item.username };
      try {
        const expiresAt = await withMetaDeadline(options.deadline - 500, () => item.refresh(now));
        results.push({ ...base, ok: true, expiresAt });
        const next = { ...state, okEm: now.toISOString(), erro: undefined, erroEm: undefined };
        states.set(stateKey(item), next);
        await writeState(item, next);
        out.renovadas += 1;
      } catch (error) {
        const erro = redactSecrets(error instanceof Error ? error.message : String(error || "Erro desconhecido."));
        results.push({ ...base, ok: false, error: erro, tokenExpiresAt: item.expiresAt });
        const next = { ...state, erro, erroEm: now.toISOString() };
        states.set(stateKey(item), next);
        await writeState(item, next);
        out.falhas += 1;
      }
    }

    // Avisos: falhas desta rodada e conexões vencendo em menos de 10 dias (renovadas ou não), 1 por conexão a cada 24 h.
    const attempted = new Set(results.map((result) => result.accountId + result.username));
    const notAttempted: TokenRefreshResult[] = items
      .filter((item) => !attempted.has(item.accountId + item.username))
      .map((item) => ({ accountId: item.accountId, username: item.username, ok: true, expiresAt: item.expiresAt }));
    const alerts = tokenRefreshAlerts([...results, ...notAttempted], now);
    const byLabel = new Map(items.map((item) => [item.accountId + item.username, item]));
    const toSend: Array<{ alert: TokenAlert; item: TokenItem }> = [];
    for (const alert of alerts) {
      const item = byLabel.get(alert.accountId + alert.username);
      if (!item) continue;
      const state = states.get(stateKey(item)) ?? {};
      if (state.avisoEm && now.getTime() - new Date(state.avisoEm).getTime() < TOKEN_ALERT_EVERY_HOURS * 3600_000) continue;
      toSend.push({ alert, item });
    }
    if (toSend.length && timeLeft() > 600) {
      const sent = await notifyTokenAlerts(toSend.map((entry) => entry.alert), options.origin);
      if (sent.ok) {
        out.avisos = toSend.length;
        for (const { item } of toSend) await writeState(item, { ...(states.get(stateKey(item)) ?? {}), avisoEm: now.toISOString() });
      }
    }
    return out;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "42P01") return { ...out, motivo: "sem_migracao" };
    console.warn("[token] renovação no relógio falhou:", redactSecrets(error instanceof Error ? error.message : String(error), 200));
    return { ...out, motivo: "erro" };
  }
}

/** Precisa renovar agora? (Não devolve nada sobre o token em si, só datas.) */
export function isDue(item: Pick<TokenItem, "expiresAt" | "lastRefreshAt">, state: ItemState, now: Date) {
  if (tokenIssuedRecently({ last_token_refresh_at: item.lastRefreshAt, token_expires_at: item.expiresAt }, now)) return false;
  if (state.okEm && now.getTime() - new Date(state.okEm).getTime() < TOKEN_REFRESH_AFTER_DAYS * DAY) return false;
  if (state.erroEm && now.getTime() - new Date(state.erroEm).getTime() < TOKEN_RETRY_HOURS * 3600_000) return false;
  const lastRefresh = item.lastRefreshAt ? new Date(item.lastRefreshAt).getTime() : Number.NaN;
  if (Number.isFinite(lastRefresh) && now.getTime() - lastRefresh < TOKEN_REFRESH_AFTER_DAYS * DAY) return false;
  if (!item.expiresAt) return true;
  const expires = new Date(item.expiresAt).getTime();
  if (!Number.isFinite(expires)) return true;
  return expires - now.getTime() < (TOKEN_LIFETIME_DAYS - TOKEN_REFRESH_AFTER_DAYS) * DAY;
}

/** Todas as conexões com token que vence: contas do Instagram, conexões pelo Facebook e do Threads. */
export async function listTokenItems(): Promise<TokenItem[]> {
  const accounts = await listInstagramAccounts();
  const usernames = new Map(accounts.map((account) => [account.id, account.instagram_username]));
  const items: TokenItem[] = accounts.map((account) => ({
    kind: "instagram",
    accountId: account.id,
    username: account.instagram_username,
    expiresAt: toIso(account.token_expires_at),
    lastRefreshAt: toIso(account.last_token_refresh_at),
    refresh: async (now) => {
      if (!account.instagram_access_token) throw new Error("Conta sem token salvo. Conecte o perfil de novo.");
      const token = await refreshLongLivedToken(account.instagram_access_token);
      const expiresAt = new Date(now.getTime() + token.expires_in * 1000);
      await updateToken({ accessToken: token.access_token, expiresAt, accountId: account.id });
      return expiresAt.toISOString();
    },
  }));

  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    for (const connection of await listFacebookConnections().catch(() => [])) {
      items.push({
        kind: "facebook",
        accountId: connection.account_id,
        username: `${usernames.get(connection.account_id) ?? connection.instagram_user_id} (Facebook)`,
        expiresAt: toIso(connection.user_token_expires_at),
        lastRefreshAt: toIso(connection.last_token_refresh_at),
        refresh: async (now) => {
          const token = await exchangeForLongLivedUserToken(connection.user_access_token);
          const expiresAt = token.expires_in ? new Date(now.getTime() + token.expires_in * 1000) : null;
          const page = await getFacebookPageToken(connection.page_id, token.access_token).catch(() => null);
          await updateFacebookTokens({ accountId: connection.account_id, userAccessToken: token.access_token, userTokenExpiresAt: expiresAt, pageAccessToken: page?.access_token ?? null });
          return expiresAt ? expiresAt.toISOString() : null;
        },
      });
    }
  }

  if (process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET) {
    for (const connection of await listThreadsConnections().catch(() => [])) {
      items.push({
        kind: "threads",
        accountId: connection.account_id,
        username: `${usernames.get(connection.account_id) ?? connection.threads_username ?? connection.threads_user_id} (Threads)`,
        expiresAt: toIso(connection.token_expires_at),
        lastRefreshAt: toIso(connection.last_token_refresh_at),
        refresh: async (now) => {
          const token = await refreshThreadsToken(connection.access_token);
          const expiresAt = token.expires_in ? new Date(now.getTime() + token.expires_in * 1000) : null;
          await updateThreadsToken({ accountId: connection.account_id, accessToken: token.access_token, expiresAt });
          return expiresAt ? expiresAt.toISOString() : null;
        },
      });
    }
  }

  // As que vencem antes vão primeiro (se o tempo do relógio acabar, as mais urgentes já foram).
  return items.sort((a, b) => (a.expiresAt ? new Date(a.expiresAt).getTime() : 0) - (b.expiresAt ? new Date(b.expiresAt).getTime() : 0));
}

function stateKey(item: Pick<TokenItem, "kind" | "accountId">) {
  return `token:${item.kind}:${item.accountId}`;
}

async function readStates(items: TokenItem[]) {
  const map = new Map<string, ItemState>();
  if (!items.length) return map;
  const { rows } = await query<{ chave: string; valor: ItemState }>("select chave, valor from public.app_status where chave = any($1::text[])", [items.map(stateKey)]);
  for (const row of rows) map.set(row.chave, row.valor ?? {});
  return map;
}

async function writeState(item: TokenItem, state: ItemState) {
  const clean = Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined));
  await query(
    `insert into public.app_status (chave, valor, atualizado_em) values ($1, $2::jsonb, now())
     on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
    [stateKey(item), JSON.stringify(clean)],
  );
}

function toIso(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
