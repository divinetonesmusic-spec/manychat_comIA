import { NextRequest, NextResponse } from "next/server";
import { parseEscadaMolde } from "@/lib/vendas/produto";

export const runtime = "nodejs";

/**
 * POST /api/vendas/escada-molde { json }: lê a escada colada da página do Molde ({ entrada, meio, topo, obrigado }) e
 * devolve o rascunho do produto para a tela conferir. Não salva nada.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { json?: unknown };
  if (body.json === undefined || body.json === null || body.json === "") return NextResponse.json({ error: "Cole o JSON da escada." }, { status: 400 });
  if (typeof body.json === "string" && body.json.length > 50_000) return NextResponse.json({ error: "JSON grande demais." }, { status: 413 });
  const parsed = parseEscadaMolde(body.json);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return NextResponse.json({ data: parsed.produto, warning: parsed.avisos.length ? parsed.avisos.join(" ") : undefined });
}
