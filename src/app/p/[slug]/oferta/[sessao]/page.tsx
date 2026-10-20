import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getProdutoPublico, getSessao, registrarEventoFunil } from "@/lib/db/funil";
import { formatarPreco, ofertaDaEtapa, precoAtual, termosRecorrencia, type OfertaDownsell } from "@/lib/vendas/escada";
import { Contagem } from "../../../contagem";
import { Aviso, Cartao, PaginaPublica, Preco, Rodape } from "../../../publico";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sua compra", robots: { index: false } };

type Props = { params: Promise<{ slug: string; sessao: string }>; searchParams: Promise<{ erro?: string }> };

/**
 * Oferta depois da compra: upsell (com o prazo real, se houver), downsell (só para quem recusou o upsell) e
 * recorrência (com os termos e o link de cancelamento antes do «Sim»). Cada passo é contado uma vez por sessão.
 */
export default async function OfertaPage({ params, searchParams }: Props) {
  const { slug, sessao: sessaoId } = await params;
  const { erro } = await searchParams;
  const produto = await getProdutoPublico(slug);
  if (!produto) notFound();
  const sessao = await getSessao(sessaoId, produto.id);
  if (!sessao) notFound();
  if (sessao.etapa === "obrigado") redirect(`/p/${produto.slug}/obrigado`);

  const etapa = sessao.etapa;
  const oferta = ofertaDaEtapa(produto.escada, etapa);
  const atual = precoAtual(produto.escada, etapa, sessao.ofertaExpiraEm);
  if (oferta && atual.situacao !== "encerrada") {
    await registrarEventoFunil(produto.id, etapa === "upsell" ? "viu_upsell" : etapa === "downsell" ? "viu_downsell" : "viu_recorrencia", { sessaoId: sessao.id, valor: atual.preco });
  }
  const acao = `/p/${produto.slug}/oferta/${sessao.id}/acao`;

  if (!oferta || atual.situacao === "encerrada") {
    return (
      <PaginaPublica>
        <Cartao>
          <h1 className="text-2xl font-bold">A oferta com desconto terminou</h1>
          <p className="text-[var(--ms-muted)]">O prazo desta oferta já passou. Sua compra está confirmada.</p>
          <form action={acao} method="post">
            <input name="etapa" type="hidden" value={etapa} />
            <button className="btn-primary min-h-12 w-full text-base" name="acao" type="submit" value="continuar">Continuar</button>
          </form>
        </Cartao>
      </PaginaPublica>
    );
  }

  const recorrencia = etapa === "recorrencia" ? produto.escada.recorrencia : null;
  const parcelas = etapa === "downsell" ? (oferta as OfertaDownsell).parcelas : null;
  const titulo = etapa === "upsell" ? "Sua compra está confirmada. Antes de ir:" : etapa === "downsell" ? "Tudo bem! Que tal uma versão menor?" : "Quer continuar recebendo todo mês?";

  return (
    <PaginaPublica>
      <Aviso tom="ok">Pagamento recebido. Esta página não cobra nada sozinha: só sai cobrança se você tocar em «Sim».</Aviso>
      <Cartao>
        <p className="text-sm font-semibold text-[var(--ms-muted)]">{titulo}</p>
        <h1 className="text-3xl font-bold leading-tight">{oferta.nome}</h1>
        {oferta.texto ? <p className="text-lg">{oferta.texto}</p> : null}
        <Preco valor={atual.preco} moeda={produto.moeda} riscado={atual.situacao === "desconto" ? produto.escada.upsell?.precoCheio ?? null : null} />
        {recorrencia ? <p className="-mt-2 text-sm text-[var(--ms-muted)]">por mês, até você cancelar</p> : null}
        {parcelas ? <p className="-mt-2 text-sm text-[var(--ms-muted)]">ou em {parcelas}x de {formatarPreco(Math.round((atual.preco / parcelas) * 100) / 100, produto.moeda)}</p> : null}
        {atual.situacao === "desconto" && sessao.ofertaExpiraEm ? <Contagem expiraEm={sessao.ofertaExpiraEm} /> : null}
        {atual.situacao === "cheio" ? <Aviso>O prazo do desconto terminou; este é o preço normal.</Aviso> : null}

        {erro === "concordo" ? <Aviso tom="erro">Para assinar, marque a caixa dizendo que leu e concorda com a cobrança mensal.</Aviso> : null}

        <form action={acao} className="grid gap-3" method="post">
          <input name="etapa" type="hidden" value={etapa} />
          {recorrencia ? (
            <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] p-4 text-sm">
              <p><strong>Termos da assinatura:</strong> {termosRecorrencia(recorrencia, produto.moeda)}</p>
              <p>
                Cancelar é fácil: <a className="font-semibold underline" href={recorrencia.cancelarUrl} rel="noopener noreferrer" target="_blank">link de cancelamento</a> (o mesmo link vai no seu e-mail de confirmação).
              </p>
              <label className="flex items-start gap-3">
                <input className="mt-1 h-5 w-5 shrink-0" name="concordo" required type="checkbox" value="on" />
                <span>Li os termos e concordo com a cobrança de {formatarPreco(atual.preco, produto.moeda)} por mês até eu cancelar.</span>
              </label>
            </div>
          ) : null}
          <button className="btn-primary min-h-12 text-base" name="acao" type="submit" value="aceitar">
            Sim, quero por {formatarPreco(atual.preco, produto.moeda)}{recorrencia ? "/mês" : ""}
          </button>
          <button className="btn-secondary min-h-11" formNoValidate name="acao" type="submit" value="recusar">Não, obrigado</button>
        </form>
      </Cartao>
      <Rodape />
    </PaginaPublica>
  );
}
