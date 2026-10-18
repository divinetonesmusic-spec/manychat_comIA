import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth";

/**
 * "state" da conexão do Threads e do YouTube: o mesmo jeito do Login do Facebook (lib/facebook/oauth-state.ts).
 * Número aleatório num cookie httpOnly (só o servidor lê) com a conta e o caminho de volta; na volta, o state do
 * endereço precisa ser igual ao do cookie e estar no prazo (10 min). O cookie é apagado em qualquer resultado.
 */
export type NetworkStateConfig = { cookie: string; path: string };

export const THREADS_STATE: NetworkStateConfig = { cookie: "uaiflow_threads_state", path: "/api/oauth/threads" };
export const YOUTUBE_STATE: NetworkStateConfig = { cookie: "uaiflow_youtube_state", path: "/api/oauth/youtube" };

export const NETWORK_STATE_TTL_SECONDS = 10 * 60;

export type NetworkOAuthState = { state: string; accountId: string; next: string; expiresAt: number };

export function createNetworkState(accountId: string, next: string, now = Date.now()): NetworkOAuthState {
  return { state: randomBytes(24).toString("base64url"), accountId, next: safeNextPath(next, "/perfis"), expiresAt: now + NETWORK_STATE_TTL_SECONDS * 1000 };
}

export function encodeNetworkState(value: NetworkOAuthState) {
  return Buffer.from(JSON.stringify({ s: value.state, a: value.accountId, n: value.next, e: value.expiresAt })).toString("base64url");
}

export function setNetworkStateCookie(config: NetworkStateConfig, response: NextResponse, value: NetworkOAuthState) {
  response.cookies.set(config.cookie, encodeNetworkState(value), {
    httpOnly: true,
    sameSite: "lax", // a volta é uma navegação comum (GET): o cookie "lax" vai junto
    secure: process.env.NODE_ENV === "production",
    path: config.path,
    maxAge: NETWORK_STATE_TTL_SECONDS,
  });
  return response;
}

export function clearNetworkStateCookie(config: NetworkStateConfig, response: NextResponse) {
  response.cookies.set(config.cookie, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: config.path, maxAge: 0 });
  return response;
}

/** Confere o state que voltou com o do cookie. Qualquer diferença, cookie faltando ou prazo vencido: null. */
export function verifyNetworkState(config: NetworkStateConfig, request: NextRequest, returnedState: string | null | undefined, now = Date.now()): NetworkOAuthState | null {
  const raw = request.cookies.get(config.cookie)?.value;
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
  const given = Buffer.from(returnedState.replace(/#_$/, ""));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { state: payload.s, accountId: payload.a, next: safeNextPath(typeof payload.n === "string" ? payload.n : null, "/perfis"), expiresAt: payload.e };
}
