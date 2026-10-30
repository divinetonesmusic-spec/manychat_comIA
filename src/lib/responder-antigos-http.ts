import { NextResponse } from "next/server";
import { confirmar, ResponderErro, simular } from "@/lib/responder-antigos";

/**
 * A mesma porta do «Responder quem já comentou» para a tela (login do painel) e para o Molde (MOLDE_API_TOKEN):
 * GET = contar (simular, nada sai) · POST = confirmar e continuar o envio.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function responderGet(input: { automationId: unknown; accountId?: string | null; post: unknown; novo?: unknown }) {
  const automationId = typeof input.automationId === "string" ? input.automationId.trim() : "";
  if (!UUID.test(automationId)) return falha("Falta a automação (automationId).", 400);
  if (input.accountId && !UUID.test(input.accountId)) return falha("accountId inválido.", 400);
  try {
    const novo = input.novo === true || input.novo === "1" || input.novo === "true";
    const data = await simular({ automationId, accountId: input.accountId || null, post: String(input.post ?? ""), novo });
    return NextResponse.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return erro(error);
  }
}

export async function responderPost(input: { automationId: unknown; accountId?: string | null; body: Record<string, unknown> }) {
  const automationId = typeof input.automationId === "string" ? input.automationId.trim() : "";
  if (!UUID.test(automationId)) return falha("Falta a automação (automationId).", 400);
  if (input.accountId && !UUID.test(input.accountId)) return falha("accountId inválido.", 400);
  if (input.body.paraEnviar === undefined) {
    return falha("Mande paraEnviar: o número de pessoas que o dono viu na contagem (é a confirmação dele).", 400);
  }
  try {
    const data = await confirmar({ automationId, accountId: input.accountId || null, post: String(input.body.post ?? ""), paraEnviar: input.body.paraEnviar });
    return NextResponse.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return erro(error);
  }
}

function erro(error: unknown) {
  if (error instanceof ResponderErro) return NextResponse.json({ error: error.message, ...(error.dados ?? {}) }, { status: error.status });
  console.error("[responder-antigos]", error instanceof Error ? error.message : error);
  return falha("Não consegui terminar agora. Tente de novo em alguns segundos.", 500);
}

function falha(mensagem: string, status: number) {
  return NextResponse.json({ error: mensagem }, { status });
}
