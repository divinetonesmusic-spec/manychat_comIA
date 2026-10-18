import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { hasVendasTable, MIGRATION_0010_MISSING } from "@/lib/db/redes";
import { resumoVendas } from "@/lib/db/vendas";

export const runtime = "nodejs";

/**
 * GET /api/molde/vendas?dias=30 (cabeçalho x-molde-token)
 * Totais por moeda, por produto e por plataforma nos últimos `dias` (1 a 365, padrão 30) e as últimas 50 vendas.
 * Sem nenhum dado pessoal do cliente. Vendas de teste das plataformas ficam de fora.
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  if (!(await hasVendasTable())) return NextResponse.json({ error: MIGRATION_0010_MISSING, codigo: "falta_0010" }, { status: 503 });
  const raw = Number(request.nextUrl.searchParams.get("dias") || 30);
  const dias = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 30;
  return NextResponse.json({ data: await resumoVendas(dias) });
}
