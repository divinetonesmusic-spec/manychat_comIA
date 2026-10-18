import { getInstagramAccountById } from "@/lib/db/repositories";
import { saveFacebookConnection, type PublicFacebookConnection, toPublicFacebookConnection } from "@/lib/db/facebook-connections";
import { exchangeFacebookCode, getFacebookUser, listFacebookPages } from "@/lib/facebook/client";

/** Endereço de volta do Login do Facebook (FACEBOOK_REDIRECT_URI, ou o padrão do site). Cadastre este no app da Meta. */
export function facebookRedirectUri(appBaseUrl: string) {
  return process.env.FACEBOOK_REDIRECT_URI || `${appBaseUrl}/api/oauth/facebook/callback`;
}

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export class FacebookConnectError extends Error {}

/**
 * Troca o código pelo token de longa duração, acha a Página ligada a ESTA conta do Instagram
 * (instagram_business_account.id igual ao id da conta) e grava a conexão. Nunca troca a conta principal.
 */
export async function connectFacebookForAccount(input: { accountId: string; code: string; redirectUri: string }): Promise<PublicFacebookConnection> {
  const account = await getInstagramAccountById(input.accountId);
  if (!account) throw new FacebookConnectError("Conta do Instagram não encontrada. Conecte o Instagram primeiro na tela Perfis.");

  const token = await exchangeFacebookCode(input.code, input.redirectUri);
  const [user, pages] = await Promise.all([getFacebookUser(token.access_token).catch(() => null), listFacebookPages(token.access_token)]);
  const page = pages.find((item) => item.instagram_business_account?.id === account.instagram_user_id);
  if (!page) {
    throw new FacebookConnectError(
      `Não achei uma Página do Facebook ligada a @${account.instagram_username}. Ligue a conta do Instagram a uma Página (no app do Instagram ou no Meta Business Suite) e, no login do Facebook, marque essa Página.`,
    );
  }

  const saved = await saveFacebookConnection({
    accountId: account.id,
    instagramUserId: account.instagram_user_id,
    facebookUserId: user?.id ?? null,
    pageId: page.id,
    pageName: page.name ?? null,
    userAccessToken: token.access_token,
    userTokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    pageAccessToken: page.access_token ?? null,
  });
  return toPublicFacebookConnection(saved);
}
