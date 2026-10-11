/**
 * Sessão de administrador e regras de entrada. Este arquivo é lido também pelo proxy: usa só o que existe em qualquer
 * runtime (Web Crypto, TextEncoder, atob/btoa), sem Buffer nem node:crypto. A senha de administrador fica em
 * src/lib/admin-password.ts (só a rota de login, que roda em Node).
 */
const COOKIE_NAME = "admin_session";

/** A sessão de administrador vale 30 dias a partir da entrada (conferido no servidor, não só no navegador). */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** Folga para relógios um pouco adiantados. */
const CLOCK_SKEW_MS = 5 * 60_000;

export function getAdminCookieName() {
  return COOKIE_NAME;
}

/** Em produção, sem ADMIN_SESSION_SECRET (ou WORKER_SECRET) o login de admin fica desligado. */
function adminSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.WORKER_SECRET || (process.env.NODE_ENV === "production" ? "" : "local-dev-session");
}

const encoder = new TextEncoder();

function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

function signedData(issuedAt: string) {
  return encoder.encode(`uaiflow-admin-v2:${issuedAt}`);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Valor do cookie de admin: "<emitidoEm>.<assinatura>", onde a assinatura é um HMAC-SHA256 do segredo sobre a hora da
 * entrada (o segredo nunca vai para o navegador). Trocar o segredo derruba todas as sessões. Sem segredo, devolve null.
 */
export async function createAdminSessionValue(now = Date.now()): Promise<string | null> {
  const secret = adminSessionSecret();
  if (!secret) return null;
  const issuedAt = String(Math.floor(now));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), signedData(issuedAt)));
  return `${issuedAt}.${toBase64Url(signature)}`;
}

/**
 * Confere o cookie de admin: dentro dos 30 dias e com a assinatura certa. Quem compara é o crypto.subtle.verify
 * (comparação em tempo constante, igual em qualquer runtime).
 */
export async function isValidAdminSession(value: string | null | undefined, now = Date.now()): Promise<boolean> {
  const secret = adminSessionSecret();
  if (!secret || !value || value.length > 200) return false;
  const [issuedAt, signature, ...rest] = value.split(".");
  if (rest.length || !issuedAt || !signature || !/^\d{1,16}$/.test(issuedAt)) return false;
  const issued = Number(issuedAt);
  if (issued > now + CLOCK_SKEW_MS || now - issued > ADMIN_SESSION_MAX_AGE_SECONDS * 1000) return false;
  const given = fromBase64Url(signature);
  if (!given || given.length !== 32) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), given, signedData(issuedAt));
}

/**
 * Só caminhos internos ("/dashboard"), nunca "//site", "/\site" ou endereços de fora.
 * Também barra barra invertida, tab e quebra de linha: o navegador troca "\" por "/" e ignora tab/quebra,
 * então "/\site" e "/<tab>/site" virariam "//site".
 */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard") {
  const next = String(value || "");
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    // confere do jeito que o navegador vai ler: tem que continuar no mesmo endereço
    if (new URL(next, "https://uaiflow.invalid").host !== "uaiflow.invalid") return fallback;
  } catch {
    return fallback;
  }
  return next;
}

/** Lista de e-mails que podem entrar pelo Supabase (e-mail, link ou Google): ALLOWED_EMAILS=a@x.com,b@y.com. */
export function allowedEmailList() {
  return (process.env.ALLOWED_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/**
 * Quem pode entrar pelo Supabase. Em produção a lista é obrigatória: vazia, ninguém entra por aqui (só a senha de
 * administrador). Fora de produção (computador e testes), lista vazia deixa qualquer conta do Supabase entrar.
 */
export function isAllowedEmail(email: string | null | undefined) {
  const list = allowedEmailList();
  if (!list.length) return process.env.NODE_ENV !== "production";
  return Boolean(email && list.includes(email.toLowerCase()));
}
