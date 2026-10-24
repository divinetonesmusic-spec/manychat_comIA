import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getR2Config, r2DownloadUrl } from "@/lib/content/r2";
import { getEntregaPublica, getLeadPorCodigo, registrarEventoEntrega } from "@/lib/db/funil-molde";
import { lerMarca, googleFontsUrl, varsDaMarca } from "@/lib/funil/marca";
import { deValido, origemValida } from "@/lib/funil/quiz";
import { textosDe } from "@/lib/funil/textos";
import { cookieEntrega } from "@/lib/funil/web";
import "../../funil.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const e = await getEntregaPublica(slug).catch(() => null);
  return { title: e ? e.titulo : "Material", description: e?.pacote?.subtitulo || undefined, robots: { index: false } };
}

/**
 * A página de entrega do material grátis (/e/<slug>), no visual da marca do avatar: a capa, o que tem dentro, o e-mail com o
 * consentimento claro e, depois do e-mail, «Baixar o PDF» e/ou «Abrir a versão interativa» (links com prazo do R2) e o
 * convite para o próximo degrau. ?o=<código do post>&de=dm|bio|story = de onde a pessoa veio.
 */
export default async function EntregaPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const e = await getEntregaPublica(slug);
  if (!e) notFound();
  const P = e.pacote;
  const marca = lerMarca(P.marca);
  const T = textosDe(P.idioma);
  const origem = origemValida(um(sp.o)) ?? origemValida(um(sp.utm_content)); // o link que conta cliques (/l/) chega com o código do post em utm_content
  const de = deValido(um(sp.de));
  const codigoLead = (await cookies()).get(cookieEntrega(e.slug))?.value || "";
  const lead = codigoLead ? await getLeadPorCodigo(codigoLead) : null;
  const liberado = Boolean(lead);
  if (!liberado && !um(sp.erro)) await registrarEventoEntrega(e.id, "visita", origem, de).catch((err: unknown) => console.error("[entrega] visita não contada:", err));
  const capa = e.capa_key && getR2Config() ? r2DownloadUrl(e.capa_key, 3600) : null;
  const fontes = googleFontsUrl(marca);
  const erro = um(sp.erro);

  return (
    <main className="fu" lang={P.idioma} style={varsDaMarca(marca) as CSSProperties}>
      {fontes ? <link href={fontes} rel="stylesheet" /> : null}
      <div className="fu-col fu-tela">
        <div className="fu-topo">
          {marca.foto ? <img alt="" className="fu-foto" height={72} src={marca.foto} width={72} /> : null}
          {marca.nome ? <span className="fu-marca">{marca.nome}</span> : null}
        </div>
        <section className="fu-cartao">
          <div className="fu-capa">
            {capa ? <img alt={e.titulo} height={340} src={capa} width={260} /> : <div aria-hidden="true" className="fu-livro">{e.titulo}</div>}
          </div>
          <h1>{e.titulo}</h1>
          {P.subtitulo ? <p className="fu-suave">{P.subtitulo}</p> : null}
          {P.itens?.length ? (
            <>
              <h3>{T.dentro}</h3>
              <ul className="fu-lista">{P.itens.map((i) => <li key={i}>{i}</li>)}</ul>
            </>
          ) : null}
        </section>

        <section className="fu-cartao" id="receber">
          {liberado ? (
            <>
              <p className="fu-ok" role="status">{T.entregaPronto}</p>
              {um(sp.confirmar) === "1" ? <p className="fu-pequeno">{T.confirmeEmail}</p> : null}
              {e.pdf_key ? <a className="fu-btn" href={`/e/${e.slug}/baixar?tipo=pdf`}>{T.baixarPdf}</a> : null}
              {e.html_key ? <a className="fu-btn" href={`/e/${e.slug}/baixar?tipo=html`} rel="noopener" target="_blank">{T.abrirInterativo}</a> : null}
            </>
          ) : (
            <form action={`/e/${e.slug}/email`} className="fu-form" method="post">
              {erro === "email" ? <p className="fu-erro" role="alert">{T.emailRuim}</p> : null}
              {erro === "acesso" ? <p className="fu-erro" role="alert">{T.acessoVencido}</p> : null}
              {erro === "rede" ? <p className="fu-erro" role="alert">{T.erroRede}</p> : null}
              {erro === "limite" ? <p className="fu-erro" role="alert">{T.muitas}</p> : null}
              <label className="fu-campo">{T.email}<input autoComplete="email" inputMode="email" name="email" required type="email" /></label>
              <label className="fu-campo">{T.nome}<input autoComplete="given-name" maxLength={80} name="nome" /></label>
              <input aria-hidden="true" autoComplete="off" className="fu-escondido" name="site" tabIndex={-1} />
              <input name="o" type="hidden" value={origem ?? ""} />
              <input name="de" type="hidden" value={de ?? ""} />
              <label className="fu-ck"><input name="consentimento" type="checkbox" /><span>{T.consentimento}</span></label>
              <p className="fu-pequeno">{T.privacidade}</p>
              <button className="fu-btn" type="submit">{T.entregaCta}</button>
            </form>
          )}
        </section>

        {liberado && P.proximo ? (
          <section className="fu-cartao fu-oferta">
            <p className="fu-pequeno">{T.proximo}</p>
            <h2>{P.proximo.titulo}</h2>
            {P.proximo.texto ? <p>{P.proximo.texto}</p> : null}
            {P.proximo.link ? <a className="fu-btn" href={`/e/${e.slug}/proximo`}>{P.proximo.rotulo || T.quero}</a> : null}
          </section>
        ) : null}
        {P.aviso ? <p className="fu-rodape">{P.aviso}</p> : null}
      </div>
    </main>
  );
}
