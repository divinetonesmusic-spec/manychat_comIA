"use client";

import { useState } from "react";
import { Copy, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import type { Comprador, Depoimento, MetricasProduto, Produto } from "@/lib/db/funil";
import { FAIXAS, formatarPreco } from "@/lib/vendas/escada";
import { MOEDAS, PROXIMO_PASSO_NOME, PROXIMOS_PASSOS, slugify, type ProdutoInput, type ProximoPassoTipo } from "@/lib/vendas/produto";

type ProdutoTela = Produto & { metricas: MetricasProduto | null; avisos: string[] };
type DepoimentoTela = Depoimento & { texto: string; printUrl: string | null };
type Inicial = { produtos: ProdutoTela[]; compradores: Comprador[]; depoimentos: DepoimentoTela[] };
type Aba = "produtos" | "compradores" | "depoimentos";
type Nota = { tom: "ok" | "erro" | "aviso"; texto: string } | null;

/* ---------------- formulário ---------------- */

type OfertaForm = { nome: string; preco: string; texto: string; checkoutUrl: string; produtoRef: string };
type Form = {
  id?: string;
  nome: string; slug: string; promessa: string; preco: string; moeda: string; produtoRef: string; checkoutUrl: string;
  modo: "normal" | "prevenda"; prevendaEntrega: string; oQueRecebe: string;
  bump: OfertaForm;
  upsell: OfertaForm & { prazoMinutos: string; precoCheio: string; checkoutUrlCheio: string };
  downsell: OfertaForm & { parcelas: string };
  recorrencia: OfertaForm & { cancelarUrl: string; termos: string };
  obrigadoTexto: string; passoTipo: ProximoPassoTipo; passoTitulo: string; passoTexto: string; passoLink: string;
  depoimentoAtivo: boolean; depoimentoDias: string; ativo: boolean;
};

const ofertaVazia = (): OfertaForm => ({ nome: "", preco: "", texto: "", checkoutUrl: "", produtoRef: "" });
const num = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

export function formVazio(): Form {
  return {
    nome: "", slug: "", promessa: "", preco: "", moeda: "USD", produtoRef: "", checkoutUrl: "", modo: "normal", prevendaEntrega: "", oQueRecebe: "",
    bump: ofertaVazia(),
    upsell: { ...ofertaVazia(), prazoMinutos: "15", precoCheio: "", checkoutUrlCheio: "" },
    downsell: { ...ofertaVazia(), parcelas: "" },
    recorrencia: { ...ofertaVazia(), cancelarUrl: "", termos: "" },
    obrigadoTexto: "", passoTipo: "nenhum", passoTitulo: "", passoTexto: "", passoLink: "",
    depoimentoAtivo: true, depoimentoDias: "7", ativo: true,
  };
}

function ofertaParaForm(oferta: { nome: string; preco: number; texto: string; checkoutUrl: string; produtoRef?: string | null } | null | undefined): OfertaForm {
  return oferta ? { nome: oferta.nome, preco: num(oferta.preco), texto: oferta.texto, checkoutUrl: oferta.checkoutUrl, produtoRef: oferta.produtoRef ?? "" } : ofertaVazia();
}

export function formDoProduto(produto: Partial<ProdutoInput> & { id?: string }): Form {
  const base = formVazio();
  const e = produto.escada ?? {};
  const passo = produto.obrigado?.proximoPasso;
  return {
    ...base,
    id: produto.id,
    nome: produto.nome ?? "", slug: produto.slug ?? "", promessa: produto.promessa ?? "", preco: num(produto.preco), moeda: produto.moeda ?? "USD",
    produtoRef: produto.produtoRef ?? "", checkoutUrl: produto.checkoutUrl ?? "", modo: produto.modo ?? "normal", prevendaEntrega: produto.prevendaEntrega ?? "",
    oQueRecebe: (produto.oQueRecebe ?? []).join("\n"),
    bump: ofertaParaForm(e.bump),
    upsell: { ...ofertaParaForm(e.upsell), prazoMinutos: e.upsell ? num(e.upsell.prazoMinutos) : base.upsell.prazoMinutos, precoCheio: num(e.upsell?.precoCheio), checkoutUrlCheio: e.upsell?.checkoutUrlCheio ?? "" },
    downsell: { ...ofertaParaForm(e.downsell), parcelas: num(e.downsell?.parcelas) },
    recorrencia: { ...ofertaParaForm(e.recorrencia), cancelarUrl: e.recorrencia?.cancelarUrl ?? "", termos: e.recorrencia?.termos ?? "" },
    obrigadoTexto: produto.obrigado?.texto ?? "", passoTipo: passo?.tipo ?? "nenhum", passoTitulo: passo?.titulo ?? "", passoTexto: passo?.texto ?? "", passoLink: passo?.link ?? "",
    depoimentoAtivo: produto.depoimentoAtivo ?? true, depoimentoDias: num(produto.depoimentoDias ?? 7), ativo: produto.ativo ?? true,
  };
}

const vazia = (oferta: OfertaForm) => !oferta.nome.trim() && !oferta.preco.trim() && !oferta.checkoutUrl.trim();

/** O que a tela manda para a API (ofertas vazias = desligadas). */
export function payloadDoForm(form: Form) {
  const oferta = (o: OfertaForm) => ({ nome: o.nome, preco: o.preco, texto: o.texto, checkoutUrl: o.checkoutUrl, produtoRef: o.produtoRef });
  return {
    nome: form.nome, slug: form.slug || slugify(form.nome), promessa: form.promessa, preco: form.preco, moeda: form.moeda, produtoRef: form.produtoRef,
    checkoutUrl: form.checkoutUrl, modo: form.modo, prevendaEntrega: form.prevendaEntrega, oQueRecebe: form.oQueRecebe,
    escada: {
      bump: vazia(form.bump) ? null : oferta(form.bump),
      upsell: vazia(form.upsell) ? null : { ...oferta(form.upsell), prazoMinutos: form.upsell.prazoMinutos, precoCheio: form.upsell.precoCheio || null, checkoutUrlCheio: form.upsell.checkoutUrlCheio },
      downsell: vazia(form.downsell) ? null : { ...oferta(form.downsell), parcelas: form.downsell.parcelas || null },
      recorrencia: vazia(form.recorrencia) ? null : { ...oferta(form.recorrencia), cancelarUrl: form.recorrencia.cancelarUrl, termos: form.recorrencia.termos },
    },
    obrigado: { texto: form.obrigadoTexto, proximoPasso: { tipo: form.passoTipo, titulo: form.passoTitulo, texto: form.passoTexto, link: form.passoLink } },
    depoimentoAtivo: form.depoimentoAtivo, depoimentoDias: form.depoimentoDias, ativo: form.ativo,
  };
}

/* ---------------- tela ---------------- */

export function VendasClient({ inicial, baseUrl, emailConfigurado }: { inicial: Inicial; baseUrl: string; emailConfigurado: boolean }) {
  const [aba, setAba] = useState<Aba>("produtos");
  const [produtos, setProdutos] = useState(inicial.produtos);
  const [form, setForm] = useState<Form | null>(null);
  const [nota, setNota] = useState<Nota>(null);
  const base = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");

  async function recarregar() {
    const resposta = await fetch("/api/vendas/produtos", { cache: "no-store" });
    const json = (await resposta.json().catch(() => null)) as { data?: ProdutoTela[] } | null;
    if (json?.data) setProdutos(json.data);
  }

  async function apagar(produto: ProdutoTela) {
    if (!window.confirm(`Apagar ${produto.nome}? A página sai do ar e as métricas deste produto somem.`)) return;
    const resposta = await fetch(`/api/vendas/produtos/${produto.id}`, { method: "DELETE" });
    if (!resposta.ok) return setNota({ tom: "erro", texto: "Não consegui apagar." });
    setProdutos((lista) => lista.filter((item) => item.id !== produto.id));
    setNota({ tom: "ok", texto: "Produto apagado." });
  }

  async function marcarAvisados(produto: ProdutoTela) {
    const resposta = await fetch(`/api/vendas/produtos/${produto.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "marcar_avisados" }) });
    const json = (await resposta.json().catch(() => null)) as { marcados?: number; error?: string } | null;
    setNota(resposta.ok ? { tom: "ok", texto: `${json?.marcados ?? 0} comprador(es) da pré-venda marcados como avisados.` } : { tom: "erro", texto: json?.error || "Não consegui marcar." });
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap gap-2" role="tablist">
        {(["produtos", "compradores", "depoimentos"] as Aba[]).map((item) => (
          <button aria-selected={aba === item} className={aba === item ? "btn-primary" : "btn-secondary"} key={item} onClick={() => setAba(item)} role="tab" type="button">
            {item === "produtos" ? "Produtos" : item === "compradores" ? `Lista própria (${inicial.compradores.length})` : `Depoimentos (${inicial.depoimentos.length})`}
          </button>
        ))}
      </div>

      {nota ? <p className={`rounded-lg border px-4 py-3 text-sm ${nota.tom === "erro" ? "border-red-300 text-red-600" : nota.tom === "aviso" ? "border-amber-300 text-amber-700" : "border-emerald-300 text-emerald-700"}`}>{nota.texto}</p> : null}

      {aba === "produtos" ? (
        form ? (
          <Editor
            form={form}
            onCancel={() => setForm(null)}
            onChange={setForm}
            onSaved={async (texto, tom) => { setForm(null); setNota({ tom, texto }); await recarregar(); }}
          />
        ) : (
          <section className="grid gap-4">
            <button className="btn-primary w-fit" onClick={() => setForm(formVazio())} type="button"><Plus size={16} /> Novo produto</button>
            {produtos.length ? produtos.map((produto) => (
              <CartaoProduto base={base} key={produto.id} onApagar={() => apagar(produto)} onAvisados={() => marcarAvisados(produto)} onEditar={() => setForm(formDoProduto(produto))} onCopiado={(texto) => setNota({ tom: "ok", texto })} produto={produto} />
            )) : <p className="panel p-6 text-sm text-[var(--ms-muted)]">Nenhum produto ainda. Crie o primeiro ou importe a escada do Molde.</p>}
          </section>
        )
      ) : null}

      {aba === "compradores" ? <ListaCompradores base={base} compradores={inicial.compradores} emailConfigurado={emailConfigurado} onCopiado={(texto) => setNota({ tom: "ok", texto })} /> : null}
      {aba === "depoimentos" ? <ListaDepoimentos depoimentos={inicial.depoimentos} onCopiado={(texto) => setNota({ tom: "ok", texto })} /> : null}
    </div>
  );
}

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

function dinheiro(valor: number | null | undefined, moeda: string) {
  return valor === null || valor === undefined ? "—" : formatarPreco(valor, moeda);
}

function pct(valor: number | null | undefined) {
  return valor === null || valor === undefined ? "—" : `${valor}%`;
}

function CartaoProduto({ produto, base, onEditar, onApagar, onAvisados, onCopiado }: { produto: ProdutoTela; base: string; onEditar: () => void; onApagar: () => void; onAvisados: () => void; onCopiado: (texto: string) => void }) {
  const m = produto.metricas;
  const links = [
    { rotulo: "Página do produto", url: `${base}/p/${produto.slug}` },
    { rotulo: "Depois do pagamento (cole na plataforma)", url: `${base}/p/${produto.slug}/oferta?compra={CHECKOUT_SESSION_ID}` },
    { rotulo: "Obrigado", url: `${base}/p/${produto.slug}/obrigado` },
  ];
  return (
    <article className="panel grid gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{produto.nome} {produto.modo === "prevenda" ? <span className="ml-2 rounded-full bg-[var(--ms-primary)] px-2 py-0.5 text-xs text-white">Pré-venda</span> : null} {!produto.ativo ? <span className="ml-2 text-xs text-[var(--ms-muted)]">(fora do ar)</span> : null}</h2>
          <p className="text-sm text-[var(--ms-muted)]">{formatarPreco(produto.preco, produto.moeda)} · /p/{produto.slug}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={onEditar} type="button"><Pencil size={15} /> Editar</button>
          <button className="btn-secondary" onClick={onApagar} type="button"><Trash2 size={15} /> Apagar</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Numero rotulo="Valor médio por comprador (vendas reais, 30 dias)" valor={dinheiro(m?.valorMedioReal, produto.moeda)} />
        <Numero rotulo="Valor médio estimado (pelos aceites)" valor={dinheiro(m?.valorMedioEstimado, produto.moeda)} />
        <Numero rotulo="Compradores que chegaram na oferta" valor={String(m?.compradores ?? 0)} />
        <Numero rotulo="E-mails na lista própria" valor={String(m?.emails ?? 0)} />
        <Numero rotulo="Upsell: viram / aceitaram" valor={`${m?.upsell.viram ?? 0} / ${m?.upsell.aceitaram ?? 0} (${pct(m?.upsell.taxa)})`} />
        <Numero rotulo="Downsell: viram / aceitaram" valor={`${m?.downsell.viram ?? 0} / ${m?.downsell.aceitaram ?? 0} (${pct(m?.downsell.taxa)})`} />
        <Numero rotulo="Assinatura: viram / aceitaram" valor={`${m?.recorrencia.viram ?? 0} / ${m?.recorrencia.aceitaram ?? 0} (${pct(m?.recorrencia.taxa)})`} />
        <Numero rotulo="Order bump (cliques)" valor={`${m?.bump.cliques ?? 0} (${pct(m?.bump.taxa)})`} />
      </div>
      {m?.valorMedioReal === null && produto.produtoRef ? <p className="text-xs text-[var(--ms-muted)]">O valor real aparece quando as vendas com a referência «{produto.produtoRef}» chegarem pelo webhook.</p> : null}
      {!produto.produtoRef ? <p className="text-xs text-[var(--ms-muted)]">Para o valor médio real, preencha a referência da venda (produtoRef) da entrada e de cada degrau.</p> : null}
      {produto.avisos.length ? <p className="text-xs text-amber-700">{produto.avisos.join(" ")}</p> : null}

      <div className="grid gap-2">
        {links.map((link) => (
          <div className="flex flex-wrap items-center gap-2 text-sm" key={link.rotulo}>
            <span className="min-w-56 text-[var(--ms-muted)]">{link.rotulo}</span>
            <code className="break-all rounded bg-[var(--ms-surface-soft)] px-2 py-1 text-xs">{link.url}</code>
            <button className="icon-button h-8 w-8" onClick={async () => onCopiado((await copiar(link.url)) ? "Link copiado." : link.url)} title="Copiar" type="button"><Copy size={14} /></button>
          </div>
        ))}
      </div>

      {produto.modo === "prevenda" ? (
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/api/vendas/compradores?produtoId=${produto.id}&prevenda=1&formato=csv`}><Download size={15} /> Lista da pré-venda (CSV)</a>
          <button className="btn-secondary" onClick={onAvisados} type="button">Marcar todos como avisados da entrega</button>
        </div>
      ) : null}
    </article>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-[var(--ms-border)] p-3">
      <p className="text-xs text-[var(--ms-muted)]">{rotulo}</p>
      <p className="mt-1 text-lg font-semibold">{valor}</p>
    </div>
  );
}

