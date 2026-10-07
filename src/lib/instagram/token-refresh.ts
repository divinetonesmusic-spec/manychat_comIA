import { listInstagramAccounts, updateToken } from "@/lib/db/repositories";
import { refreshLongLivedToken } from "@/lib/instagram/client";

/** Avisar quando faltar menos que isto para o token vencer. */
export const TOKEN_ALERT_DAYS = 10;

export type TokenRefreshResult =
  | { accountId: string; username: string; ok: true; expiresAt: string }
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
