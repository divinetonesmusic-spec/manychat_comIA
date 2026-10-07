import { listInstagramAccounts, updateToken } from "@/lib/db/repositories";
import { refreshLongLivedToken } from "@/lib/instagram/client";

/** Avisar quando faltar menos que isto para o token vencer. */
export const TOKEN_ALERT_DAYS = 10;

/** A Meta só renova token de longa duração que tenha pelo menos 24 h de vida. */
export const TOKEN_MIN_AGE_MS = 24 * 3600_000;
/** Token de longa duração vale 60 dias: vencimento além de 59 dias = emitido há menos de 24 h. */
const FRESH_TOKEN_EXPIRY_MS = 59 * 86_400_000;

export type TokenRefreshResult =
  /** `skipped`: token com menos de 24 h (acabou de ser conectado ou renovado); não há o que renovar ainda. */
  | { accountId: string; username: string; ok: true; expiresAt: string | null; skipped?: boolean }
  | { accountId: string; username: string; ok: false; error: string; tokenExpiresAt: string | null };

/**
 * Renova o token de TODAS as contas do Instagram conectadas (não só a padrão).
 * Cada conta tem a sua tentativa: se uma falhar, as outras seguem. Nunca devolve token.
 */
export async function refreshAllInstagramTokens(): Promise<TokenRefreshResult[]> {
  const accounts = await listInstagramAccounts();
  const results: TokenRefreshResult[] = [];
  for (const account of accounts) {
    const base = { accountId: account.id, username: account.instagram_username };
    if (tokenIssuedRecently(account)) {
      results.push({ ...base, ok: true, skipped: true, expiresAt: toIso(account.token_expires_at) });
      continue;
    }
    try {
      if (!account.instagram_access_token) throw new Error("Conta sem token salvo. Conecte o perfil de novo.");
      const token = await refreshLongLivedToken(account.instagram_access_token);
      const expiresAt = new Date(Date.now() + token.expires_in * 1000);
      await updateToken({ accessToken: token.access_token, expiresAt, accountId: account.id });
      results.push({ ...base, ok: true, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      results.push({ ...base, ok: false, error: safeErrorMessage(error), tokenExpiresAt: toIso(account.token_expires_at) });
    }
  }
  return results;
}

/**
 * Token emitido ou renovado há menos de 24 h: a Meta recusaria a renovação (falso "não consegui renovar").
 * Usa a hora da última renovação e o vencimento (60 dias a partir da emissão). created_at e updated_at não
 * servem: reconectar não muda o created_at, e o updated_at muda com qualquer alteração da conta.
 */
export function tokenIssuedRecently(
  account: { last_token_refresh_at?: string | Date | null; token_expires_at?: string | Date | null },
  now = new Date(),
) {
  const lastRefresh = account.last_token_refresh_at ? new Date(account.last_token_refresh_at).getTime() : Number.NaN;
  if (Number.isFinite(lastRefresh) && now.getTime() - lastRefresh < TOKEN_MIN_AGE_MS) return true;
  const expires = account.token_expires_at ? new Date(account.token_expires_at).getTime() : Number.NaN;
  return Number.isFinite(expires) && expires - now.getTime() > FRESH_TOKEN_EXPIRY_MS;
}

export type TokenAlert = {
  accountId: string;
  username: string;
  motivo: "falha_na_renovacao" | "vence_em_breve";
  /** Dias até o token vencer (null quando não há data salva). */
  diasParaVencer: number | null;
  detalhe: string;
};

/**
 * Quem precisa de aviso depois da renovação: contas cuja renovação falhou e contas cujo token vence em
 * menos de TOKEN_ALERT_DAYS dias. Só calcula; o envio do aviso (Telegram) fica a cargo de quem chama.
 */
export function tokenRefreshAlerts(results: TokenRefreshResult[], now = new Date()): TokenAlert[] {
  const alerts: TokenAlert[] = [];
  for (const result of results) {
    const expiresAt = result.ok ? result.expiresAt : result.tokenExpiresAt;
    const days = expiresAt ? Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000) : null;
    if (!result.ok) {
      alerts.push({ accountId: result.accountId, username: result.username, motivo: "falha_na_renovacao", diasParaVencer: days, detalhe: result.error });
    } else if (days !== null && days < TOKEN_ALERT_DAYS) {
      alerts.push({ accountId: result.accountId, username: result.username, motivo: "vence_em_breve", diasParaVencer: days, detalhe: `O token vence em ${days} dia(s).` });
    }
  }
  return alerts;
}

/** Mensagem de erro sem nenhum pedaço de token (o endereço da renovação leva o token na URL). */
function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Erro desconhecido.");
  return message.replace(/access_token=[^&\s]+/gi, "access_token=***").replace(/IG[A-Za-z0-9_-]{20,}/g, "***").slice(0, 300);
}

function toIso(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
