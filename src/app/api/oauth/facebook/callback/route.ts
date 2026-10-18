import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { readUaiFlowSession } from "@/lib/session";
import { clearFacebookStateCookie, FACEBOOK_INVALID_STATE_MESSAGE, verifyFacebookState } from "@/lib/facebook/oauth-state";
import { connectFacebookForAccount, facebookRedirectUri, FacebookConnectError } from "@/lib/facebook/connect";

export const runtime = "nodejs";

/**
 * Volta do Login do Facebook. Exige a sessão do UaiFlow (o proxy já barra; a rota confere de novo) e o state igual
 * ao do cookie httpOnly (criado em /api/oauth/facebook/login, 10 min). Sem isso, não troca o código.
 * O cookie do state é apagado em qualquer resultado. Nunca mexe na conta principal.
 */
export async function GET(request: NextRequest) {
  const appBaseUrl = getAppBaseUrl(request.url);
  const session = await readUaiFlowSession(request);
  if (!session.ok) {
    const login = new URL("/login", `${appBaseUrl}/`);
    login.searchParams.set("next", "/perfis");
    return clearFacebookStateCookie(NextResponse.redirect(login));
  }

  const params = request.nextUrl.searchParams;
  const back = (path: string, values: Record<string, string>) => {
    const url = new URL(path, `${appBaseUrl}/`);
    for (const [name, value] of Object.entries(values)) url.searchParams.set(name, value);
    return clearFacebookStateCookie(session.applyCookies(NextResponse.redirect(url)));
  };

  const state = verifyFacebookState(request, params.get("state"));
  if (!state) return back("/perfis", { facebook_error: FACEBOOK_INVALID_STATE_MESSAGE });

  const error = params.get("error_description") || params.get("error_reason") || params.get("error");
  if (error) return back(state.next, { facebook_error: error.slice(0, 300) });
  const code = params.get("code");
  if (!code) return back(state.next, { facebook_error: "missing_code" });

  try {
    await connectFacebookForAccount({ accountId: state.accountId, code, redirectUri: facebookRedirectUri(appBaseUrl) });
    return back(state.next, { facebook_connected: "1" });
  } catch (caught) {
    const message = caught instanceof FacebookConnectError
      ? caught.message
      : (caught instanceof Error ? caught.message : "Erro desconhecido ao conectar pelo Facebook").replace(/access_token=[^&\s]+/gi, "access_token=***");
    console.error("[oauth-facebook] falhou", message);
    return back(state.next, { facebook_error: message.slice(0, 300) });
  }
}
