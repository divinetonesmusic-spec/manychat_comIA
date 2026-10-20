import { NextResponse, type NextRequest } from "next/server";
import { abrirSessao, getProdutoPublico, registrarEventoFunil } from "@/lib/db/funil";
import { compraRefDoLink, COOKIE_SESSAO_DIAS, cookieSessao } from "@/lib/vendas/funil-web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /p/<slug>/oferta[?compra=<id da compra>]: o endereço de "depois do pagamento" configurado na plataforma.
 * Abre (ou reabre) a sessão desta compra, conta a compra da entrada uma vez e leva ao passo atual (upsell, downsell,
 * recorrência ou obrigado). A mesma compra/navegador volta sempre para a mesma sessão e o mesmo prazo.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const produto = await getProdutoPublico(slug);
  if (!produto) return new NextResponse("Produto não encontrado.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

  const nome = cookieSessao(produto.slug);
  const { sessao, nova } = await abrirSessao(produto, { compraRef: compraRefDoLink(request.nextUrl.searchParams), cookieSessaoId: request.cookies.get(nome)?.value });
  if (nova) await registrarEventoFunil(produto.id, "entrada", { sessaoId: sessao.id, valor: produto.preco });

  const destino = sessao.etapa === "obrigado" ? `/p/${produto.slug}/obrigado` : `/p/${produto.slug}/oferta/${sessao.id}`;
  const response = NextResponse.redirect(new URL(destino, request.url), { status: 303, headers: { "cache-control": "no-store" } });
  response.cookies.set(nome, sessao.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: `/p/${produto.slug}`,
    maxAge: COOKIE_SESSAO_DIAS * 86_400,
  });
  return response;
}
