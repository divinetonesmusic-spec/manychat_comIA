import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth";
import { requireEnv } from "@/lib/env";

/**
 * Tokens assinados (HMAC-SHA256) do login do Instagram:
 * - "state": vai para o Instagram e volta no /api/oauth/callback; prova que o login começou aqui.
 * - "login" (parâmetro t): link que a tela Perfis gera para quem está logado, para conectar a conta
 *   em OUTRO navegador/computador (onde o UaiFlow pode não estar logado).
 * Os dois levam um nonce, vencem em 30 min e carregam o caminho de volta (next). Um não serve no lugar do outro.
 * A chave é derivada do INSTAGRAM_APP_SECRET (já existe em produção) com um rótulo fixo: nenhuma variável nova.
 *
 * v133 (U-SEG-02b): o "state" também fica PRESO AO NAVEGADOR que começou o login. O /api/oauth/login grava o nonce
 * do state num cookie httpOnly + SameSite=Lax (só o servidor lê; vence junto com o state, 30 min) e o callback só aceita
 * o state se o cookie do mesmo navegador tiver o mesmo nonce. O cookie é apagado na volta (uso único). Assim, um state
 * válido que vazou (ou um link pronto com o código de outra pessoa) não liga conta nenhuma em outro navegador (CSRF).
 * PKCE: o Login do Instagram (instagram.com/oauth/authorize) não documenta code_challenge; não é usado aqui.
 */
export const OAUTH_TOKEN_TTL_MS = 30 * 60_000;

type Purpose = "state" | "login";
export type SignedOAuthToken = { next: string; nonce: string; expiresAt: number };

const KEY_LABEL = "uaiflow-oauth-state-v1";

function signingKey() {
  return createHmac("sha256", requireEnv("INSTAGRAM_APP_SECRET")).update(KEY_LABEL).digest();
}

function sign(purpose: Purpose, next: string | null | undefined, now: number) {
  const payload = { p: purpose, n: randomBytes(16).toString("base64url"), exp: now + OAUTH_TOKEN_TTL_MS, next: safeNextPath(next, "/perfis") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(purpose: Purpose, token: string | null | undefined, now: number): SignedOAuthToken | null {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, mac] = parts;
  const expected = createHmac("sha256", signingKey()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: { p?: unknown; n?: unknown; exp?: unknown; next?: unknown };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.p !== purpose || typeof payload.n !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < now) return null;
  return { next: safeNextPath(typeof payload.next === "string" ? payload.next : null, "/perfis"), nonce: payload.n, expiresAt: payload.exp };
}

export function createOAuthState(next: string | null | undefined, now = Date.now()) {
  return sign("state", next, now);
}

export function verifyOAuthState(token: string | null | undefined, now = Date.now()) {
  return verify("state", token, now);
}

export function createLoginLinkToken(next: string | null | undefined, now = Date.now()) {
  return sign("login", next, now);
}

export function verifyLoginLinkToken(token: string | null | undefined, now = Date.now()) {
  return verify("login", token, now);
}

/** Cookie do state do Instagram (nonce). Vale para /api/oauth/login e /api/oauth/callback. */
export const INSTAGRAM_STATE_COOKIE = "uaiflow_ig_state";
const IG_COOKIE_PATH = "/api/oauth";

function nonceDigest(nonce: string) {
  return createHash("sha256").update(`uaiflow-ig-nonce:${nonce}`).digest("base64url");
}

/** Grava no navegador o nonce do state (como hash). Chame no /api/oauth/login, na resposta que manda para o Instagram. */
export function setInstagramStateCookie(response: NextResponse, state: string) {
  const verified = verifyOAuthState(state);
  if (!verified) return response;
  response.cookies.set(INSTAGRAM_STATE_COOKIE, nonceDigest(verified.nonce), {
    httpOnly: true,
    sameSite: "lax", // a volta do Instagram é uma navegação comum (GET): o cookie "lax" vai junto
    secure: process.env.NODE_ENV === "production",
    path: IG_COOKIE_PATH,
    maxAge: Math.floor(OAUTH_TOKEN_TTL_MS / 1000),
  });
  return response;
}

export function clearInstagramStateCookie(response: NextResponse) {
  response.cookies.set(INSTAGRAM_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: IG_COOKIE_PATH, maxAge: 0 });
  return response;
}

/**
 * Confere o state que voltou do Instagram: assinatura, prazo E o cookie do mesmo navegador (mesmo nonce).
 * Qualquer falha: null (não troca o código).
 */
export function verifyInstagramCallbackState(request: NextRequest, returnedState: string | null | undefined, now = Date.now()): SignedOAuthToken | null {
  const verified = verifyOAuthState(returnedState, now);
  if (!verified) return null;
  const cookie = request.cookies.get(INSTAGRAM_STATE_COOKIE)?.value;
  if (!cookie || cookie.length > 256) return null;
  const expected = Buffer.from(nonceDigest(verified.nonce));
  const given = Buffer.from(cookie);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return verified;
}
