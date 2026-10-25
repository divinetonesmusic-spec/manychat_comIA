import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { diasDeUso, getAppPublico, getSessao } from "@/lib/db/apps";
import { googleFontsUrl, varsDaMarca } from "@/lib/funil/marca";
import { origemValida } from "@/lib/funil/quiz";
import { diaLocal, diasSeguidos, noiteDe, temAcesso } from "@/lib/app/rotina";
import { textosApp } from "@/lib/app/textos";
import { cookieApp } from "@/lib/app/web";
import { AppTela } from "./app-tela";
import "../../funil.css";
import "../app.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getAppPublico(slug).catch(() => null);
  if (!a) return { title: "App", robots: { index: false } };
  return {
    title: a.app.titulo,
    description: a.app.promessa || undefined,
    applicationName: a.app.nomeCurto,
    manifest: `/a/${a.slug}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: a.app.nomeCurto, statusBarStyle: "default" },
    icons: { icon: `/a/${a.slug}/icone/192`, apple: `/a/${a.slug}/icone/180` },
    robots: { index: false },
  };
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { slug } = await params;
  const a = await getAppPublico(slug).catch(() => null);
  return { themeColor: a?.app.marca.fundo ?? "#FBF8F3", width: "device-width", initialScale: 1, viewportFit: "cover" };
}

/**
 * O app por assinatura (/a/<slug>, 0018). Com a sessão deste aparelho e a assinatura ativa: a tela de 1 toque (a noite de hoje,
 * «Tocar», os dias seguidos, o lembrete e o «Adicionar à tela de início»). Sem: o convite para assinar (o preço por mês, o que tem
 * e o link de pagamento com a origem do post) e «Já assinei» (o link e o código por e-mail, sem senha).
 */
export default async function AppPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const a = await getAppPublico(slug);
  if (!a) notFound();
  const P = a.app;
  const T = textosApp(P.idioma);
  const quem = await getSessao(a.id, (await cookies()).get(cookieApp(a.slug))?.value || "");
  const fontes = googleFontsUrl(P.marca);
  const estilo = varsDaMarca(P.marca) as CSSProperties;

  if (quem && temAcesso(quem.acessoAte)) {
    const dias = await diasDeUso(quem.id);
    const hoje = diaLocal(new Date(), quem.fuso);
    const tocouHoje = dias.includes(hoje);
    const { noite, ciclo, total } = noiteDe(dias.length, tocouHoje);
    const dia = P.dias[noite - 1];
    const audio = P.audios.find((x) => x.id === dia.audio);
    return (
      <main className="fu" lang={P.idioma} style={estilo}>
        {fontes ? <link href={fontes} rel="stylesheet" /> : null}
        <AppTela
          audios={P.audios.filter((x) => a.audios[x.id]).map((x) => ({ id: x.id, titulo: x.titulo }))}
          aviso={P.aviso}
          ciclo={ciclo}
          dia={{ titulo: dia.titulo, fazer: dia.fazer, minutos: dia.minutos, audio: dia.audio, audioTitulo: audio?.titulo ?? "" }}
          idioma={P.idioma}
          lembrete={{ ativo: quem.lembrete, hora: quem.lembreteHora }}
          marcaNome={P.marca.nome}
          noite={noite}
          seguidos={diasSeguidos(dias, hoje)}
          slug={a.slug}
          titulo={P.titulo}
          tocouHoje={tocouHoje}
          total={total}
          versao={a.versao}
        />
      </main>
    );
  }

  const erro = um(sp.erro);
  const enviado = um(sp.enviado);
  const origem = origemValida(um(sp.o)) ?? origemValida(um(sp.utm_content));
  const preco = P.preco.moeda === "USD" ? `US$ ${P.preco.valor.toFixed(2)}` : `R$ ${P.preco.valor.toFixed(2).replace(".", ",")}`;
  const erros: Record<string, string> = { email: T.emailRuim, limite: T.muitas, rede: T.erroRede, codigo: T.codigoErrado, vencido: T.linkVencido, semEmail: T.semEmailConfigurado };
  return (
    <main className="fu" lang={P.idioma} style={estilo}>
      {fontes ? <link href={fontes} rel="stylesheet" /> : null}
      <div className="fu-col fu-tela">
        <div className="fu-topo">{P.marca.foto ? <img alt="" className="fu-foto" height={72} src={P.marca.foto} width={72} /> : null}{P.marca.nome ? <span className="fu-marca">{P.marca.nome}</span> : null}</div>
        {quem ? (
          <section className="fu-cartao" role="status">
            <h2>{T.semAcesso}</h2>
            <p>{T.semAcessoTexto}</p>
          </section>
        ) : null}
        <section className="fu-cartao fu-oferta">
          <h1>{P.titulo}</h1>
          {P.promessa ? <p className="fu-suave">{P.promessa}</p> : null}
          <p>{T.oQueTem(P.dias.length)}</p>
          <ol className="fu-lista">{T.comoFunciona.map((x) => <li key={x}>{x}</li>)}</ol>
          {P.convite ? <p>{P.convite}</p> : null}
          <p className="ap-preco"><b>{preco}</b><span className="fu-suave">{T.porMes}</span></p>
          {P.checkout ? <a className="fu-btn" href={`/a/${a.slug}/assinar${origem ? `?o=${origem}` : ""}`}>{T.assinar}</a> : null}
        </section>
        <section className="fu-cartao" id="entrar">
          <h2>{T.jaAssinei}</h2>
          {erros[erro] ? <p className="fu-erro" role="alert">{erros[erro]}</p> : null}
          {enviado ? (
            <>
              <p className="fu-ok" role="status">{T.enviado(enviado)}</p>
              <form action={`/a/${a.slug}/codigo`} className="fu-form" method="post">
                <input name="email" type="hidden" value={enviado} />
                <label className="fu-campo ap-codigo">{T.codigo}<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} name="codigo" pattern="[0-9]{6}" required /></label>
                <button className="fu-btn" type="submit">{T.entrar}</button>
              </form>
              <a className="fu-link" href={`/a/${a.slug}#entrar`}>{T.entrarComOutro}</a>
            </>
          ) : (
            <form action={`/a/${a.slug}/entrar`} className="fu-form" method="post">
              <p>{T.entrarTexto}</p>
              <label className="fu-campo">{T.email}<input autoComplete="email" inputMode="email" name="email" required type="email" /></label>
              <input aria-hidden="true" autoComplete="off" className="fu-escondido" name="site" tabIndex={-1} />
              <button className="ap-btn2" type="submit">{T.mandarLink}</button>
            </form>
          )}
          {P.aviso ? <p className="ap-pequeno">{P.aviso}</p> : null}
        </section>
      </div>
    </main>
  );
}
