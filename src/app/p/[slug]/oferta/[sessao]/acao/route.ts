import { NextResponse, type NextRequest } from "next/server";
import { avancarSessao, getProdutoPublico, getSessao, registrarEventoFunil, type TipoEvento } from "@/lib/db/funil";
import { ETAPAS, precoAtual, proximaEtapa, type Etapa } from "@/lib/vendas/escada";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; sessao: string }> };

function voltar(request: NextRequest, caminho: string) {
  return NextResponse.redirect(new URL(caminho, request.url), { status: 303, headers: { "cache-control": "no-store" } });
}

/**
 * POST /p/<slug>/oferta/<sessao>/acao (formulário da oferta): acao = aceitar | recusar | continuar.
 * - aceitar: confere o prazo AGORA (o link com desconto nunca sai depois do prazo), conta o aceite, avança o passo e
 *   manda para o link de pagamento. Recorrência só com a caixa «concordo» marcada.
 * - recusar: conta a recusa e vai para o próximo passo (downsell só para quem recusou o upsell).
 * - continuar: a oferta já tinha terminado; só avança.
 * Um formulário velho (passo que já passou) só volta para a página do passo atual.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug, sessao: sessaoId } = await params;
  const produto = await getProdutoPublico(slug);
  if (!produto) return new NextResponse("Produto não encontrado.", { status: 404 });
  const sessao = await getSessao(sessaoId, produto.id);
  if (!sessao) return new NextResponse("Sessão não encontrada.", { status: 404 });

  const form = await request.formData().catch(() => null);
  const etapa = String(form?.get("etapa") ?? "") as Etapa;
  const acao = String(form?.get("acao") ?? "");
  const pagina = `/p/${produto.slug}/oferta/${sessao.id}`;
  if (!(ETAPAS as readonly string[]).includes(etapa) || etapa !== sessao.etapa || etapa === "obrigado") return voltar(request, pagina);
  if (acao !== "aceitar" && acao !== "recusar" && acao !== "continuar") return voltar(request, pagina);

  const atual = precoAtual(produto.escada, etapa, sessao.ofertaExpiraEm);

  if (acao === "aceitar") {
    if (atual.situacao === "encerrada") return voltar(request, pagina); // o prazo venceu entre abrir a página e tocar
    if (etapa === "recorrencia" && form?.get("concordo") !== "on") return voltar(request, `${pagina}?erro=concordo`);
    const para = proximaEtapa(produto.escada, etapa, "aceitar");
    const avancou = await avancarSessao(sessao.id, etapa, para, { aceitouRecorrencia: etapa === "recorrencia" });
    if (!avancou) return voltar(request, pagina);
    await registrarEventoFunil(produto.id, `aceitou_${etapa}` as TipoEvento, { sessaoId: sessao.id, valor: atual.preco });
    return NextResponse.redirect(atual.checkoutUrl, { status: 303, headers: { "cache-control": "no-store" } });
  }

  const para = proximaEtapa(produto.escada, etapa, "recusar");
  const avancou = await avancarSessao(sessao.id, etapa, para);
  if (avancou && acao === "recusar") await registrarEventoFunil(produto.id, `recusou_${etapa}` as TipoEvento, { sessaoId: sessao.id });
  return voltar(request, para === "obrigado" ? `/p/${produto.slug}/obrigado` : pagina);
}
