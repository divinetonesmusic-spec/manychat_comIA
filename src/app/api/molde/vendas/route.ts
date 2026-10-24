import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { hasVendasTable, MIGRATION_0010_MISSING } from "@/lib/db/redes";
import { MIGRATION_0012_MISSING, resumoVendas, vendasPorRefs } from "@/lib/db/vendas";
import { refsDaUrl } from "@/lib/molde/refs";

export const runtime = "nodejs";

const MAX_DIAS = 365;

/**
 * GET /api/molde/vendas (cabeçalho x-molde-token). Dois jeitos (os dois sem nenhum dado pessoal do cliente; vendas de teste
 * das plataformas ficam de fora):
 *
 * - `?refs=<a>,<b>&desde=<ISO>` (contrato v131 da página): `{vendas:[{ref, plataforma, produto, valor, moeda, status, em,
 *   origem}], totais:{aprovadas, reembolsadas, chargebacks, receita:{BRL:…}}}`. `ref` = o externalRef do link cuja origem
 *   voltou no aviso de venda; venda sem origem conhecida (ou de um post fora de `refs`) vem com ref "". `status`: aprovada,
 *   reembolsada ou chargeback. `desde` padrão: 90 dias atrás (no máximo 365).
 * - `?dias=30` (como antes): totais por moeda, por produto e por plataforma nos últimos `dias` (1 a 365) e as últimas 50.
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  if (!(await hasVendasTable())) return NextResponse.json({ error: MIGRATION_0010_MISSING, codigo: "falta_0010" }, { status: 503 });
  const params = request.nextUrl.searchParams;

  if (params.has("refs") || params.has("desde")) {
    const refs = refsDaUrl(request.nextUrl);
    const minimo = Date.now() - MAX_DIAS * 86_400_000;
    const pedido = params.get("desde") ? new Date(params.get("desde") as string) : new Date(Date.now() - 90 * 86_400_000);
    if (Number.isNaN(pedido.getTime())) return NextResponse.json({ error: "desde inválido: mande uma data ISO, ex.: 2026-07-26T00:00:00Z." }, { status: 400 });
    const desde = new Date(Math.max(pedido.getTime(), minimo));
    const { vendas, totais, semOrigem } = await vendasPorRefs({ refs, desde });
    // "aviso" (só acréscimo): sem a 0012 as vendas não sabem de qual post vieram (todas com ref "").
    return NextResponse.json({ vendas, totais, ...(semOrigem ? { aviso: MIGRATION_0012_MISSING } : {}) });
  }

  const raw = Number(params.get("dias") || 30);
  const dias = Number.isFinite(raw) ? Math.min(MAX_DIAS, Math.max(1, Math.round(raw))) : 30;
  return NextResponse.json({ data: await resumoVendas(dias) });
}
