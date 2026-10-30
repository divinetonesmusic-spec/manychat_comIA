import { NextRequest } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { responderGet, responderPost } from "@/lib/responder-antigos-http";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * «Responder quem já comentou neste post» para a página do Molde (pelo robô), com o MOLDE_API_TOKEN.
 * GET  /api/molde/responder-antigos?automationId=&post=<link ou id da mídia>&accountId=&novo=1
 *      Conta (simulação: nada sai). Enquanto data.estado = "lendo", chame de novo (cada chamada lê uns 7 s; o relógio
 *      de cada minuto também continua sozinho).
 * POST /api/molde/responder-antigos  { automationId, post, paraEnviar, accountId? }
 *      Confirma o envio. paraEnviar = o número que o dono viu (data.numeros.paraEnviar); se a contagem mudou, 409 com
 *      os números novos. Chamar de novo continua o envio e mostra o andamento. Nunca manda duas vezes.
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const search = request.nextUrl.searchParams;
  return responderGet({ automationId: search.get("automationId"), accountId: search.get("accountId"), post: search.get("post"), novo: search.get("novo") });
}

export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const corpo = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  return responderPost({ automationId: corpo.automationId, accountId: typeof corpo.accountId === "string" ? corpo.accountId : null, body: corpo });
}