/* ---------------- editor ---------------- */

function Editor({ form, onChange, onCancel, onSaved }: { form: Form; onChange: (form: Form) => void; onCancel: () => void; onSaved: (texto: string, tom: "ok" | "aviso") => void }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [json, setJson] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const set = (patch: Partial<Form>) => onChange({ ...form, ...patch });

  async function importar() {
    setErro(null);
    setAviso(null);
    const resposta = await fetch("/api/vendas/escada-molde", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ json }) });
    const resultado = (await resposta.json().catch(() => null)) as { data?: Partial<ProdutoInput>; error?: string; warning?: string } | null;
    if (!resultado?.data) return setErro(resultado?.error || "Não consegui ler o JSON.");
    const novo = formDoProduto({ ...resultado.data });
    onChange({ ...novo, id: form.id, moeda: form.moeda, ativo: form.ativo });
    setAviso(`Escada importada. Confira os campos${resultado.warning ? `: ${resultado.warning}` : "."}`);
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(form.id ? `/api/vendas/produtos/${form.id}` : "/api/vendas/produtos", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadDoForm(form)),
      });
      const resultado = (await resposta.json().catch(() => null)) as { data?: Produto; error?: string; warning?: string } | null;
      if (!resultado?.data) throw new Error(resultado?.error || "Não consegui salvar.");
      onSaved(resultado.warning ? `Salvo. ${resultado.warning}` : "Produto salvo.", resultado.warning ? "aviso" : "ok");
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não consegui salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="panel grid gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{form.id ? "Editar produto" : "Novo produto"}</h2>
        <button className="btn-secondary" onClick={onCancel} type="button">Fechar</button>
      </div>

      <details className="rounded-lg border border-[var(--ms-border)] p-3">
        <summary className="cursor-pointer text-sm font-bold"><Upload className="mr-1 inline" size={14} /> Importar a escada da página do Molde (JSON)</summary>
        <div className="mt-3 grid gap-2">
          <textarea className="input min-h-32 font-mono text-xs" onChange={(event) => setJson(event.target.value)} placeholder='{"entrada":{"nome":"...","preco":17},"meio":{...},"topo":{...},"obrigado":{"texto":"..."}}' value={json} />
          <p className="text-xs text-[var(--ms-muted)]">entrada = este produto; meio = upsell depois da compra; topo = próximo passo da página de obrigado; obrigado.texto = texto do obrigado.</p>
          <button className="btn-secondary w-fit" disabled={!json.trim()} onClick={importar} type="button">Importar</button>
        </div>
      </details>
      {aviso ? <p className="text-sm text-amber-700">{aviso}</p> : null}

      <Grupo titulo="Produto de entrada">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome" valor={form.nome} onChange={(nome) => set({ nome, slug: form.id || form.slug ? form.slug : "" })} />
          <Campo dica={`/p/${form.slug || slugify(form.nome) || "..."}`} rotulo="Endereço (slug)" valor={form.slug} onChange={(slug) => set({ slug: slug.toLowerCase() })} />
        </div>
        <Campo rotulo="Promessa (uma frase)" valor={form.promessa} onChange={(promessa) => set({ promessa })} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Preço" tipo="number" valor={form.preco} onChange={(preco) => set({ preco })} />
          <label className="field"><span>Moeda</span><select className="input" onChange={(event) => set({ moeda: event.target.value })} value={form.moeda}>{MOEDAS.map((moeda) => <option key={moeda}>{moeda}</option>)}</select></label>
          <Campo dica="o produtoRef que chega no webhook" rotulo="Referência da venda" valor={form.produtoRef} onChange={(produtoRef) => set({ produtoRef })} />
        </div>
        <Campo rotulo="Link de pagamento (na plataforma)" tipo="url" valor={form.checkoutUrl} onChange={(checkoutUrl) => set({ checkoutUrl })} />
        <label className="field"><span>O que recebe (um por linha)</span><textarea className="input min-h-24" onChange={(event) => set({ oQueRecebe: event.target.value })} value={form.oQueRecebe} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="check justify-start"><input checked={form.modo === "prevenda"} onChange={(event) => set({ modo: event.target.checked ? "prevenda" : "normal" })} type="checkbox" /> <span>Pré-venda</span></label>
          {form.modo === "prevenda" ? <Campo rotulo="Prazo de entrega" tipo="date" valor={form.prevendaEntrega} onChange={(prevendaEntrega) => set({ prevendaEntrega })} /> : null}
        </div>
        <label className="check justify-start"><input checked={form.ativo} onChange={(event) => set({ ativo: event.target.checked })} type="checkbox" /> <span>Página no ar</span></label>
      </Grupo>

      <Grupo titulo={`Order bump (US$ ${FAIXAS.bump.min}–${FAIXAS.bump.max}) · opcional`} descricao="Caixa marcável na página do produto. O link é o da plataforma que já traz a entrada + o bump juntos.">
        <CamposOferta oferta={form.bump} onChange={(bump) => set({ bump })} rotuloLink="Link de pagamento da entrada + bump" />
      </Grupo>

      <Grupo titulo={`Upsell de 1 clique (US$ ${FAIXAS.upsell.min}–${FAIXAS.upsell.max}) · opcional`} descricao="Mostrado logo depois da compra. O prazo do desconto é gravado quando a pessoa chega e vence de verdade (recarregar não reinicia).">
        <CamposOferta oferta={form.upsell} onChange={(o) => set({ upsell: { ...form.upsell, ...o } })} rotuloLink="Link de pagamento com desconto" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo dica="0 = sem prazo" rotulo="Prazo do desconto (minutos)" tipo="number" valor={form.upsell.prazoMinutos} onChange={(prazoMinutos) => set({ upsell: { ...form.upsell, prazoMinutos } })} />
          <Campo dica="depois do prazo (opcional)" rotulo="Preço cheio" tipo="number" valor={form.upsell.precoCheio} onChange={(precoCheio) => set({ upsell: { ...form.upsell, precoCheio } })} />
          <Campo rotulo="Link do preço cheio" tipo="url" valor={form.upsell.checkoutUrlCheio} onChange={(checkoutUrlCheio) => set({ upsell: { ...form.upsell, checkoutUrlCheio } })} />
        </div>
      </Grupo>

      <Grupo titulo={`Downsell (US$ ${FAIXAS.downsell.min}–${FAIXAS.downsell.max} ou parcelado) · opcional`} descricao="Só aparece para quem recusou o upsell.">
        <CamposOferta oferta={form.downsell} onChange={(o) => set({ downsell: { ...form.downsell, ...o } })} rotuloLink="Link de pagamento" />
        <Campo dica="só texto; o parcelamento é configurado na plataforma" rotulo="Parcelas (opcional)" tipo="number" valor={form.downsell.parcelas} onChange={(parcelas) => set({ downsell: { ...form.downsell, parcelas } })} />
      </Grupo>

      <Grupo titulo={`Recorrência (US$ ${FAIXAS.recorrencia.min}–${FAIXAS.recorrencia.max}/mês) · opcional`} descricao="Lei dos EUA (ROSCA): termos e link de cancelamento aparecem antes do «Sim», e a pessoa precisa marcar que concorda.">
        <CamposOferta oferta={form.recorrencia} onChange={(o) => set({ recorrencia: { ...form.recorrencia, ...o } })} rotuloLink="Link da assinatura" rotuloPreco="Preço por mês" />
        <Campo dica="ex.: portal do cliente da Stripe" rotulo="Link de cancelamento (obrigatório)" tipo="url" valor={form.recorrencia.cancelarUrl} onChange={(cancelarUrl) => set({ recorrencia: { ...form.recorrencia, cancelarUrl } })} />
        <label className="field"><span>Termos (opcional; sem texto, o UaiFlow usa um padrão claro)</span><textarea className="input min-h-20" onChange={(event) => set({ recorrencia: { ...form.recorrencia, termos: event.target.value } })} value={form.recorrencia.termos} /></label>
      </Grupo>

      <Grupo titulo="Página de obrigado">
        <label className="field"><span>Texto</span><textarea className="input min-h-20" onChange={(event) => set({ obrigadoTexto: event.target.value })} value={form.obrigadoTexto} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field"><span>Próximo passo</span><select className="input" onChange={(event) => set({ passoTipo: event.target.value as ProximoPassoTipo })} value={form.passoTipo}>{PROXIMOS_PASSOS.map((tipo) => <option key={tipo} value={tipo}>{PROXIMO_PASSO_NOME[tipo]}</option>)}</select></label>
          {form.passoTipo !== "nenhum" ? <Campo rotulo="Título do próximo passo" valor={form.passoTitulo} onChange={(passoTitulo) => set({ passoTitulo })} /> : null}
        </div>
        {form.passoTipo !== "nenhum" ? (
          <>
            <label className="field"><span>Texto do próximo passo</span><textarea className="input min-h-16" onChange={(event) => set({ passoTexto: event.target.value })} value={form.passoTexto} /></label>
            <Campo rotulo="Link do próximo passo" tipo="url" valor={form.passoLink} onChange={(passoLink) => set({ passoLink })} />
          </>
        ) : null}
        <p className="text-xs text-[var(--ms-muted)]">A página de obrigado sempre pede o e-mail do comprador e guarda na lista própria do UaiFlow.</p>
      </Grupo>

      <Grupo titulo="Pedido de depoimento">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="check justify-start"><input checked={form.depoimentoAtivo} onChange={(event) => set({ depoimentoAtivo: event.target.checked })} type="checkbox" /> <span>Pedir depoimento por e-mail</span></label>
          <Campo rotulo="Dias depois da compra" tipo="number" valor={form.depoimentoDias} onChange={(depoimentoDias) => set({ depoimentoDias })} />
        </div>
      </Grupo>

      {erro ? <p className="text-sm text-red-600">{erro}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={salvando} onClick={salvar} type="button">{salvando ? "Salvando..." : "Salvar"}</button>
        <button className="btn-secondary" onClick={onCancel} type="button">Cancelar</button>
      </div>
    </section>
  );
}

