import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getProdutoPublico, getSessao, registrarEventoFunil } from "@/lib/db/funil";
import { cookieSessao } from "@/lib/vendas/funil-web";
import { Aviso, Cartao, dataPorExtenso, PaginaPublica } from "../../publico";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Obrigado", robots: { index: false } };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; erro?: string }> };

/**
 * Página de obrigado do produto: texto configurável, o próximo passo (oferta, curso por e-mail ou convite) e o
 * formulário que guarda o e-mail na lista própria (nunca só na plataforma de pagamento).
 */
export default async function ObrigadoPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { ok, erro } = await searchParams;
  const produto = await getProdutoPublico(slug);
  if (!produto) notFound();
  const sessao = await getSessao((await cookies()).get(cookieSessao(produto.slug))?.value, produto.id);
  if (sessao) await registrarEventoFunil(produto.id, "viu_obrigado", { sessaoId: sessao.id });

  const passo = produto.obrigado.proximoPasso;
  const recorrencia = sessao?.aceitouRecorrencia ? produto.escada.recorrencia : null;
  const prevenda = produto.modo === "prevenda";

  return (
    <PaginaPublica>
      <Cartao>
        <h1 className="text-3xl font-bold">Obrigado pela compra!</h1>
        <p className="whitespace-pre-line text-lg">{produto.obrigado.texto || `Sua compra de ${produto.nome} está confirmada. O acesso chega no e-mail que você usou no pagamento.`}</p>
        {prevenda && produto.prevendaEntrega ? (
          <Aviso>Este produto está em pré-venda: a entrega é até <strong>{dataPorExtenso(produto.prevendaEntrega)}</strong>. Deixe seu e-mail abaixo para ser avisado no dia.</Aviso>
        ) : null}
        {recorrencia ? (
          <Aviso>
            Você assinou {recorrencia.nome}. Para cancelar quando quiser: <a className="font-semibold underline" href={recorrencia.cancelarUrl} rel="noopener noreferrer" target="_blank">link de cancelamento</a>.
          </Aviso>
        ) : null}
      </Cartao>

      <Cartao>
        <h2 className="text-xl font-bold">{prevenda ? "Onde avisamos na entrega?" : "Receba as próximas dicas"}</h2>
        {ok ? (
          <Aviso tom="ok">Pronto! Seu e-mail está anotado.</Aviso>
        ) : (
          <form action={`/p/${produto.slug}/obrigado/email`} className="grid gap-3" method="post">
            {erro === "email" ? <Aviso tom="erro">Confira o e-mail: parece que falta alguma coisa.</Aviso> : null}
            <label className="field"><span>Seu e-mail</span><input autoComplete="email" className="input" name="email" required type="email" /></label>
            <label className="field"><span>Seu nome (opcional)</span><input autoComplete="given-name" className="input" maxLength={120} name="nome" /></label>
            {/* campo escondido contra robôs: pessoa não preenche */}
            <input aria-hidden="true" autoComplete="off" className="hidden" name="site" tabIndex={-1} />
            <label className="flex items-start gap-3 text-sm">
              <input className="mt-1 h-5 w-5 shrink-0" name="novidades" type="checkbox" value="on" />
              <span>Quero receber novidades e ofertas por e-mail (opcional; dá para sair quando quiser).</span>
            </label>
            <p className="text-xs text-[var(--ms-muted)]">Usamos o e-mail para avisos desta compra{produto.depoimentoAtivo ? ` e para perguntar, daqui a ${produto.depoimentoDias} dias, como está sendo` : ""}. Todo e-mail tem o link para sair da lista.</p>
            <button className="btn-primary min-h-11" type="submit">Enviar</button>
          </form>
        )}
      </Cartao>

      {passo.tipo !== "nenhum" && passo.titulo ? (
        <Cartao>
          <p className="text-sm font-semibold text-[var(--ms-muted)]">Próximo passo</p>
          <h2 className="text-2xl font-bold">{passo.titulo}</h2>
          {passo.texto ? <p className="whitespace-pre-line">{passo.texto}</p> : null}
          {passo.link ? <a className="btn-primary min-h-11" href={passo.link} rel="noopener noreferrer">{passo.tipo === "curso_email" ? "Quero o curso" : passo.tipo === "convite" ? "Aceitar o convite" : "Ver a oferta"}</a> : null}
        </Cartao>
      ) : null}
    </PaginaPublica>
  );
}
