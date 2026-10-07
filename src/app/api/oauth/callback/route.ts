import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { saveInstagramConfig } from "@/lib/db/repositories";
import { verifyOAuthState } from "@/lib/oauth-state";
import {
  exchangeCodeForLongToken,
  getInstagramProfile,
  subscribeWebhooks,
} from "@/lib/instagram/client";

export const runtime = "nodejs";

const INVALID_STATE_MESSAGE = "O link de conexão com o Instagram venceu ou não é válido. Abra a conexão de novo pela tela Perfis.";

/**
 * Volta do Instagram. Continua pública (o Instagram chama direto), mas só aceita `state` assinado pelo
 * UaiFlow e dentro da validade (30 min). Sem isso, não troca o código e volta para /perfis com o erro.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error_description") || request.nextUrl.searchParams.get("error");
  const appBaseUrl = getAppBaseUrl(request.url);
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));

  if (!state) {
    return redirectBack(appBaseUrl, "/perfis", { instagram_error: INVALID_STATE_MESSAGE });
  }
  const next = state.next;

  if (error) {
    return redirectBack(appBaseUrl, next, { instagram_error: error });
  }

  if (!code) {
    return redirectBack(appBaseUrl, next, { instagram_error: "missing_code" });
  }

  try {
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${appBaseUrl}/api/oauth/callback`;
    const token = await exchangeCodeForLongToken(code, redirectUri);
    const profile = await getInstagramProfile(token.access_token);
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);

    let webhookSubscribedAt: Date | null = null;
    const userId = String(profile.user_id);

    try {
      await subscribeWebhooks(userId, token.access_token);
      webhookSubscribedAt = new Date();
    } catch (webhookError) {
      console.warn("[oauth] webhook subscription failed", webhookError instanceof Error ? webhookError.message : webhookError);
      webhookSubscribedAt = null;
    }

    await saveInstagramConfig({
      accessToken: token.access_token,
      userId,
      username: profile.username,
      name: profile.name ?? null,
      profilePictureUrl: profile.profile_picture_url ?? null,
      expiresAt,
      webhookSubscribedAt,
    });

    return redirectBack(appBaseUrl, next, { instagram_connected: "1" });
  } catch (callbackError) {
    const message = callbackError instanceof Error ? callbackError.message : "Erro desconhecido ao conectar Instagram";
    console.error("[oauth] Instagram callback failed", message);
    return redirectBack(appBaseUrl, next, { instagram_error: message });
  }
}

/** Volta para um caminho interno (já conferido) somando os parâmetros, mesmo se ele já tiver "?accountId=". */
function redirectBack(appBaseUrl: string, path: string, params: Record<string, string>) {
  const url = new URL(path, `${appBaseUrl}/`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return NextResponse.redirect(url);
}