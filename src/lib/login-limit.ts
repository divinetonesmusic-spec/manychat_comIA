import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { query } from "@/lib/db/client";

/**
 * Limite da senha de administrador: no máximo 5 tentativas erradas por endereço (IP) em 15 minutos.
 * Guarda só um hash do endereço (tabela admin_login_attempts, migração 0007). Sem a 0007, ou com o banco fora do ar,
 * a entrada segue sem limite (a senha de administrador é a porta de emergência) e o aviso vai ao log.
 */
export const MAX_FAILED_LOGINS = 5;
export const LOGIN_WINDOW_MINUTES = 15;

let warnedMissing = false;

/** Endereço de quem pediu: o Netlify manda o IP real em x-nf-client-connection-ip; senão, o 1º de x-forwarded-for. */
export function clientIp(request: NextRequest) {
  const netlify = request.headers.get("x-nf-client-connection-ip")?.trim();
  if (netlify) return netlify;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return request.headers.get("x-real-ip")?.trim() || "desconhecido";
}

function ipHash(ip: string) {
  return createHash("sha256").update(`uaiflow-login:${ip}`).digest("hex");
}

function warnUnavailable(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "42P01") {
    if (warnedMissing) return;
    warnedMissing = true;
    console.warn("[login] a atualização 0007 ainda não foi colada no Supabase: a senha de administrador está sem limite de tentativas.");
    return;
  }
  console.warn("[login] não consegui conferir o limite de tentativas; seguindo sem limite:", error instanceof Error ? error.message : error);
}

/**
 * Conta a tentativa ANTES de conferir a senha (grava e depois conta): assim, pedidos ao mesmo tempo não passam de 5.
 * true = este endereço já fez mais de 5 tentativas sem acertar nos últimos 15 minutos (bloqueado por enquanto).
 */
export async function registerLoginAttempt(ip: string) {
  try {
    const hash = ipHash(ip);
    await query("insert into public.admin_login_attempts (ip_hash) values ($1)", [hash]);
    const { rows } = await query<{ count: number }>(
      `select count(*)::int as count from public.admin_login_attempts
       where ip_hash = $1 and attempted_at > now() - make_interval(mins => $2)`,
      [hash, LOGIN_WINDOW_MINUTES],
    );
    return (rows[0]?.count ?? 0) > MAX_FAILED_LOGINS;
  } catch (error) {
    warnUnavailable(error);
    return false;
  }
}

/** Entrou certo: as tentativas erradas daquele endereço são esquecidas. */
export async function clearFailedLogins(ip: string) {
  try {
    await query("delete from public.admin_login_attempts where ip_hash = $1", [ipHash(ip)]);
  } catch (error) {
    warnUnavailable(error);
  }
}
