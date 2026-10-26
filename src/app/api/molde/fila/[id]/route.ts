import { NextRequest, NextResponse } from "next/server";
import { UUID } from "@/lib/molde/jobs-http";
import { getItem, orqView } from "@/lib/molde/orquestrador";
import { checkFilaToken, falha, falhaInesperada } from "@/lib/molde/orquestrador-http";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/molde/fila/<id> → { item } no formato do orquestrador (docs/API_MOLDE_ORQUESTRADOR.md). Vale para qualquer item
 * da fila (também os espelhos da página), menos os rascunhos do Telegram. Com o x-molde-token ou o token do orquestrador.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = checkFilaToken(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return falha(404, "nao_achou", "Item da fila não encontrado.");
  try {
    const item = await getItem(id);
    return item ? NextResponse.json({ item: orqView(item) }) : falha(404, "nao_achou", "Item da fila não encontrado.");
  } catch (error) {
    return falhaInesperada(error, "não consegui ler o item");
  }
}
