import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth";

/**
 * "state" do Login do Facebook: número aleatório guardado num cookie httpOnly (só o servidor lê) junto com a conta
 * e o caminho de volta. Na volta, o state do endereço precisa ser igual ao do cookie e estar dentro do prazo (10 min);
 * o cookie é apagado em qualquer resultado. Assim ninguém consegue ligar a conta de outra pessoa mandando um link pronto
 * (o problema U-SEG-02 do login antigo).
 */
export const FACEBOOK_STATE_COOKIE = "uaiflow_fb_state";
export const FACEBOOK_STATE_TTL_SECONDS = 10 * 60;
const COOKIE_PATH = "/api/oauth/facebook";

/** Frase da volta com state errado, vencido ou sem o cookie (o login começou em outro lugar). */
export const FACEBOOK_INVALID_STATE_MESSAGE = "O link de conexão com o Facebook venceu ou não é válido. Comece de novo pelo botão «Conectar pelo Facebook».";

export type FacebookOAuthState = { state: string; accountId: string; next: string; expiresAt: number };

export function createFacebookState(accountId: string, next: string, now = Date.now()): FacebookOAuthState {
  return { state: randomBytes(24).toString("base64url"), accountId, next: safeNextPath(next, "/perfis"), expiresAt: now + FACEBOOK_STATE_TTL_SECONDS * 1000 };
}

export function setFacebookStateCookie(response: NextResponse, value: FacebookOAuthState) {
  const encoded = Buffer.from(JSON.stringify({ s: value.state, a: value.accountId, n: value.next, e: value.expiresAt })).toString("base64url");
  response.cookies.set(FACEBOOK_STATE_COOKIE, encoded, {
    httpOnly: true,
    sameSite: "lax", // a volta do Facebook é uma navegação comum (GET): o cookie "lax" vai junto
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge: FACEBOOK_STATE_TTL_SECONDS,
  });
  return response;
}

export function clearFacebookStateCookie(response: NextResponse) {
  response.cookies.set(FACEBOOK_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: COOKIE_PATH, maxAge: 0 });
  return response;
}

/** Confere o state que voltou do Facebook com o do cookie. Qualquer diferença, cookie faltando ou prazo vencido: null. */
export function verifyFacebookState(request: NextRequest, returnedState: string | null | undefined, now = Date.now()): FacebookOAuthState | null {
  const raw = request.cookies.get(FACEBOOK_STATE_COOKIE)?.value;
  if (!raw || !returnedState || raw.length > 2048 || returnedState.length > 256) return null;
  let payload: { s?: unknown; a?: unknown; n?: unknown; e?: unknown };
  try {
    payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.s !== "string" || typeof payload.a !== "string" || typeof payload.e !== "number") return null;
  if (payload.e < now) return null;
  const expected = Buffer.from(payload.s);
  const given = Buffer.from(returnedState);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { state: payload.s, accountId: payload.a, next: safeNextPath(typeof payload.n === "string" ? payload.n : null, "/perfis"), expiresAt: payload.e };
}
