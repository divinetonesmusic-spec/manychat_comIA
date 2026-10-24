import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { getQuizPublico, getSessaoQuiz, marcarCheckoutQuiz, registrarOrigemQuiz } from "@/lib/db/funil-molde";
import { checkoutDoPerfil, codigoDoPerfil } from "@/lib/funil/quiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /q/<slug>/ir?s=<sessão> — o botão da oferta do resultado. Conta o toque e leva ao checkout do perfil da pessoa, com
 * ?perfil=<id> e o código de compra (mo…) do quiz + perfil + post. A venda que volta com esse código (vendas.origem)
 * conta como compra daquele perfil nos números do Molde. Sem sessão ou sem perfil, volta para o quiz.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const q = await getQuizPublico(slug);
  if (!q) return new NextResponse("Quiz não encontrado.", { status: 404 });
  const voltar = NextResponse.redirect(new URL(`/q/${q.slug}`, getAppBaseUrl(request.url)), { status: 302, headers: { "cache-control": "no-store" } });
  const sessao = await getSessaoQuiz(request.nextUrl.searchParams.get("s") || "", q.id);
  const perfil = sessao?.perfil ? q.quiz.perfis.find((p) => p.id === sessao.perfil) : undefined;
  if (!sessao || !perfil) return voltar;
  const codigo = codigoDoPerfil(q.slug, perfil.id, sessao.origem);
  const destino = checkoutDoPerfil(perfil, codigo);
  if (!destino) return voltar;
  try {
    await registrarOrigemQuiz(codigo, q.id, perfil.id, sessao.origem);
    await marcarCheckoutQuiz(sessao.id);
  } catch (error) {
    // contar o toque nunca segura a pessoa: ela segue para o checkout
    console.error("[quiz] não consegui contar o toque na oferta:", error instanceof Error ? error.message : error);
  }
  return NextResponse.redirect(destino, { status: 302, headers: { "cache-control": "no-store" } });
}
