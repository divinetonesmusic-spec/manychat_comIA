import { getInstagramAccountById } from "@/lib/db/repositories";
import { saveThreadsConnection, saveYoutubeConnection, getYoutubeConnection } from "@/lib/db/redes";
import { exchangeThreadsCode, getThreadsProfile } from "@/lib/redes/threads";
import { exchangeGoogleCode } from "@/lib/redes/youtube";

/** Erro da conexão com frase pronta para a pessoa. */
export class NetworkConnectError extends Error {}

/** Threads: troca o código pelo token de longa duração, lê o perfil e grava a conexão DESTA conta. */
export async function connectThreadsForAccount(input: { accountId: string; code: string; redirectUri: string }) {
  const account = await getInstagramAccountById(input.accountId);
  if (!account) throw new NetworkConnectError("Conta do Instagram não encontrada. Conecte o Instagram primeiro na tela Perfis.");
  const token = await exchangeThreadsCode(input.code, input.redirectUri);
  const profile = await getThreadsProfile(token.access_token).catch(() => null);
  const threadsUserId = profile?.id ?? token.user_id;
  if (!threadsUserId) throw new NetworkConnectError("O Threads não devolveu o id do perfil. Tente conectar de novo.");
  await saveThreadsConnection({
    accountId: account.id,
    threadsUserId,
    username: profile?.username ?? null,
    accessToken: token.access_token,
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
  });
  return { accountId: account.id, username: profile?.username ?? null };
}

/**
 * YouTube: troca o código pelos tokens do Google e grava a conexão DESTA conta. Sem refresh token (o Google só manda
 * na 1ª autorização ou com prompt=consent) e sem conexão antiga para aproveitar: pede para tentar de novo.
 */
export async function connectYoutubeForAccount(input: { accountId: string; code: string; redirectUri: string }) {
  const account = await getInstagramAccountById(input.accountId);
  if (!account) throw new NetworkConnectError("Conta do Instagram não encontrada. Conecte o Instagram primeiro na tela Perfis.");
  const token = await exchangeGoogleCode(input.code, input.redirectUri);
  if (token.scope && !token.scope.split(/\s+/).includes("https://www.googleapis.com/auth/youtube.upload")) {
    throw new NetworkConnectError("Faltou a permissão de enviar vídeos ao YouTube. Conecte de novo e marque a permissão pedida.");
  }
  const refreshToken = token.refresh_token ?? (await getYoutubeConnection(account.id))?.refresh_token;
  if (!refreshToken) throw new NetworkConnectError("O Google não devolveu a autorização duradoura. Tire o acesso do UaiFlow em myaccount.google.com/permissions e conecte de novo.");
  await saveYoutubeConnection({
    accountId: account.id,
    refreshToken,
    accessToken: token.access_token,
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    scope: token.scope ?? null,
  });
  return { accountId: account.id };
}

/** Mensagem de erro da conexão sem pedaço de token. */
export function safeConnectError(error: unknown) {
  if (error instanceof NetworkConnectError) return error.message;
  const message = error instanceof Error ? error.message : "Erro desconhecido ao conectar.";
  return message.replace(/(access_token|client_secret|code|refresh_token)=[^&\s]+/gi, "$1=***").replace(/^Instagram Graph v\d+\.\d+:\s*/i, "").slice(0, 300);
}
