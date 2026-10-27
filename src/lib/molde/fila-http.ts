import { isMissing0016, MISSING_0016, PAGE_STATES, type FilaInput, type FilaState } from "@/lib/molde/fila";
import { answer, parsePreview, text, TIPO, UUID } from "@/lib/molde/jobs-http";

/** Pedaços comuns das rotas /api/molde/fila (validação e respostas em português). Contrato: docs/API_MOLDE_FILA.md. */

export const FILA_LOTE_MAX = 50;
export const REF = /^(pedido|heygen|voz|telegram|outro):[A-Za-z0-9_.~-]{1,180}$/;

/** Erro inesperado (ou a 0016 faltando): frase em português, sem detalhe interno. */
export function filaFailure(error: unknown, contexto: string) {
  if (isMissing0016(error)) return answer(MISSING_0016, 503, { codigo: "falta_0016" });
  console.error(`[molde-fila] ${contexto}:`, error instanceof Error ? error.message : error);
  return answer("Não consegui fazer isso agora. Tente de novo em instantes.", 500);
}

export function parseFilaStates(value: string | null): FilaState[] | null | "invalid" {
  if (!value) return null;
  const states = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!states.every((state) => (PAGE_STATES as string[]).includes(state))) return "invalid";
  return states as FilaState[];
}

/** Texto opcional: null = não veio; undefined = veio errado (grande demais ou não é texto). */
const opcional = (value: unknown, max: number): string | null | undefined => {
  if (value === undefined || value === null || value === "") return null;
  return text(value, max) ?? undefined;
};

/** Um item do espelho que a página manda. Devolve o item ou a frase do erro. */
export function parseFilaItem(raw: unknown, indice: number): FilaInput | { error: string } {
  const onde = `Item ${indice + 1}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `${onde}: mande um objeto.` };
  const o = raw as Record<string, unknown>;
  const ref = typeof o.ref === "string" ? o.ref.trim() : "";
  if (!REF.test(ref)) return { error: `${onde}: ref inválida (ex.: pedido:<id>, heygen:<id>, voz:<id>).` };
  const id = o.id === undefined || o.id === null || o.id === "" ? null : typeof o.id === "string" && UUID.test(o.id) ? o.id.toLowerCase() : undefined;
  if (id === undefined) return { error: `${onde}: id inválido.` };
  const tipo = typeof o.tipo === "string" ? o.tipo.trim() : "";
  if (!TIPO.test(tipo)) return { error: `${onde}: tipo inválido (letras minúsculas, números e _).` };
  const estado = typeof o.estado === "string" ? o.estado.trim() : "";
  if (!(PAGE_STATES as string[]).includes(estado)) return { error: `${onde}: estado inválido. Use: ${PAGE_STATES.join(", ")}.` };
  const campos = {
    pedidoId: opcional(o.pedidoId, 120),
    chave: opcional(o.chave, 80),
    projeto: opcional(o.projeto, 200),
    avatar: opcional(o.avatar, 120),
    titulo: opcional(o.titulo, 200),
    etapa: opcional(o.etapa, 200),
    nota: opcional(o.nota, 1000),
    grupo: opcional(o.grupo, 120),
  };
  for (const [nome, v] of Object.entries(campos)) {
    if (v === undefined) return { error: `${onde}: ${nome} grande demais ou inválido.` };
  }
  const custo = o.custoEstimadoUsd === undefined || o.custoEstimadoUsd === null ? 0 : Number(o.custoEstimadoUsd);
  if (!Number.isFinite(custo) || custo < 0 || custo > 1000) return { error: `${onde}: custoEstimadoUsd precisa ser um número de 0 a 1000.` };
  const passos = o.passos === undefined || o.passos === null ? null : Number(o.passos);
  if (passos !== null && !(Number.isInteger(passos) && passos >= 1 && passos <= 30)) return { error: `${onde}: passos precisa ser um número inteiro de 1 a 30.` };
  let previa: FilaInput["previa"];
  if (o.previa === null) previa = null;
  else if (o.previa !== undefined) {
    const p = parsePreview(o.previa);
    if ("error" in p) return { error: `${onde}: ${p.error}` };
    previa = p;
  }
  return {
    id,
    ref,
    tipo,
    estado: estado as FilaState,
    pedidoId: campos.pedidoId ?? null,
    chave: campos.chave ?? null,
    projeto: campos.projeto ?? "",
    avatar: campos.avatar ?? "",
    titulo: campos.titulo ?? "",
    etapa: campos.etapa ?? null,
    nota: campos.nota ?? null,
    custoEstimadoUsd: Math.round(custo * 10_000) / 10_000,
    previa,
    grupo: campos.grupo ?? null,
    passos,
  };
}

/** A lista dos avatares (projetos) que a página manda junto, para o Telegram oferecer. undefined = não veio. */
export function parseAvatares(raw: unknown): Array<{ projeto: string; nome: string; conta: string }> | { error: string } | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 20) return { error: "avatares precisa ser uma lista de até 20." };
  const out: Array<{ projeto: string; nome: string; conta: string }> = [];
  for (const a of raw) {
    const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    const projeto = text(o.projeto, 200);
    if (!projeto) return { error: "Cada avatar precisa do projeto." };
    const nome = o.nome === undefined || o.nome === null || o.nome === "" ? "" : text(o.nome, 120);
    const conta = o.conta === undefined || o.conta === null || o.conta === "" ? "" : text(String(o.conta).replace(/^@/, ""), 60);
    if (nome === null || conta === null) return { error: "Nome ou conta do avatar inválido." };
    out.push({ projeto, nome, conta });
  }
  return out;
}

/** Os preços que a página manda (US$ por foto e para produzir um Reel), para o custo dos pedidos do Telegram. */
export function parsePrecos(raw: unknown): { foto?: number; reel?: number } | { error: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "precos precisa ser um objeto." };
  const o = raw as Record<string, unknown>;
  const out: { foto?: number; reel?: number } = {};
  for (const k of ["foto", "reel"] as const) {
    if (o[k] === undefined || o[k] === null) continue;
    const v = Number(o[k]);
    if (!Number.isFinite(v) || v < 0 || v > 1000) return { error: `precos.${k} precisa ser um número de 0 a 1000.` };
    out[k] = Math.round(v * 10_000) / 10_000;
  }
  return out;
}
