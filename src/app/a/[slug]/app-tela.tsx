"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { caixas } from "@/lib/app/pwa";
import { textosApp } from "@/lib/app/textos";
import type { AppIdioma } from "@/lib/app/pacote";

type Props = {
  slug: string;
  versao: number;
  idioma: AppIdioma;
  titulo: string;
  marcaNome: string;
  noite: number;
  ciclo: number;
  total: number;
  seguidos: number;
  tocouHoje: boolean;
  dia: { titulo: string; fazer: string; minutos: number; audio: string; audioTitulo: string };
  audios: Array<{ id: string; titulo: string }>;
  lembrete: { ativo: boolean; hora: number };
  aviso: string;
};

type PedidoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type UsoGuardado = { noite: number; em: string };

function fusoDoAparelho() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null; // navegador sem o Intl completo: o servidor usa o fuso guardado
  }
}
/** O aparelho (iPhone? o app já está na tela de início?), lido do navegador; no servidor, nenhum dos dois. */
function lerAparelho() {
  const ua = navigator.userAgent || "";
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return `${/iphone|ipad|ipod/i.test(ua) ? "iphone" : "outro"}|${standalone ? "instalado" : "navegador"}`;
}
const semAssinar = () => () => undefined;
/** Baixa um áudio: pede o link com prazo ao UaiFlow (só com a assinatura ativa) e baixa direto do R2. 403 = sem acesso. */
async function baixarAudio(chave: string): Promise<Blob | 403> {
  const r = await fetch(`${chave}?link=1`, { cache: "no-store" });
  if (r.status === 403) return 403;
  if (!r.ok) throw new Error(`link do áudio: ${r.status}`);
  const { url, tipo } = (await r.json()) as { url: string; tipo: string };
  const a = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!a.ok) throw new Error(`áudio: ${a.status}`);
  const blob = await a.blob();
  return blob.type ? blob : new Blob([blob], { type: tipo || "audio/mpeg" });
}
function mmss(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/**
 * A tela de 1 toque do app (cliente): «Tocar» toca o áudio da noite de hoje (o guardado no aparelho; sem ele, baixa e guarda),
 * conta o dia (sem internet, guarda e manda depois), guarda todos os áudios para tocar sem internet, registra o service worker,
 * mostra o «Adicionar à tela de início» do aparelho e o lembrete diário por e-mail.
 */
export function AppTela(p: Props) {
  const T = textosApp(p.idioma);
  const C = caixas(p.slug, p.versao);
  const base = `/a/${p.slug}`;
  const chaveUso = `${C.prefixo}uso`;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contou = useRef(p.tocouHoje);
  const [tocando, setTocando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [tempo, setTempo] = useState({ agora: 0, total: p.dia.minutos * 60 });
  const [feito, setFeito] = useState(p.tocouHoje);
  const [seguidos, setSeguidos] = useState(p.seguidos);
  const [guardado, setGuardado] = useState<"guardando" | "ok" | "sem" | "">("");
  const [msg, setMsg] = useState("");
  const [instalar, setInstalar] = useState<PedidoInstalar | null>(null);
  const aparelhoTxt = useSyncExternalStore(semAssinar, lerAparelho, () => "outro|navegador");
  const aparelho = { iphone: aparelhoTxt.startsWith("iphone"), instalado: aparelhoTxt.endsWith("|instalado") };
  const [lembrete, setLembrete] = useState(p.lembrete);
  const [lembreteMsg, setLembreteMsg] = useState("");

  // manda os toques guardados sem internet (o servidor conta o dia de cada um)
  const mandarUsos = useCallback(async () => {
    let fila: UsoGuardado[] = [];
    try {
      fila = JSON.parse(localStorage.getItem(chaveUso) || "[]") as UsoGuardado[];
    } catch {
      fila = []; // localStorage bloqueado ou estragado: nada guardado para mandar
    }
    const sobrou: UsoGuardado[] = [];
    for (const u of fila) {
      try {
        const r = await fetch(`${base}/uso`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ noite: u.noite, em: u.em, fuso: fusoDoAparelho() }) });
        if (!r.ok && r.status !== 403) sobrou.push(u);
      } catch {
        sobrou.push(u); // ainda sem internet: tenta na próxima
      }
    }
    try {
      localStorage.setItem(chaveUso, JSON.stringify(sobrou.slice(-10)));
    } catch (erro) {
      console.warn("[app] não consegui guardar a fila dos toques:", erro);
    }
  }, [base, chaveUso]);

  const contarDia = useCallback(async () => {
    if (contou.current) return;
    contou.current = true;
    setFeito(true);
    setSeguidos((n) => n + 1);
    const u: UsoGuardado = { noite: p.noite, em: new Date().toISOString() };
    try {
      const r = await fetch(`${base}/uso`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ noite: u.noite, em: u.em, fuso: fusoDoAparelho() }) });
      if (r.ok || r.status === 403) return;
    } catch {
      // sem internet: guarda o toque e manda quando voltar (logo abaixo)
    }
    try {
      const fila = JSON.parse(localStorage.getItem(chaveUso) || "[]") as UsoGuardado[];
      localStorage.setItem(chaveUso, JSON.stringify([...fila, u].slice(-10)));
    } catch (erro) {
      console.warn("[app] não consegui guardar o toque para mandar depois:", erro);
    }
  }, [base, chaveUso, p.noite]);

  // guarda os áudios (o de hoje primeiro), a tela e o código dela para abrir e tocar sem internet
  const guardarTudo = useCallback(async () => {
    if (typeof caches === "undefined") {
      setGuardado("sem");
      return;
    }
    setGuardado("guardando");
    try {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n.startsWith(`${C.prefixo}audio-`) && n !== C.audio).map((n) => caches.delete(n)));
      const caixa = await caches.open(C.audio);
      const ordem = [p.dia.audio, ...p.audios.map((a) => a.id).filter((id) => id !== p.dia.audio)];
      for (const id of ordem) {
        const chave = `${base}/audio/${id}`;
        if (await caixa.match(chave)) continue;
        const blob = await baixarAudio(chave);
        if (blob === 403) throw new Error(`áudio ${id}: sem acesso`);
        await caixa.put(chave, new Response(blob, { headers: { "content-type": blob.type || "audio/mpeg" } }));
      }
      const tela = await caches.open(C.tela);
      const arquivos = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin) && new URL(u).pathname.startsWith("/_next/static/"));
      await tela.addAll(Array.from(new Set([base, ...arquivos])));
      setGuardado("ok");
    } catch (erro) {
      console.warn("[app] não consegui guardar tudo para usar sem internet:", erro);
      setGuardado("sem");
    }
  }, [C.audio, C.prefixo, C.tela, base, p.audios, p.dia.audio]);

  useEffect(() => {
    const pedir = (e: Event) => {
      e.preventDefault();
      setInstalar(e as PedidoInstalar);
    };
    window.addEventListener("beforeinstallprompt", pedir);
    const online = () => void mandarUsos();
    window.addEventListener("online", online);
    void mandarUsos();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(`${base}/sw.js`, { scope: base, updateViaCache: "none" })
        .then(() => navigator.serviceWorker.ready)
        .then(() => guardarTudo())
        .catch((erro: unknown) => {
          console.warn("[app] o service worker não registrou:", erro);
          void guardarTudo();
        });
    } else queueMicrotask(() => void guardarTudo()); // sem service worker (navegador antigo): guarda os áudios do mesmo jeito
    return () => {
      window.removeEventListener("beforeinstallprompt", pedir);
      window.removeEventListener("online", online);
    };
  }, [base, guardarTudo, mandarUsos]);

  async function tocar() {
    const el = audioRef.current;
    if (!el) return;
    if (tocando) {
      el.pause();
      return;
    }
    setMsg("");
    if (!el.src) {
      setCarregando(true);
      const chave = `${base}/audio/${p.dia.audio}`;
      let blob: Blob | null = null;
      try {
        const r = typeof caches !== "undefined" ? await (await caches.open(C.audio)).match(chave) : undefined;
        if (r) blob = await r.blob();
      } catch (erro) {
        console.warn("[app] não consegui ler o áudio guardado:", erro);
      }
      if (!blob) {
        try {
          const b = await baixarAudio(chave);
          if (b === 403) {
            location.reload();
            return;
          }
          blob = b;
        } catch {
          setMsg(T.semInternet); // sem internet e sem o áudio guardado: a frase diz o que fazer
          setCarregando(false);
          return;
        }
      }
      el.src = URL.createObjectURL(blob);
      setCarregando(false);
    }
    try {
      await el.play();
    } catch (erro) {
      console.warn("[app] o aparelho não tocou:", erro);
      setMsg(T.semInternet);
    }
  }

  async function salvarLembrete(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const novo = { ativo: f.get("ativo") === "on", hora: Number(f.get("hora")) };
    setLembreteMsg("");
    try {
      const r = await fetch(`${base}/lembrete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...novo, fuso: fusoDoAparelho() }) });
      if (!r.ok) throw new Error(String(r.status));
      setLembrete(novo);
      setLembreteMsg(T.lembreteSalvo);
    } catch {
      setLembreteMsg(T.lembreteErro); // a frase junto do botão diz para tentar de novo
    }
  }

  return (
    <div className="fu-col fu-tela">
      <div className="ap-topo">
        {p.marcaNome ? <span className="fu-marca">{p.marcaNome}</span> : <span />}
      </div>
      <section aria-labelledby="ap-noite" className="fu-cartao">
        <div className="ap-noite">
          <span className="fu-pequeno">{p.titulo}</span>
          <h1 className="ap-n" id="ap-noite">{T.noite(p.noite, p.total)}</h1>
          <span className="ap-titulo">{p.dia.titulo}</span>
        </div>
        <div className="ap-selos">
          <span>{T.seguidos(seguidos)}</span>
          <span>{T.minutos(p.dia.minutos)}</span>
          {p.ciclo > 1 ? <span>{T.ciclo(p.ciclo)}</span> : null}
        </div>
        <button aria-label={`${tocando ? T.pausar : T.tocar}: ${p.dia.audioTitulo || p.dia.titulo}`} className="ap-tocar" data-tocar="" disabled={carregando} onClick={() => void tocar()} type="button">
          {tocando ? (
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <p aria-live="polite" className="ap-tempo">{mmss(tempo.agora)} / {mmss(tempo.total)}</p>
        <audio
          onEnded={() => setTocando(false)}
          onLoadedMetadata={(e) => {
            const total = e.currentTarget.duration;
            setTempo((t) => ({ agora: 0, total: Number.isFinite(total) && total > 0 ? total : t.total }));
          }}
          onPause={() => setTocando(false)}
          onPlaying={() => {
            setTocando(true);
            void contarDia();
          }}
          onTimeUpdate={(e) => {
            const agora = e.currentTarget.currentTime; // lido já: dentro do setState o evento não tem mais o elemento
            setTempo((t) => ({ ...t, agora }));
          }}
          preload="none"
          ref={audioRef}
        />
        <p className="ap-fazer">{p.dia.fazer}</p>
        {msg ? <p className="fu-erro" role="alert">{msg}</p> : null}
        {feito ? <p className="fu-ok" role="status">{T.feitoHoje}</p> : null}
        <p aria-live="polite" className="ap-status" data-guardado={guardado}>
          {guardado === "guardando" ? T.guardando : guardado === "ok" ? T.guardado : guardado === "sem" ? T.semGuardar : ""}
        </p>
      </section>

      {!aparelho.instalado ? (
        <section className="fu-cartao">
          <h2>{T.instalarTitulo}</h2>
          {instalar ? (
            <button
              className="ap-btn2"
              onClick={() => {
                void instalar.prompt();
                setInstalar(null);
              }}
              type="button"
            >
              {T.instalarBotao}
            </button>
          ) : null}
          <p>{aparelho.iphone ? T.instalarIphone : T.instalarAndroid}</p>
          {aparelho.iphone ? <p className="ap-pequeno">{T.instalarIphoneLembrete}</p> : null}
        </section>
      ) : null}

      <section className="fu-cartao">
        <h2>{T.lembreteTitulo}</h2>
        <p>{T.lembreteTexto}</p>
        <form className="ap-linha" onSubmit={(e) => void salvarLembrete(e)}>
          <label className="fu-ck"><input defaultChecked={lembrete.ativo} name="ativo" type="checkbox" /><span>{T.lembreteQuero}</span></label>
          <label className="ap-campo">
            {T.lembreteHora}
            <select defaultValue={String(lembrete.hora)} name="hora">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}
            </select>
          </label>
          <button className="ap-btn2" type="submit">{T.lembreteSalvar}</button>
          {lembreteMsg ? <p className="ap-status" role="status">{lembreteMsg}</p> : null}
        </form>
      </section>

      <section className="fu-cartao">
        <form action={`${base}/sair`} method="post">
          <button className="fu-link" type="submit">{T.sair}</button>
        </form>
        {p.aviso ? <p className="ap-pequeno">{p.aviso}</p> : null}
      </section>
    </div>
  );
}
