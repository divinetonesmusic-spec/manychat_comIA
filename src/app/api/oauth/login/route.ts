import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl, IG_OAUTH_AUTHORIZE_URL, requireEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/auth";
import { createOAuthState, verifyLoginLinkToken } from "@/lib/oauth-state";
import { readUaiFlowSession } from "@/lib/session";

/**
 * Começa o login do Instagram. Só para quem está logado no UaiFlow OU traz o link assinado (`t`) que a
 * tela Perfis gera (para conectar a conta em outro navegador/computador). Sem nenhum dos dois → /login.
 * O `state` mandado ao Instagram é assinado e vence em 30 min (o /api/oauth/callback confere).
 */
export async function GET(request: NextRequest) {
  const appBaseUrl = getAppBaseUrl(request.url);
  const linkToken = request.nextUrl.searchParams.get("t");
  const fromLink = linkToken ? verifyLoginLinkToken(linkToken) : null;

  let next: string;
  let applyCookies = (response: NextResponse) => response;
  if (fromLink) {
    next = fromLink.next;
  } else {
    const session = await readUaiFlowSession(request);
    if (!session.ok) {
      const login = new URL("/login", `${appBaseUrl}/`);
      login.searchParams.set("next", "/perfis");
      if (linkToken) login.searchParams.set("error", "expired"); // link vencido (30 min) ou adulterado
      return NextResponse.redirect(login);
    }
    next = safeNextPath(request.nextUrl.searchParams.get("next"), "/perfis");
    applyCookies = session.applyCookies;
  }

  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${appBaseUrl}/api/oauth/callback`;
  const url = new URL(IG_OAUTH_AUTHORIZE_URL);

  url.searchParams.set("client_id", requireEnv("INSTAGRAM_APP_ID"));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", createOAuthState(next));
  url.searchParams.set(
    "scope",
    "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights",
  );

  return applyCookies(NextResponse.redirect(url));
}
