import { NextResponse, type NextRequest } from "next/server";
import { emailValido, getProdutoPublico, getSessao, registrarEventoFunil, salvarComprador } from "@/lib/db/funil";
import { cookieSessao } from "@/lib/vendas/funil-web";
import { passouDoLimite } from "@/lib/funil/limite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function voltar(request: NextRequest, caminho: string) {
  return NextResponse.redirect(new URL(caminho, request.url), { status: 303, headers: { "cache-control": "no-store" } });
}

/**
 * POST /p/<slug>/obrigado/email (formulário da página de obrigado): guarda o e-mail na lista própria
 * (public.compradores) e agenda o pedido de depoimento. A caixa de novidades só vale se a pessoa marcou.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const produto = await getProdutoPublico(slug);
  if (!produto) return new NextResponse("Produto não encontrado.", { status: 404 });
  const form = await request.formData().catch(() => null);
  const pagina = `/p/${produto.slug}/obrigado`;
  if (String(form?.get("site") ?? "")) return voltar(request, `${pagina}?ok=1`); // robô: finge que deu certo e não grava

  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  if (!emailValido(email)) return voltar(request, `${pagina}?erro=email`);
  // 0013 · limite por IP e por e-mail (ninguém cadastra a caixa de outra pessoa em série); sem a 0013, segue sem limite
  if (await passouDoLimite(request, "obrigado", email)) return voltar(request, `${pagina}?erro=limite`);
  const sessao = await getSessao(request.cookies.get(cookieSessao(produto.slug))?.value, produto.id);
  await salvarComprador(produto, {
    email,
    nome: String(form?.get("nome") ?? "").trim() || null,
    aceitaNovidades: form?.get("novidades") === "on",
    sessaoId: sessao?.id ?? null,
    compraRef: sessao?.compraRef ?? null,
  });
  await registrarEventoFunil(produto.id, "email_capturado", { sessaoId: sessao?.id ?? null });
  return voltar(request, `${pagina}?ok=1`);
}
