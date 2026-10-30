"use client";

import { useEffect, useRef, useState } from "react";
import { History, Loader2, Send, X } from "lucide-react";

/** O que a rota /api/automations/[id]/responder-antigos devolve (src/lib/responder-antigos.ts → vista). */
type Vista = {
  estado: "lendo" | "pronto" | "enviando" | "concluido" | "erro";
  mediaId: string;
  permalink: string | null;
  numeros: { lidos: number; combinam: number; jaRespondidos: number; repetidos: number; velhos: number; semTempo: number; paraEnviar: number };
  enfileirados: number;
  puladosNoEnvio: number;
  enviadas: number;
  naFila: number;
  naoSairam: number;
  tempoEstimado: string;
  terminaPorVolta: string | null;
  mensagem: string;
  erro: string | null;
};

type Props = { automationId: string; accountId: string | null; postIds: string[] };

const pausa = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * «Responder quem já comentou neste post»: primeiro conta (nada sai), mostra os números e só manda depois do
 * «Mandar para N pessoas». O envio sai no ritmo de 200 por hora; dá para fechar a tela (o relógio continua sozinho).
 */
export function ResponderAntigos({ automationId, accountId, postIds }: Props) {
  const [aberto, setAberto] = useState(false);
  const [post, setPost] = useState(postIds.length === 1 ? postIds[0] : "");
  const [vista, setVista] = useState<Vista | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  // Com a tela aberta durante o envio, o andamento atualiza sozinho a cada 20 s.
  useEffect(() => {
    if (!aberto || vista?.estado !== "enviando" || ocupado) return;
    const timer = setInterval(() => void contar(false, true), 20_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, vista?.estado, ocupado]);

  async function chamar(method: "GET" | "POST", extra: { novo?: boolean; paraEnviar?: number } = {}) {
    const url = new URL(`/api/automations/${automationId}/responder-antigos`, window.location.origin);
    if (method === "GET") {
      url.searchParams.set("post", post.trim());
      if (accountId) url.searchParams.set("accountId", accountId);
      if (extra.novo) url.searchParams.set("novo", "1");
    }
    const resposta = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify({ post: post.trim(), paraEnviar: extra.paraEnviar, accountId }) : undefined,
    });
    const json = (await resposta.json().catch(() => ({}))) as { data?: Vista; error?: string };
    if (json.data) setVista(json.data);
    if (!resposta.ok) throw new Error(json.error || "Não consegui falar com o UaiFlow. Tente de novo.");
    return json.data as Vista;
  }

  async function contar(novo: boolean, silencioso = false) {
    if (!post.trim()) {
      setErro("Cole o link do Reel ou do post.");
      return;
    }
    if (!silencioso) setOcupado(true);
    setErro(null);
    try {
      let atual = await chamar("GET", { novo });
      // Cada chamada lê uns segundos de comentários; continua até a contagem fechar.
      while (vivo.current && atual.estado === "lendo") {
        await pausa(800);
        atual = await chamar("GET");
      }
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Erro ao contar.");
    } finally {
      if (!silencioso) setOcupado(false);
    }
  }

  async function mandar() {
    if (!vista) return;
    setOcupado(true);
    setErro(null);
    try {
      let atual = await chamar("POST", { paraEnviar: vista.numeros.paraEnviar });
      // Põe todo mundo na fila (em partes de alguns segundos). Se fechar a tela, o relógio continua.
      while (vivo.current && atual.estado === "enviando" && atual.enfileirados + atual.puladosNoEnvio < atual.numeros.paraEnviar) {
        const antes = atual.enfileirados;
        await pausa(800);
        atual = await chamar("POST", { paraEnviar: atual.numeros.paraEnviar });
        if (atual.enfileirados === antes && atual.erro) break;
      }
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Erro ao mandar.");
    } finally {
      setOcupado(false);
    }
  }

  const n = vista?.numeros;
  const podeMandar = vista?.estado === "pronto" && (n?.paraEnviar ?? 0) > 0;
  const enviando = vista?.estado === "enviando" || vista?.estado === "concluido";

  return (
    <>
      <button className="btn-secondary h-10 px-3" onClick={() => setAberto(true)} title="Mandar a automação para quem comentou antes de ela existir" type="button">
        <History size={16} /> Responder quem já comentou neste post
      </button>

      {aberto ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Responder quem já comentou neste post">
          <div className="grid max-h-[90vh] w-full max-w-lg gap-4 overflow-y-auto rounded-xl border border-[var(--ms-border)] bg-[var(--ms-surface)] p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Responder quem já comentou neste post</h2>
                <p className="mt-1 text-sm text-[var(--ms-muted)]">
                  Para quem comentou a palavra-chave antes de esta automação existir. Primeiro eu conto; nada sai antes de você confirmar.
                </p>
              </div>
              <button className="btn-secondary h-9 w-9 shrink-0 p-0" onClick={() => setAberto(false)} title="Fechar" type="button" aria-label="Fechar">
                <X size={16} />
              </button>
            </div>

            <label className="field gap-1">
              <span>Link do Reel ou do post (ou o id da mídia)</span>
              <input className="input h-10" placeholder="https://www.instagram.com/reel/..." value={post} onChange={(event) => setPost(event.target.value)} disabled={ocupado} />
            </label>

            {!vista || vista.estado === "erro" ? (
              <button className="btn-primary h-10" disabled={ocupado} onClick={() => void contar(Boolean(vista))} type="button">
                {ocupado ? <Loader2 className="animate-spin" size={16} /> : <History size={16} />}
                {ocupado ? "Contando..." : "Contar os comentários"}
              </button>
            ) : null}

            {vista ? (
              <div className="grid gap-3">
                <p className="text-sm font-semibold" aria-live="polite">{vista.mensagem}</p>
                {n && vista.estado !== "lendo" ? (
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3 text-sm">
                    <dt>Comentários lidos</dt><dd className="text-right font-semibold">{n.lidos}</dd>
                    <dt>Com a palavra-chave</dt><dd className="text-right font-semibold">{n.combinam}</dd>
                    <dt>Já respondidos (ficam de fora)</dt><dd className="text-right">{n.jaRespondidos}</dd>
                    <dt>Mesma pessoa de novo (fica de fora)</dt><dd className="text-right">{n.repetidos}</dd>
                    <dt>Mais de 7 dias (a Meta não deixa)</dt><dd className="text-right">{n.velhos}</dd>
                    {n.semTempo ? (<><dt>Não dá tempo antes dos 7 dias</dt><dd className="text-right">{n.semTempo}</dd></>) : null}
                    <dt className="font-semibold">Para mandar agora</dt><dd className="text-right font-semibold">{n.paraEnviar}</dd>
                    <dt>Tempo (200 por hora)</dt><dd className="text-right">{vista.tempoEstimado}</dd>
                  </dl>
                ) : null}

                {enviando ? (
                  <p className="text-sm">
                    {vista.enviadas} de {n?.paraEnviar ?? 0} enviadas; o resto sai no ritmo de 200 por hora.
                    {vista.terminaPorVolta ? ` Termina por volta de ${new Date(vista.terminaPorVolta).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.` : ""}
                    {" "}Pode fechar esta tela: o envio continua sozinho.
                  </p>
                ) : null}

                {vista.erro ? <p className="text-sm text-red-500">{vista.erro}</p> : null}

                <div className="flex flex-wrap gap-2">
                  {podeMandar ? (
                    <button className="btn-primary h-10 px-3" disabled={ocupado} onClick={() => void mandar()} type="button">
                      {ocupado ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                      {ocupado ? "Pondo na fila..." : `Mandar para ${n?.paraEnviar} pessoas`}
                    </button>
                  ) : null}
                  {vista.estado === "pronto" || vista.estado === "concluido" ? (
                    <button className="btn-secondary h-10 px-3" disabled={ocupado} onClick={() => void contar(true)} type="button" title="Conta de novo e pega só quem ainda não recebeu">
                      Contar de novo
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {erro ? <p className="text-sm text-red-500" role="alert">{erro}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
