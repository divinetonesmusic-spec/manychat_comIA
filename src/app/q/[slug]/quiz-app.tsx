"use client";

import { useEffect, useRef, useState } from "react";
import { pontuar, precoTexto, respostasEspelho, type QuizPacote } from "@/lib/funil/quiz";
import { textosDe } from "@/lib/funil/textos";

type Tela =
  | { k: "intro" }
  | { k: "pergunta"; i: number }
  | { k: "prova" }
  | { k: "analisando" }
  | { k: "email" }
  | { k: "resultado" };

const ANALISE_MS = 2600;

/**
 * O quiz na tela. Cada toque numa resposta avança sozinho (com um instante para a pessoa ver o que marcou); «Voltar»
 * sempre funciona. Os eventos vão para /q/<slug>/evento; se a rede falhar, o quiz segue (nada trava a pessoa), e o perfil
 * calculado aqui vale até o servidor responder.
 */
export function QuizApp({ slug, quiz, perfilDm, origem, de }: { slug: string; quiz: QuizPacote; perfilDm: string | null; origem: string | null; de: string | null }) {
  const T = textosDe(quiz.idioma);
  const total = quiz.perguntas.length;
  const [tela, setTela] = useState<Tela>({ k: "intro" });
  const [respostas, setRespostas] = useState<number[]>(() => quiz.perguntas.map(() => -1));
  const [sessao, setSessao] = useState<string | null>(null);
  const [perfilId, setPerfilId] = useState<string | null>(null);
  const [passoAnalise, setPassoAnalise] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [provaVista, setProvaVista] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const titulo = useRef<HTMLHeadingElement | null>(null);
  const sessaoP = useRef<Promise<string | null> | null>(null);

  // o foco vai para o título de cada tela nova (leitor de tela e teclado acompanham)
  useEffect(() => { titulo.current?.focus(); }, [tela]);

  async function evento(corpo: Record<string, unknown>) {
    const r = await fetch(`/q/${slug}/evento`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw Object.assign(new Error(typeof j.error === "string" ? j.error : T.erroRede), { codigo: j.codigo });
    return j;
  }
  function garantirSessao() {
    if (!sessaoP.current) {
      sessaoP.current = evento({ acao: "inicio", perfil: perfilDm, o: origem, de })
        .then((j) => { const s = typeof j.sessao === "string" ? j.sessao : null; setSessao(s); return s; })
        .catch((e: unknown) => { console.warn("[quiz] início não gravado:", e); return null; });
    }
    return sessaoP.current;
  }

  function comecar() {
    void garantirSessao();
    setTela({ k: "pergunta", i: 0 });
  }

  function responder(i: number, k: number) {
    const R = respostas.slice();
    R[i] = k;
    setRespostas(R);
    void garantirSessao().then((s) => {
      if (s) evento({ acao: "respostas", sessao: s, respostas: R }).catch((e: unknown) => console.warn("[quiz] resposta não gravada:", e));
    });
    window.setTimeout(() => avancar(i, R), 260);
  }

  function avancar(i: number, R: number[]) {
    if (i + 1 === quiz.provaDepois && !provaVista) { setProvaVista(true); setTela({ k: "prova" }); return; }
    if (i + 1 < total) { setTela({ k: "pergunta", i: i + 1 }); return; }
    analisar(R);
  }

  function analisar(R: number[]) {
    setTela({ k: "analisando" });
    setPassoAnalise(0);
    const local = pontuar(quiz, R, perfilDm);
    const doServidor = garantirSessao()
      .then((s) => (s ? evento({ acao: "fim", sessao: s, respostas: R }) : null))
      .then((j) => (j && typeof j.perfil === "string" ? j.perfil : local))
      .catch((e: unknown) => { console.warn("[quiz] fim não gravado:", e); return local; });
    const passos = T.analisandoPassos.length;
    for (let n = 1; n <= passos; n += 1) window.setTimeout(() => setPassoAnalise(n), (ANALISE_MS / (passos + 0.5)) * n);
    const espera = new Promise((ok) => window.setTimeout(ok, ANALISE_MS));
    void Promise.all([doServidor, espera]).then(([p]) => { setPerfilId(p); setTela({ k: "email" }); });
  }

  async function enviarEmail(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const email = String(f.get("email") || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setErro(T.emailRuim); return; }
    setEnviando(true);
    setErro("");
    try {
      const s = await garantirSessao();
      if (!s) throw new Error(T.erroRede);
      const j = await evento({ acao: "email", sessao: s, email, nome: String(f.get("nome") || ""), consentimento: f.get("consentimento") === "on", site: String(f.get("site") || "") });
      if (typeof j.perfil === "string" && j.perfil) setPerfilId(j.perfil);
      setConfirmar(j.confirmar === true);
      setTela({ k: "resultado" });
    } catch (e) {
      setErro(e instanceof Error ? e.message : T.erroRede);
    } finally {
      setEnviando(false);
    }
  }

  const topo = (
    <div className="fu-topo">
      {quiz.marca.foto ? <img alt="" className="fu-foto" height={72} src={quiz.marca.foto} width={72} /> : null}
      {quiz.marca.nome ? <span className="fu-marca">{quiz.marca.nome}</span> : null}
    </div>
  );
  const rodape = quiz.aviso ? <p className="fu-rodape">{quiz.aviso}</p> : null;

  if (tela.k === "intro") {
    return (
      <div className="fu-col fu-tela" key="intro">
        {topo}
        <section className="fu-cartao">
          <h1 ref={titulo} tabIndex={-1}>{quiz.titulo}</h1>
          {quiz.subtitulo ? <p className="fu-suave">{quiz.subtitulo}</p> : null}
          <button className="fu-btn" onClick={comecar} type="button">{T.comecar}</button>
          <p className="fu-pequeno">{T.nPerguntas(total)} · {T.leva(quiz.minutos)}</p>
        </section>
        {rodape}
      </div>
    );
  }

  if (tela.k === "pergunta") {
    const pg = quiz.perguntas[tela.i];
    const marcada = respostas[tela.i];
    const tipo = pg.tipo;
    return (
      <div className="fu-col fu-tela" key={`p${tela.i}`}>
        {topo}
        <div className="fu-prog">
          <div className="fu-prog-linha">
            <button className="fu-link" onClick={() => setTela(tela.i === 0 ? { k: "intro" } : { k: "pergunta", i: tela.i - 1 })} type="button">‹ {T.voltar}</button>
            <span aria-live="polite">{T.pergunta(tela.i + 1, total)}</span>
          </div>
          <div aria-hidden="true" className="fu-barra"><span style={{ width: `${Math.round((tela.i / total) * 100)}%` }} /></div>
        </div>
        <section className="fu-cartao">
          <h2 ref={titulo} tabIndex={-1}>{pg.texto}</h2>
          {pg.ajuda ? <p className="fu-suave">{pg.ajuda}</p> : null}
          <div aria-label={pg.texto} className={`fu-ops${tipo === "imagem" ? " fu-ops-img" : tipo === "escala" ? " fu-escala" : ""}`} role="group">
            {pg.opcoes.map((o, k) => (
              <button aria-pressed={marcada === k} className="fu-op" key={k} onClick={() => responder(tela.i, k)} type="button">
                {tipo === "imagem" && o.imagem ? <img alt="" height={240} loading="lazy" src={o.imagem} width={240} /> : null}
                <span aria-hidden="true" className="fu-bola" />
                <span>{o.texto}</span>
              </button>
            ))}
          </div>
          {tipo === "escala" ? <div aria-hidden="true" className="fu-escala-rot"><span>{T.escalaMenos}</span><span>{T.escalaMais}</span></div> : null}
        </section>
        {rodape}
      </div>
    );
  }

  if (tela.k === "prova") {
    const pv = quiz.provaSocial;
    return (
      <div className="fu-col fu-tela" key="prova">
        {topo}
        <section className="fu-cartao">
          {pv.tipo === "numero" ? (
            <>
              <p className="fu-numero">{pv.numero}</p>
              <h2 ref={titulo} tabIndex={-1}>{pv.texto}</h2>
            </>
          ) : (
            <>
              <h2 ref={titulo} tabIndex={-1}>{T.comoFunciona}</h2>
              <ol className="fu-passos">
                {pv.passos.map((p, i) => <li key={i}><span aria-hidden="true" className="fu-n">{i + 1}</span><span>{p}</span></li>)}
              </ol>
            </>
          )}
          <button className="fu-btn" onClick={() => setTela({ k: "pergunta", i: quiz.provaDepois })} type="button">{T.continuar}</button>
        </section>
      </div>
    );
  }

  if (tela.k === "analisando") {
    return (
      <div className="fu-col fu-tela" key="analise">
        {topo}
        <section aria-busy="true" className="fu-cartao">
          <div aria-hidden="true" className="fu-anel" />
          <h2 ref={titulo} tabIndex={-1}>{T.analisando}</h2>
          <ul className="fu-check">
            {T.analisandoPassos.map((p, i) => <li data-ok={passoAnalise > i ? "1" : "0"} key={p}>{p}</li>)}
          </ul>
          <div aria-hidden="true" className="fu-barra"><span style={{ width: `${Math.round((passoAnalise / T.analisandoPassos.length) * 100)}%` }} /></div>
        </section>
      </div>
    );
  }

  if (tela.k === "email") {
    return (
      <div className="fu-col fu-tela" key="email">
        {topo}
        <section className="fu-cartao">
          <div aria-hidden="true" className="fu-barra"><span style={{ width: "100%" }} /></div>
          <h2 ref={titulo} tabIndex={-1}>{T.emailTitulo}</h2>
          <p className="fu-suave">{T.emailTexto}</p>
          <form className="fu-form" noValidate onSubmit={enviarEmail}>
            {erro ? <p className="fu-erro" role="alert">{erro}</p> : null}
            <label className="fu-campo">{T.email}<input autoComplete="email" inputMode="email" name="email" required type="email" /></label>
            <label className="fu-campo">{T.nome}<input autoComplete="given-name" maxLength={80} name="nome" /></label>
            <input aria-hidden="true" autoComplete="off" className="fu-escondido" name="site" tabIndex={-1} />
            <label className="fu-ck"><input name="consentimento" type="checkbox" /><span>{T.consentimento}</span></label>
            <p className="fu-pequeno">{T.privacidade}</p>
            <button className="fu-btn" disabled={enviando} type="submit">{T.verResultado}</button>
          </form>
        </section>
        {rodape}
      </div>
    );
  }

  const perfil = quiz.perfis.find((p) => p.id === perfilId) ?? quiz.perfis[0];
  const espelho = respostasEspelho(quiz, respostas, perfil.id);
  const preco = precoTexto(perfil.oferta);
  return (
    <div className="fu-col fu-tela" key="resultado">
      {topo}
      <section className="fu-cartao">
        <span className="fu-selo">{T.seuPerfil}</span>
        {confirmar ? <p className="fu-pequeno" role="status">{T.confirmeEmail}</p> : null}
        <h1 ref={titulo} tabIndex={-1}>{perfil.nome}</h1>
        {espelho.length ? (
          <div className="fu-chips" aria-label={T.voceDisse}>
            {espelho.map((t) => <span key={t}>{t}</span>)}
          </div>
        ) : null}
        <h3>{T.porque}</h3>
        <p>{perfil.causa}</p>
        {perfil.projecao ? (<><h3>{T.projecao}</h3><p>{perfil.projecao}</p></>) : null}
      </section>
      {perfil.miniPlano.length ? (
        <section className="fu-cartao">
          <h3>{T.plano}</h3>
          <ol className="fu-lista">{perfil.miniPlano.map((p) => <li key={p}>{p}</li>)}</ol>
        </section>
      ) : null}
      {perfil.oferta.nome ? (
        <section className="fu-cartao fu-oferta">
          <p className="fu-pequeno">{T.indicado}</p>
          <h2>{perfil.oferta.nome}</h2>
          {preco ? <p className="fu-preco">{preco}</p> : null}
          {perfil.oferta.garantia ? <p><strong>{T.garantia}:</strong> {perfil.oferta.garantia}</p> : null}
          {perfil.oferta.checkout && sessao ? <a className="fu-btn" href={`/q/${slug}/ir?s=${encodeURIComponent(sessao)}`}>{perfil.oferta.rotulo || T.quero}</a> : null}
        </section>
      ) : null}
      <button className="fu-link" onClick={() => { setRespostas(quiz.perguntas.map(() => -1)); setProvaVista(false); sessaoP.current = null; setSessao(null); setTela({ k: "intro" }); }} type="button">{T.refazer}</button>
      {rodape}
    </div>
  );
}
