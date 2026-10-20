import { NextRequest, NextResponse } from "next/server";
import { hasFunilTables, listarCompradores, MIGRATION_0011_MISSING } from "@/lib/db/funil";
import { compradoresCsv } from "@/lib/vendas/exportar";

export const runtime = "nodejs";

/**
 * GET /api/vendas/compradores?produtoId=&prevenda=1&formato=csv
 * A lista própria de e-mails (deixados na página de obrigado). prevenda=1: só quem comprou na pré-venda (para avisar
 * na entrega). formato=csv baixa a planilha.
 */
export async function GET(request: NextRequest) {
  if (!(await hasFunilTables())) return NextResponse.json({ error: MIGRATION_0011_MISSING, codigo: "falta_0011" }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const produtoId = params.get("produtoId");
  const lista = await listarCompradores({ produtoId: produtoId && /^[0-9a-f-]{36}$/i.test(produtoId) ? produtoId : null, prevenda: params.get("prevenda") === "1" });
  if (params.get("formato") === "csv") {
    return new NextResponse(compradoresCsv(lista), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="compradores.csv"`, "cache-control": "no-store" },
    });
  }
  return NextResponse.json({ data: lista });
}
