import { NextResponse, type NextRequest } from "next/server";
import { irParaOferta, isMissing0017 } from "@/lib/db/desafios";
import { slugValido } from "@/lib/desafio/desafio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /d/<slug>/ir?i=<código da pessoa>&de=dm|email — o botão da oferta no fim do dia 5 (no Direct ou no e-mail de reserva).
 * Conta o toque e leva ao checkout da oferta com o código de compra (mo…) do desafio e da versão (A ou B). A venda que volta
 * com esse código (vendas.origem, 0012) conta como compra do desafio nos números do Molde.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  if (!slugValido(slug)) return new NextResponse("Desafio não encontrado.", { status: 404 });
  let destino: string | null = null;
  try {
    destino = await irParaOferta(slug, request.nextUrl.searchParams.get("i"));
  } catch (error) {
    if (!isMissing0017(error)) console.error("[desafio] não consegui contar o toque na oferta:", error instanceof Error ? error.message : error);
    return new NextResponse("Desafio não encontrado.", { status: 404 });
  }
  if (!destino) return new NextResponse("Desafio não encontrado.", { status: 404 });
  return NextResponse.redirect(destino, { status: 302, headers: { "cache-control": "no-store" } });
}
