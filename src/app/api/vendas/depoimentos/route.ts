import { NextRequest, NextResponse } from "next/server";
import { hasFunilTables, listarDepoimentos, MIGRATION_0011_MISSING } from "@/lib/db/funil";
import { getR2Config, r2DownloadUrl } from "@/lib/content/r2";
import { depoimentosCsv, depoimentosTexto, depoimentoTexto } from "@/lib/vendas/exportar";

export const runtime = "nodejs";

/**
 * GET /api/vendas/depoimentos?produtoId=&autorizados=1&formato=csv|texto
 * Respostas do formulário (com data e permissão). formato=texto: só os autorizados, prontos para colar no Banco de
 * provas. O print abre por um link com prazo de 1 hora (o R2 fica privado).
 */
export async function GET(request: NextRequest) {
  if (!(await hasFunilTables())) return NextResponse.json({ error: MIGRATION_0011_MISSING, codigo: "falta_0011" }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const produtoId = params.get("produtoId");
  const formato = params.get("formato");
  const lista = await listarDepoimentos({
    produtoId: produtoId && /^[0-9a-f-]{36}$/i.test(produtoId) ? produtoId : null,
    soAutorizados: params.get("autorizados") === "1" || formato === "texto",
  });
  const semCache = { "cache-control": "no-store" };
  if (formato === "csv") {
    return new NextResponse(depoimentosCsv(lista), { headers: { ...semCache, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="depoimentos.csv"` } });
  }
  if (formato === "texto") {
    return new NextResponse(depoimentosTexto(lista), { headers: { ...semCache, "content-type": "text/plain; charset=utf-8" } });
  }
  const r2 = getR2Config();
  return NextResponse.json({
    data: lista.map((item) => ({
      ...item,
      texto: depoimentoTexto(item),
      printUrl: item.printKey && r2 ? r2DownloadUrl(item.printKey, 3600, r2) : null,
    })),
  });
}
