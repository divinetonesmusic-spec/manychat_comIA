import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { getProdutoPublico } from "@/lib/db/funil";
import { formatarPreco } from "@/lib/vendas/escada";
import { BotaoComprar } from "../bump";
import { Aviso, Cartao, dataPorExtenso, PaginaPublica, Preco, Rodape } from "../publico";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const produto = await getProdutoPublico(slug).catch(() => null);
  return { title: produto ? produto.nome : "Produto", description: produto?.promessa || undefined, robots: { index: false } };
}

/** Página de uma tela do produto (normal ou pré-venda): nome, promessa, preço, o que recebe e o botão de pagamento. */
export default async function ProdutoPage({ params }: Props) {
  const { slug } = await params;
  const produto = await getProdutoPublico(slug);
  if (!produto) notFound();
  const prevenda = produto.modo === "prevenda";
  const bump = produto.escada.bump;

  return (
    <PaginaPublica>
      <Cartao>
        {prevenda ? (
          <p className="w-fit rounded-full bg-[var(--ms-primary)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">Pré-venda</p>
        ) : null}
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{produto.nome}</h1>
        {produto.promessa ? <p className="text-lg text-[var(--ms-muted)]">{produto.promessa}</p> : null}
        <Preco valor={produto.preco} moeda={produto.moeda} />
        {prevenda && produto.prevendaEntrega ? (
          <Aviso>
            Você paga hoje e recebe até <strong>{dataPorExtenso(produto.prevendaEntrega)}</strong>. Avisamos por e-mail no dia da entrega.
          </Aviso>
        ) : null}
        {produto.oQueRecebe.length ? (
          <div className="grid gap-2">
            <h2 className="text-base font-bold">O que você recebe</h2>
            <ul className="grid gap-2">
              {produto.oQueRecebe.map((item) => (
                <li className="flex items-start gap-2" key={item}><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} /> <span>{item}</span></li>
              ))}
            </ul>
          </div>
        ) : null}
        {produto.checkoutUrl ? (
          <BotaoComprar
            slug={produto.slug}
            rotulo={prevenda ? "Garantir na pré-venda" : "Quero agora"}
            bump={bump ? { nome: bump.nome, precoTexto: formatarPreco(bump.preco, produto.moeda), texto: bump.texto } : null}
          />
        ) : (
          <Aviso tom="erro">O pagamento deste produto ainda não foi configurado.</Aviso>
        )}
      </Cartao>
      <Rodape />
    </PaginaPublica>
  );
}
