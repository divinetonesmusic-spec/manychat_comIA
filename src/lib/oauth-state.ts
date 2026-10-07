import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { safeNextPath } from "@/lib/auth";
import { requireEnv } from "@/lib/env";

/**
 * Tokens assinados (HMAC-SHA256) do login do Instagram:
 * - "state": vai para o Instagram e volta no /api/oauth/callback; prova que o login começou aqui.
 * - "login" (parâmetro t): link que a tela Perfis gera para quem está logado, para conectar a conta
 *   em OUTRO navegador/computador (onde o UaiFlow pode não estar logado).
 * Os dois levam um nonce, vencem em 30 min e carregam o caminho de volta (next). Um não serve no lugar do outro.
 * A chave é derivada do INSTAGRAM_APP_SECRET (já existe em produção) com um rótulo fixo: nenhuma variável nova.
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
