import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { confirmarLead } from "@/lib/funil/confirmacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ codigo: string }> };

/** POST /lista/confirmar/<codigo>/ok — a confirmação dupla: a pessoa passa a contar como «na lista» (leads.confirmado_em). */
export async function POST(request: NextRequest, { params }: Params) {
  const { codigo } = await params;
  if (!(await confirmarLead(codigo))) return new NextResponse("Não encontrado.", { status: 404 });
  return NextResponse.redirect(new URL(`/lista/confirmar/${codigo}?ok=1`, getAppBaseUrl(request.url)), { status: 303, headers: { "cache-control": "no-store" } });
}