function Grupo({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border border-[var(--ms-border)] p-4">
      <legend className="px-1 text-sm font-bold">{titulo}</legend>
      {descricao ? <p className="text-xs text-[var(--ms-muted)]">{descricao}</p> : null}
      {children}
    </fieldset>
  );
}

function Campo({ rotulo, valor, onChange, tipo = "text", dica }: { rotulo: string; valor: string; onChange: (valor: string) => void; tipo?: string; dica?: string }) {
  return (
    <label className="field">
      <span>{rotulo}{dica ? <small className="ml-2 font-normal text-[var(--ms-muted)]">{dica}</small> : null}</span>
      <input className="input" onChange={(event) => onChange(event.target.value)} step={tipo === "number" ? "any" : undefined} type={tipo} value={valor} />
    </label>
  );
}

function CamposOferta({ oferta, onChange, rotuloLink, rotuloPreco = "Preço" }: { oferta: OfertaForm; onChange: (oferta: OfertaForm) => void; rotuloLink: string; rotuloPreco?: string }) {
  const set = (patch: Partial<OfertaForm>) => onChange({ ...oferta, ...patch });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Nome" valor={oferta.nome} onChange={(nome) => set({ nome })} />
        <Campo rotulo={rotuloPreco} tipo="number" valor={oferta.preco} onChange={(preco) => set({ preco })} />
        <Campo dica="produtoRef" rotulo="Referência da venda" valor={oferta.produtoRef} onChange={(produtoRef) => set({ produtoRef })} />
      </div>
      <Campo rotulo="Texto curto" valor={oferta.texto} onChange={(texto) => set({ texto })} />
      <Campo rotulo={rotuloLink} tipo="url" valor={oferta.checkoutUrl} onChange={(checkoutUrl) => set({ checkoutUrl })} />
    </>
  );
}

