import { createHmac, timingSafeEqual } from "node:crypto";
import { safeEqualSecret } from "@/lib/secrets";

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

function sign(secret: string, issuedAt: string) {
  return createHmac("sha256", secret).update(`uaiflow-admin-v2:${issuedAt}`).digest("base64url");
}

/**
 * Valor do cookie de admin: "<emitidoEm>.<assinatura>", onde a assinatura é um HMAC do segredo sobre a hora da entrada
 * (o segredo nunca vai para o navegador). Trocar o segredo derruba todas as sessões. Sem segredo, devolve null.
 */
export function createAdminSessionValue(now = Date.now()): string | null {
  const secret = adminSessionSecret();
  if (!secret) return null;
  const issuedAt = String(Math.floor(now));
  return `${issuedAt}.${sign(secret, issuedAt)}`;
}

/** Confere o cookie de admin: assinatura certa (comparação em tempo constante) e dentro dos 30 dias. */
export function isValidAdminSession(value: string | null | undefined, now = Date.now()) {
  const secret = adminSessionSecret();
  if (!secret || !value || value.length > 200) return false;
  const [issuedAt, signature, ...rest] = value.split(".");
  if (rest.length || !issuedAt || !signature || !/^\d{1,16}$/.test(issuedAt)) return false;
  const issued = Number(issuedAt);
  if (issued > now + CLOCK_SKEW_MS || now - issued > ADMIN_SESSION_MAX_AGE_SECONDS * 1000) return false;
  const expected = Buffer.from(sign(secret, issuedAt));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function isValidAdminPassword(password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 12) return false;
  return safeEqualSecret(password, expected);
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
