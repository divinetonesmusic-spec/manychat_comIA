const COOKIE_NAME = "admin_session";

export function getAdminCookieName() {
  return COOKIE_NAME;
}

/**
 * Valor do cookie de admin: um hash do segredo (o segredo nunca vai para o navegador).
 * Em produção, sem ADMIN_SESSION_SECRET (ou WORKER_SECRET) o login de admin fica desligado.
 */
export async function createAdminSessionValue(): Promise<string | null> {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.WORKER_SECRET || (process.env.NODE_ENV === "production" ? "" : "local-dev-session");
  if (!secret) return null;
  const data = new TextEncoder().encode(`${secret}:uaiflow-admin-v1`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isValidAdminPassword(password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected && expected.length >= 12 && password === expected);
}

/** Só caminhos internos ("/dashboard"), nunca "//site" ou endereços de fora. */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard") {
  const next = String(value || "");
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

/** Lista opcional de e-mails que podem entrar (ALLOWED_EMAILS=a@x.com,b@y.com). Vazia = qualquer conta do Supabase. */
export function isAllowedEmail(email: string | null | undefined) {
  const list = (process.env.ALLOWED_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  return Boolean(email && list.includes(email.toLowerCase()));
}
