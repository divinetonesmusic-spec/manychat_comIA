import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { safeNextPath } from "@/lib/auth";
import { hrefWithAccount } from "@/lib/account-routing";
import { readUaiFlowSession } from "@/lib/session";
import { getInstagramAccountById } from "@/lib/db/repositories";
import { hasRedesTables, MIGRATION_0010_MISSING } from "@/lib/db/redes";
import { isUuid } from "@/lib/facebook/connect";
import {
  clearNetworkStateCookie,
  createNetworkState,
  setNetworkStateCookie,
  THREADS_STATE,
  verifyNetworkState,
  YOUTUBE_STATE,
  type NetworkStateConfig,
} from "@/lib/oauth/network-state";
import { threadsAuthorizeUrl, threadsRedirectUri } from "@/lib/redes/threads";
import { youtubeAuthorizeUrl, youtubeRedirectUri } from "@/lib/redes/youtube";
import { connectThreadsForAccount, connectYoutubeForAccount, safeConnectError } from "@/lib/redes/connect";

/**
 * Conexão do Threads e do YouTube: o mesmo jeito do Login do Facebook. Só com a sessão do UaiFlow (o proxy já barra;
 * a rota confere de novo), state aleatório num cookie httpOnly (10 min) conferido na volta, cookie apagado em qualquer
 * resultado. Nunca mexe na conta principal nem na conexão do Instagram.
 */
type NetworkOAuth = {
  /** prefixo dos parâmetros da volta: threads_connected / threads_error, youtube_connected / youtube_error */
  param: "threads" | "youtube";
  state: NetworkStateConfig;
  envMissing: () => string | null;
  authorizeUrl: (input: { appBaseUrl: string; state: string }) => URL;
  connect: (input: { accountId: string; code: string; appBaseUrl: string }) => Promise<unknown>;
  invalidState: string;
};

export const THREADS_OAUTH: NetworkOAuth = {
  param: "threads",
  state: THREADS_STATE,
  envMissing: () => (process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET ? null : "Falta configurar THREADS_APP_ID e THREADS_APP_SECRET no servidor (veja docs/redes-e-vendas.md)."),
  authorizeUrl: ({ appBaseUrl, state }) => threadsAuthorizeUrl({ appId: process.env.THREADS_APP_ID as string, redirectUri: threadsRedirectUri(appBaseUrl), state }),
  connect: ({ accountId, code, appBaseUrl }) => connectThreadsForAccount({ accountId, code, redirectUri: threadsRedirectUri(appBaseUrl) }),
  invalidState: "O link de conexão com o Threads venceu ou não é válido. Comece de novo pelo botão «Conectar Threads».",
};

export const YOUTUBE_OAUTH: NetworkOAuth = {
  param: "youtube",
  state: YOUTUBE_STATE,
  envMissing: () => (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? null : "Falta configurar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor (veja docs/redes-e-vendas.md)."),
  authorizeUrl: ({ appBaseUrl, state }) => youtubeAuthorizeUrl({ clientId: process.env.GOOGLE_CLIENT_ID as string, redirectUri: youtubeRedirectUri(appBaseUrl), state }),
  connect: ({ accountId, code, appBaseUrl }) => connectYoutubeForAccount({ accountId, code, redirectUri: youtubeRedirectUri(appBaseUrl) }),
  invalidState: "O link de conexão com o YouTube venceu ou não é válido. Comece de novo pelo botão «Conectar YouTube».",
};

/** GET /api/oauth/<rede>/login?conta=<id da conta>&next=/perfis */
export function networkLogin(config: NetworkOAuth) {
  return async function GET(request: NextRequest) {
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
      url.searchParams.set(`${config.param}_error`, error);
      return session.applyCookies(NextResponse.redirect(url));
    };
    const account = isUuid(accountId) ? await getInstagramAccountById(accountId) : null;
    if (!account) return back("/perfis", "Conta do Instagram não encontrada. Escolha a conta na tela Perfis e tente de novo.");
    const next = safeNextPath(params.get("next"), hrefWithAccount("/perfis", account.id));
    if (!(await hasRedesTables())) return back(next, MIGRATION_0010_MISSING);
    const missing = config.envMissing();
    if (missing) return back(next, missing);

    const state = createNetworkState(account.id, next);
    const url = config.authorizeUrl({ appBaseUrl, state: state.state });
    return session.applyCookies(setNetworkStateCookie(config.state, NextResponse.redirect(url), state));
  };
}

/** GET /api/oauth/<rede>/callback?code=&state= */
export function networkCallback(config: NetworkOAuth) {
  return async function GET(request: NextRequest) {
    const appBaseUrl = getAppBaseUrl(request.url);
    const session = await readUaiFlowSession(request);
    if (!session.ok) {
      const login = new URL("/login", `${appBaseUrl}/`);
      login.searchParams.set("next", "/perfis");
      return clearNetworkStateCookie(config.state, NextResponse.redirect(login));
    }
    const params = request.nextUrl.searchParams;
    const back = (path: string, values: Record<string, string>) => {
      const url = new URL(path, `${appBaseUrl}/`);
      for (const [name, value] of Object.entries(values)) url.searchParams.set(name, value);
      return clearNetworkStateCookie(config.state, session.applyCookies(NextResponse.redirect(url)));
    };

    const state = verifyNetworkState(config.state, request, params.get("state"));
    if (!state) return back("/perfis", { [`${config.param}_error`]: config.invalidState });

    const error = params.get("error_description") || params.get("error_reason") || params.get("error");
    if (error) return back(state.next, { [`${config.param}_error`]: error.slice(0, 300) });
    const code = params.get("code");
    if (!code) return back(state.next, { [`${config.param}_error`]: "missing_code" });

    try {
      await config.connect({ accountId: state.accountId, code, appBaseUrl });
      return back(state.next, { [`${config.param}_connected`]: "1" });
    } catch (caught) {
      const message = safeConnectError(caught);
      console.error(`[oauth-${config.param}] falhou`, message);
      return back(state.next, { [`${config.param}_error`]: message });
    }
  };
}
