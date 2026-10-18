import { NextRequest, NextResponse } from "next/server";
import { FB_OAUTH_AUTHORIZE_URL, getAppBaseUrl } from "@/lib/env";
import { safeNextPath } from "@/lib/auth";
import { hrefWithAccount } from "@/lib/account-routing";
import { readUaiFlowSession } from "@/lib/session";
import { getInstagramAccountById } from "@/lib/db/repositories";
import { hasFacebookConnectionsTable, MIGRATION_0009_MISSING } from "@/lib/db/facebook-connections";
import { FACEBOOK_SCOPES } from "@/lib/facebook/client";
import { createFacebookState, setFacebookStateCookie } from "@/lib/facebook/oauth-state";
import { facebookRedirectUri, isUuid } from "@/lib/facebook/connect";

export const runtime = "nodejs";

/**
 * GET /api/oauth/facebook/login?conta=<id da conta>&next=/perfis
 * Começa a conexão pelo Facebook (só para a música do Instagram) de UMA conta já conectada. Só com a sessão do UaiFlow
 * (o proxy já barra; a rota confere de novo). O state é aleatório e fica num cookie httpOnly (o callback confere).
 */
export async function GET(request: NextRequest) {
  const appBaseUrl = getAppBaseUrl(request.url);
  const session = await readUaiFlowSession(request);
  if (!session.ok) {
    const login = new URL("/login", `${appBaseUrl}/`);
    login.searchParams.set("next", "/perfis");
    return NextResponse.redirect(login);
  }

  const params = request.nextUrl.searchParams;
  const accountId = params.get("conta") || params.get("accountId") || "";
  const back = (path: string, error: string) => {
    const url = new URL(path, `${appBaseUrl}/`);
    url.searchParams.set("facebook_error", error);
    return session.applyCookies(NextResponse.redirect(url));
  };

  const account = isUuid(accountId) ? await getInstagramAccountById(accountId) : null;
  if (!account) return back("/perfis", "Conta do Instagram não encontrada. Escolha a conta na tela Perfis e tente de novo.");
  const next = safeNextPath(params.get("next"), hrefWithAccount("/perfis", account.id));
  if (!(await hasFacebookConnectionsTable())) return back(next, MIGRATION_0009_MISSING);
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId || !process.env.FACEBOOK_APP_SECRET) {
    return back(next, "Falta configurar FACEBOOK_APP_ID e FACEBOOK_APP_SECRET no servidor (veja docs/musica-instagram.md).");
  }

  const state = createFacebookState(account.id, next);
  const url = new URL(FB_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", facebookRedirectUri(appBaseUrl));
  url.searchParams.set("state", state.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", FACEBOOK_SCOPES.join(","));

  return session.applyCookies(setFacebookStateCookie(NextResponse.redirect(url), state));
}
