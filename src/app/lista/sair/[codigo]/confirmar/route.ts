import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { descadastrarLead } from "@/lib/db/funil-molde";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ codigo: string }> };

/**
 * POST /lista/sair/<codigo>/confirmar — tira a pessoa da Lista própria (descadastrado_em, consentimento desligado).
 * Também serve ao «List-Unsubscribe-Post: One-Click» dos e-mails (quando o envio existir).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { codigo } = await params;
  const achou = await descadastrarLead(codigo);
  if (!achou) return new NextResponse("Não encontrado.", { status: 404 });
  return NextResponse.redirect(new URL(`/lista/sair/${codigo}?ok=1`, getAppBaseUrl(request.url)), { status: 303, headers: { "cache-control": "no-store" } });
}
