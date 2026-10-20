import { NextRequest, NextResponse } from "next/server";
import { criarProduto, hasFunilTables, listarProdutos, metricasProdutos, MIGRATION_0011_MISSING, SlugEmUsoError } from "@/lib/db/funil";
import { avisosEscada } from "@/lib/vendas/escada";
import { parseProduto } from "@/lib/vendas/produto";

export const runtime = "nodejs";

/**
 * GET  /api/vendas/produtos?dias=30   produtos com as métricas do funil (valor médio por comprador, aceites).
 * POST /api/vendas/produtos            cria um produto (página, escada, obrigado, pré-venda). Precisa de sessão.
 */
export async function GET(request: NextRequest) {
  if (!(await hasFunilTables())) return NextResponse.json({ error: MIGRATION_0011_MISSING, codigo: "falta_0011" }, { status: 503 });
  const raw = Number(request.nextUrl.searchParams.get("dias") || 30);
  const dias = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 30;
  const produtos = await listarProdutos();
  const metricas = await metricasProdutos(produtos, dias);
  return NextResponse.json({ data: produtos.map((produto) => ({ ...produto, metricas: metricas.get(produto.id) ?? null, avisos: avisosEscada(produto.escada) })), dias });
}

export async function POST(request: NextRequest) {
  if (!(await hasFunilTables())) return NextResponse.json({ error: MIGRATION_0011_MISSING, codigo: "falta_0011" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseProduto(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const produto = await criarProduto(parsed.value);
    const avisos = avisosEscada(produto.escada);
    return NextResponse.json({ data: produto, warning: avisos.length ? avisos.join(" ") : undefined }, { status: 201 });
  } catch (error) {
    if (error instanceof SlugEmUsoError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
