import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { query } from "@/lib/db/client";
import { clientIp } from "@/lib/login-limit";

/**
 * Limite dos formulários públicos de e-mail (0013 · formulario_limites): o quiz (/q/), a entrega (/e/) e a página de obrigado
 * da escada (/p/<slug>/obrigado/email). Sem serviço de fora: uma linha por chave e janela no Postgres, contada ANTES de gravar
 * (pedidos ao mesmo tempo não passam do limite). Guarda só o resumo (sha256) do IP e do e-mail.
 *   · por IP: LIMITE_IP envios em JANELA_IP_MIN minutos (uma casa com wi-fi ou um escritório ainda cabe);
 *   · por e-mail: LIMITE_EMAIL envios em JANELA_EMAIL_MIN minutos (ninguém enche a caixa de outra pessoa).
 * Sem a 0013 (ou com o banco fora do ar) o formulário segue sem limite e o aviso vai ao log: o limite nunca derruba a página.
 */
export const LIMITE_IP = 8;
export const JANELA_IP_MIN = 10;
export const LIMITE_EMAIL = 3;
export const JANELA_EMAIL_MIN = 60;
/** O início do quiz (sessão nova) também tem teto por IP, mais folgado. */
export const LIMITE_INICIO_IP = 60;

export type Formulario = "quiz" | "quiz-inicio" | "entrega" | "obrigado";

function resumo(tipo: string, valor: string) {
  return createHash("sha256").update(`uaiflow-formulario:${tipo}:${valor}`).digest("hex").slice(0, 40);
}

let avisou = false;

async function contar(chave: string, minutos: number) {
  const { rows } = await query<{ n: number }>(
    `insert into public.formulario_limites (chave, janela, n)
     values ($1, to_timestamp(floor(extract(epoch from now()) / ($2 * 60)) * ($2 * 60)), 1)
     on conflict (chave, janela) do update set n = public.formulario_limites.n + 1
     returning n`,
    [chave, minutos],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Conta este envio. true = passou do limite (responda «muitas tentativas» e não grave nada). `email` vazio = só o IP
 * (ex.: o início do quiz).
 */
export async function passouDoLimite(request: NextRequest, formulario: Formulario, email = "") {
  try {
    const ip = clientIp(request);
    const porIp = await contar(`${formulario}:ip:${resumo("ip", ip)}`, JANELA_IP_MIN);
    if (porIp > (formulario === "quiz-inicio" ? LIMITE_INICIO_IP : LIMITE_IP)) return true;
    if (email) {
      const porEmail = await contar(`email:${resumo("email", email.toLowerCase())}`, JANELA_EMAIL_MIN);
      if (porEmail > LIMITE_EMAIL) return true;
    }
    if (Math.random() < 0.02) await query("delete from public.formulario_limites where janela < now() - interval '2 days'");
    return false;
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") {
      if (!avisou) console.warn("[formulário] a atualização 0013 ainda não foi colada: os formulários de e-mail estão sem limite de tentativas.");
      avisou = true;
    } else {
      console.warn("[formulário] não consegui conferir o limite; seguindo sem limite:", error instanceof Error ? error.message : error);
    }
    return false;
  }
}