/* ---------------- lista própria e depoimentos ---------------- */

function ListaCompradores({ compradores, base, emailConfigurado, onCopiado }: { compradores: Comprador[]; base: string; emailConfigurado: boolean; onCopiado: (texto: string) => void }) {
  return (
    <section className="panel overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ms-border)] p-5">
        <div>
          <h2 className="text-xl font-semibold">Lista própria de compradores</h2>
          <p className="mt-1 text-sm text-[var(--ms-muted)]">E-mails deixados na página de obrigado. {emailConfigurado ? "O pedido de depoimento sai sozinho por e-mail." : "O envio por e-mail não está configurado: copie o link do pedido de depoimento e mande à mão."}</p>
        </div>
        <a className="btn-secondary" href="/api/vendas/compradores?formato=csv"><Download size={15} /> Baixar CSV</a>
      </div>
      <div className="grid divide-y divide-[var(--ms-border)]">
        {compradores.length ? compradores.map((c) => {
          const link = c.depoimentoToken ? `${base}/depoimento/${c.depoimentoToken}` : null;
          const situacao = c.descadastradoEm ? "saiu da lista" : c.depoimentoPedidoEm ? `pedido de depoimento enviado em ${new Date(c.depoimentoPedidoEm).toLocaleDateString("pt-BR")}` : c.depoimentoPedirEm ? `pedido de depoimento em ${new Date(c.depoimentoPedirEm).toLocaleDateString("pt-BR")}` : c.depoimentoErro ? `pedido com erro: ${c.depoimentoErro}` : "sem pedido de depoimento";
          return (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm" key={c.id}>
              <div>
                <p className="font-semibold">{c.email}{c.nome ? ` · ${c.nome}` : ""}</p>
                <p className="text-xs text-[var(--ms-muted)]">{c.produtoNome ?? "—"}{c.prevenda ? ` · pré-venda${c.avisadoEntregaEm ? " (avisado)" : ""}` : ""}{c.aceitaNovidades ? " · aceita novidades" : ""} · {situacao}</p>
              </div>
              {link && !c.descadastradoEm ? <button className="btn-secondary" onClick={async () => onCopiado((await copiar(link)) ? "Link do formulário de depoimento copiado." : link)} type="button"><Copy size={14} /> Link do depoimento</button> : null}
            </div>
          );
        }) : <p className="p-6 text-sm text-[var(--ms-muted)]">Ninguém deixou o e-mail ainda.</p>}
      </div>
    </section>
  );
}

