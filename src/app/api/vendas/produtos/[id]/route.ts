import { NextRequest, NextResponse } from "next/server";
import { apagarProduto, atualizarProduto, getProduto, hasFunilTables, marcarAvisadosEntrega, MIGRATION_0011_MISSING, SlugEmUsoError } from "@/lib/db/funil";
import { avisosEscada } from "@/lib/vendas/escada";
import { parseProduto } from "@/lib/vendas/produto";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const falta0011 = () => NextResponse.json({ error: MIGRATION_0011_MISSING, codigo: "falta_0011" }, { status: 503 });
const naoAchado = () => NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

/** GET um produto; PATCH salva o produto inteiro; DELETE apaga; POST { acao: "marcar_avisados" } (pré-venda entregue). */
export async function GET(_request: NextRequest, { params }: Params) {
  if (!(await hasFunilTables())) return falta0011();
  const produto = await getProduto((await params).id);
  return produto ? NextResponse.json({ data: produto }) : naoAchado();
}

export async function PATCH(request: NextRequest, { params }: Params) {
  if (!(await hasFunilTables())) return falta0011();
  const { id } = await params;
  if (!(await getProduto(id))) return naoAchado();
  const parsed = parseProduto((await request.json().catch(() => ({}))) as Record<string, unknown>);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const produto = await atualizarProduto(id, parsed.value);
    if (!produto) return naoAchado();
    const avisos = avisosEscada(produto.escada);
    return NextResponse.json({ data: produto, warning: avisos.length ? avisos.join(" ") : undefined });
  } catch (error) {
    if (error instanceof SlugEmUsoError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  if (!(await hasFunilTables())) return falta0011();
  return (await apagarProduto((await params).id)) ? NextResponse.json({ ok: true }) : naoAchado();
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!(await hasFunilTables())) return falta0011();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { acao?: string };
  if (body.acao !== "marcar_avisados") return NextResponse.json({ error: "Pedido inválido: o único pedido aceito aqui é marcar_avisados." }, { status: 400 });
  if (!(await getProduto(id))) return naoAchado();
  return NextResponse.json({ ok: true, marcados: await marcarAvisadosEntrega(id) });
}
