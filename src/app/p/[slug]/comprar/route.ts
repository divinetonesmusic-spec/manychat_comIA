import { NextResponse, type NextRequest } from "next/server";
import { getProdutoPublico, registrarEventoFunil } from "@/lib/db/funil";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /p/<slug>/comprar[?bump=1]: conta o clique e manda para o link de pagamento da plataforma (com o bump: o link
 * que já traz a entrada + o bump juntos).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const produto = await getProdutoPublico(slug);
  if (!produto?.checkoutUrl) return new NextResponse("Produto não encontrado.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const comBump = request.nextUrl.searchParams.get("bump") === "1" && Boolean(produto.escada.bump);
  await registrarEventoFunil(produto.id, comBump ? "clique_comprar_bump" : "clique_comprar");
  const destino = comBump && produto.escada.bump ? produto.escada.bump.checkoutUrl : produto.checkoutUrl;
  return NextResponse.redirect(destino, { status: 303, headers: { "cache-control": "no-store" } });
}