function ListaDepoimentos({ depoimentos, onCopiado }: { depoimentos: DepoimentoTela[]; onCopiado: (texto: string) => void }) {
  const autorizados = depoimentos.filter((d) => d.autorizaUso);
  return (
    <section className="panel overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ms-border)] p-5">
        <div>
          <h2 className="text-xl font-semibold">Depoimentos</h2>
          <p className="mt-1 text-sm text-[var(--ms-muted)]">Só os com «autorizo usar» podem ir para o Banco de provas da página ({autorizados.length} de {depoimentos.length}).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={!autorizados.length} onClick={async () => onCopiado((await copiar(autorizados.map((d) => d.texto).join("\n\n"))) ? "Depoimentos autorizados copiados." : "Não consegui copiar.")} type="button"><Copy size={14} /> Copiar autorizados</button>
          <a className="btn-secondary" href="/api/vendas/depoimentos?formato=csv"><Download size={15} /> Exportar CSV</a>
        </div>
      </div>
      <div className="grid divide-y divide-[var(--ms-border)]">
        {depoimentos.length ? depoimentos.map((d) => (
          <article className="grid gap-2 p-4 text-sm" key={d.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{d.nomeExibicao || "Sem nome"} · {d.produtoNome ?? "—"} · {new Date(d.criadoEm).toLocaleDateString("pt-BR")}</p>
              <span className={d.autorizaUso ? "text-emerald-700" : "text-[var(--ms-muted)]"}>{d.autorizaUso ? `autorizou usar (${d.autorizadoEm ? new Date(d.autorizadoEm).toLocaleDateString("pt-BR") : ""})` : "não autorizou: só para você"}</span>
            </div>
            <p><strong>O que funcionou:</strong> {d.oQueFuncionou}</p>
            {d.depoimento ? <p><strong>Depoimento:</strong> {d.depoimento}</p> : null}
            <div className="flex flex-wrap gap-2">
              {d.autorizaUso ? <button className="btn-secondary" onClick={async () => onCopiado((await copiar(d.texto)) ? "Depoimento copiado." : d.texto)} type="button"><Copy size={14} /> Copiar</button> : null}
              {d.printUrl ? <a className="btn-secondary" href={d.printUrl} rel="noopener noreferrer" target="_blank">Ver print</a> : null}
            </div>
          </article>
        )) : <p className="p-6 text-sm text-[var(--ms-muted)]">Nenhuma resposta ainda.</p>}
      </div>
    </section>
  );
}
