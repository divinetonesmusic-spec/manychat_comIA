import { NextResponse, type NextRequest } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { filaDecisionLine } from "@/lib/telegram/fila";
import { DECISOES, isMissing0016, MISSING_0016, PAGE_STATES, type Decisao, type FilaDecideOutcome, type FilaAchado, type FilaRow, type FilaState } from "@/lib/molde/fila";
import { parsePreview, text, TIPO } from "@/lib/molde/jobs-http";
import {
  doOrquestrador,
  isOrqState,
  MISSING_0019,
  MOTIVOS,
  orqView,
  PRAZO_MAX_SEG,
  PRAZO_MIN_SEG,
  PRAZO_PADRAO_SEG,
  temA0019,
  type MotivoAprovacao,
  type OrqCodigo,
  type OrqCriar,
} from "@/lib/molde/orquestrador";
import { safeEqualSecret } from "@/lib/secrets";

/**
 * Pedaços das rotas do orquestrador em /api/molde/fila (0019): o token, os estados nos dois vocabulários, as respostas de
 * erro no formato do ORQUESTRADOR.md ({erro: {codigo, mensagem}}, e também {error} como as outras rotas) e a validação.
 * Contrato: docs/API_MOLDE_ORQUESTRADOR.md.
 */

export type QuemChama = "molde" | "orquestrador";

/**
 * O token: o do Molde (MOLDE_API_TOKEN, o mesmo da página e do robô do Mac) ou o do orquestrador (MOLDE_ORQUESTRADOR_TOKEN,
 * opcional, só para a fila). Vale no cabeçalho x-molde-token ou em «Authorization: Bearer …».
 * Quem entra com o do orquestrador recebe as respostas no formato do orquestrador sem precisar pedir.
 */
export function checkFilaToken(request: NextRequest): { quem: QuemChama } | NextResponse {
  const orq = process.env.MOLDE_ORQUESTRADOR_TOKEN?.trim();
  if (orq && orq.length >= 24) {
    const provided = request.headers.get("x-molde-token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (safeEqualSecret(provided.trim(), orq)) return { quem: "orquestrador" };
  }
  const denied = checkMoldeToken(request);
  if (!denied) return { quem: "molde" };
  // a mesma resposta de sempre ({error, codigo}) e também o formato do orquestrador ({erro: {codigo, mensagem}})
  const fechado = denied.status === 503;
  const codigo = fechado ? "fechado" : "token_invalido";
  const mensagem = fechado ? "A porta do Molde está fechada: defina MOLDE_API_TOKEN (24+ caracteres) nas variáveis do servidor." : "Token do Molde inválido.";
  return NextResponse.json({ erro: { codigo, mensagem }, error: mensagem, codigo }, { status: denied.status });
}

/** Erro no formato do orquestrador (e no das outras rotas: `error`). */
export function falha(status: number, codigo: string, mensagem: string, item?: FilaRow | null) {
  return NextResponse.json({ erro: { codigo, mensagem }, error: mensagem, ...(item ? { item: orqView(item) } : {}) }, { status });
}

const FRASE: Record<OrqCodigo, [number, string]> = {
  nao_achou: [404, "Item da fila não encontrado."],
  versao: [409, "O item mudou depois que você leu (outra versão). Leia de novo e decida."],
  pego: [409, "Outro orquestrador está com este item (a posse ainda não venceu)."],
  estado: [409, "Este item não está no estado certo para isso."],
  pagina: [409, "Este item é um espelho da página: o orquestrador não mexe nele."],
};

export function falhaOrq(codigo: OrqCodigo, item?: FilaRow) {
  const [status, frase] = FRASE[codigo];
  return falha(status, codigo, frase, item);
}

/** Erro inesperado: a frase certa quando falta a 0016 ou a 0019; o resto, «tente de novo», sem detalhe interno. */
export async function falhaInesperada(error: unknown, contexto: string) {
  if (isMissing0016(error)) {
    const tem0019 = await temA0019().catch(() => false);
    const tabela = await import("@/lib/db/client").then(({ query }) => query<{ ok: boolean }>("select to_regclass('public.molde_fila') is not null as ok")).then((r) => Boolean(r.rows[0]?.ok)).catch(() => false);
    if (!tabela) return falha(503, "falta_0016", MISSING_0016);
    if (!tem0019) return falha(503, "falta_0019", MISSING_0019);
  }
  if ((error as { code?: string } | null)?.code === "23514") {
    // a regra dos estados ainda é a da 0016 (sem «na_revisao»)
    const tem0019 = await temA0019().catch(() => false);
    if (!tem0019) return falha(503, "falta_0019", MISSING_0019);
  }
  console.error(`[molde-orquestrador] ${contexto}:`, error instanceof Error ? error.message : error);
  return falha(500, "passageiro", "Não consegui fazer isso agora. Tente de novo em instantes.");
}

/**
 * Os estados de um filtro (?estado=), nos dois vocabulários: o da página (na_fila, produzindo…) e o do orquestrador
 * (novo, na-estacao…). `orquestrador` = veio algum do vocabulário do orquestrador. «produzindo» inclui «na_revisao».
 */
export function parseEstados(value: string | null): { estados: FilaState[] | null; orquestrador: boolean } | "invalid" {
  if (!value) return { estados: null, orquestrador: false };
  const partes = value.split(",").map((item) => item.trim()).filter(Boolean);
  const estados = new Set<FilaState>();
  let orquestrador = false;
  for (const p of partes) {
    if (isOrqState(p)) {
      orquestrador = true;
      estados.add(doOrquestrador(p));
    } else if ((PAGE_STATES as string[]).includes(p)) {
      estados.add(p as FilaState);
      if (p === "produzindo") estados.add("na_revisao");
    } else return "invalid";
  }
  return { estados: [...estados], orquestrador };
}

// ---------- validação dos corpos ----------

const ESTACAO = /^molde-[a-z][a-z0-9-]{1,38}$/;
const CHAVE = /^[A-Za-z0-9_-]{4,80}$/;
const QUEM = /^[A-Za-z0-9 _.@:-]{1,80}$/;
const MAX_DETALHES = 64 * 1024;
const MAX_ENTRADA = 512 * 1024;
const MAX_SAIDA = 128 * 1024;

/** Um corpo errado: a frase do erro (uma classe, para nunca confundir com um objeto que o orquestrador mandou). */
export class Invalido {
  constructor(public readonly error: string) {}
}
type Erro = Invalido;
const invalido = (error: string) => new Invalido(error);
const objeto = (value: unknown) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const tamanho = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? null));

/** Objeto JSON até `max` bytes. undefined = não veio; Erro = veio errado. */
function objetoAte(value: unknown, max: number, nome: string): Record<string, unknown> | undefined | Erro {
  if (value === undefined || value === null) return undefined;
  if (!objeto(value)) return invalido(`${nome} precisa ser um objeto.`);
  if (tamanho(value) > max) return invalido(`${nome} é grande demais (até ${Math.round(max / 1024)} KB).`);
  return value as Record<string, unknown>;
}

const isErro = (v: unknown): v is Erro => v instanceof Invalido;

/** A versão que quem escreve leu (obrigatória em toda escrita). */
export function parseVersao(body: Record<string, unknown>): number | Erro {
  const v = Number(body.versao);
  return Number.isInteger(v) && v >= 1 ? v : invalido("Mande a versao que você leu do item (um número).");
}

const textoOpcional = (value: unknown, max: number): string | null | undefined => {
  if (value === undefined || value === null || value === "") return null;
  return text(value, max) ?? undefined;
};

/** POST /api/molde/fila (criar, o formato do orquestrador). */
export function parseCriar(body: Record<string, unknown>): OrqCriar | Erro {
  const projeto = text(body.projeto, 200);
  if (!projeto) return invalido("Mande o projeto.");
  const estacao = typeof body.estacao === "string" ? body.estacao.trim() : "";
  if (!ESTACAO.test(estacao)) return invalido("estacao inválida (ex.: molde-roteirista, molde-fotografo).");
  const tipo = typeof body.tipo === "string" ? body.tipo.trim() : "";
  if (!TIPO.test(tipo)) return invalido("tipo inválido (letras minúsculas, números e _).");
  const origem = body.origem === undefined || body.origem === null || body.origem === "página" ? "pagina" : body.origem;
  if (origem !== "pagina" && origem !== "telegram" && origem !== "piloto") return invalido("origem inválida (página, telegram ou piloto).");
  const chave = body.chave === undefined || body.chave === null || body.chave === "" ? null : typeof body.chave === "string" && CHAVE.test(body.chave) ? body.chave : undefined;
  if (chave === undefined) return invalido("chave inválida (4 a 80 letras, números, _ ou -).");
  const detalhes = objetoAte(body.detalhes, MAX_DETALHES, "detalhes");
  if (isErro(detalhes)) return detalhes;
  const entrada = objetoAte(body.entrada, MAX_ENTRADA, "entrada");
  if (isErro(entrada)) return entrada;
  const titulo = textoOpcional(body.titulo, 200);
  const avatar = textoOpcional(body.avatar, 120);
  const conta = textoOpcional(body.conta, 120);
  if (titulo === undefined || avatar === undefined || conta === undefined) return invalido("titulo, avatar ou conta grande demais ou inválido.");
  const custo = body.custoEstimadoUsd === undefined || body.custoEstimadoUsd === null ? 0 : Number(body.custoEstimadoUsd);
  if (!Number.isFinite(custo) || custo < 0 || custo > 1000) return invalido("custoEstimadoUsd precisa ser um número de 0 a 1000.");
  return { projeto, estacao, tipo, origem, chave, detalhes: detalhes ?? {}, entrada: entrada ?? null, titulo, avatar, conta, custoEstimadoUsd: Math.round(custo * 10_000) / 10_000 };
}

export function parseQuem(body: Record<string, unknown>, obrigatorio: boolean): string | null | Erro {
  if (body.quem === undefined || body.quem === null || body.quem === "") return obrigatorio ? "orquestrador" : null;
  return typeof body.quem === "string" && QUEM.test(body.quem.trim()) ? body.quem.trim() : invalido("quem inválido (até 80 letras).");
}

export function parsePrazo(body: Record<string, unknown>): number | Erro {
  if (body.prazoSeg === undefined || body.prazoSeg === null) return PRAZO_PADRAO_SEG;
  const v = Number(body.prazoSeg);
  return Number.isInteger(v) && v >= PRAZO_MIN_SEG && v <= PRAZO_MAX_SEG ? v : invalido(`prazoSeg precisa ser de ${PRAZO_MIN_SEG} a ${PRAZO_MAX_SEG} segundos.`);
}

export function parseSaida(value: unknown, nome = "saida"): Record<string, unknown> | Erro {
  const o = objetoAte(value, MAX_SAIDA, nome);
  if (o === undefined) return invalido(`Mande a ${nome} (um objeto).`);
  return o;
}

export function parseEstacao(value: unknown): string | Erro {
  const estacao = typeof value === "string" ? value.trim() : "";
  return ESTACAO.test(estacao) ? estacao : invalido("estacao inválida (ex.: molde-roteirista, molde-revisor).");
}

export function parseDecisao(value: unknown): Decisao | Erro {
  return typeof value === "string" && (DECISOES as readonly string[]).includes(value)
    ? (value as Decisao)
    : invalido(`Decisão inválida. Use: ${DECISOES.join(", ")}.`);
}

/** POST …/aprovacao */
export function parseAprovacao(body: Record<string, unknown>) {
  const motivo = body.motivo;
  if (typeof motivo !== "string" || !(MOTIVOS as readonly string[]).includes(motivo)) return invalido(`motivo inválido. Use: ${MOTIVOS.join(", ")}.`);
  const pergunta = textoOpcional(body.pergunta, 500);
  const resumo = textoOpcional(body.resumo, 2000);
  if (pergunta === undefined || resumo === undefined) return invalido("pergunta (até 500 letras) ou resumo (até 2000) inválido.");
  let opcoes: Decisao[] | null = null;
  if (body.opcoes !== undefined && body.opcoes !== null) {
    if (!Array.isArray(body.opcoes) || body.opcoes.length > 8) return invalido("opcoes precisa ser uma lista.");
    // aceita também os rótulos («Publicar mesmo assim», «Corrigir»…)
    const lidas = body.opcoes.map((o) => normalizarOpcao(o));
    if (lidas.some((o) => !o)) return invalido(`opção inválida. Use: ${DECISOES.join(", ")}.`);
    opcoes = [...new Set(lidas as Decisao[])];
  }
  const achadosBrutos = body.achados ?? (Array.isArray((body.revisor as Record<string, unknown> | undefined)?.achados) ? (body.revisor as Record<string, unknown>).achados : undefined);
  const achados: FilaAchado[] = [];
  if (achadosBrutos !== undefined && achadosBrutos !== null) {
    if (!Array.isArray(achadosBrutos) || achadosBrutos.length > 30) return invalido("achados precisa ser uma lista de até 30.");
    for (const a of achadosBrutos) {
      if (!objeto(a)) return invalido("Cada achado precisa ser um objeto {lugar, trecho, porque, troca}.");
      const o = a as Record<string, unknown>;
      const achado: FilaAchado = {};
      for (const k of ["lugar", "trecho", "porque", "troca", "nivel"] as const) {
        const v = textoOpcional(o[k] ?? (k === "porque" ? o["porQue"] ?? o["motivo"] : undefined), 500);
        if (v === undefined) return invalido(`achado.${k} grande demais (até 500 letras).`);
        if (v) achado[k] = v;
      }
      achados.push(achado);
    }
  }
  const custo = body.custo === undefined || body.custo === null ? null : Number(body.custo);
  if (custo !== null && (!Number.isFinite(custo) || custo < 0 || custo > 1000)) return invalido("custo precisa ser um número (US$) de 0 a 1000.");
  let previa = null;
  if (body.previa !== undefined && body.previa !== null) {
    const p = parsePreview(body.previa);
    if ("error" in p) return invalido(p.error as string);
    previa = p;
  }
  return { motivo: motivo as MotivoAprovacao, pergunta, resumo, opcoes, achados, custo: custo === null ? null : Math.round(custo * 10_000) / 10_000, previa };
}

const ROTULOS: Record<string, Decisao> = {
  "publicar mesmo assim": "publicar",
  "aprovar o gasto": "aprovar",
  "completar agora": "completar",
  "não gravar": "nao-gravar",
};
/** «Publicar mesmo assim» → publicar; «Corrigir» → corrigir; «nao_gravar» → nao-gravar. */
export function normalizarOpcao(value: unknown): Decisao | null {
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase().replace(/_/g, "-");
  if ((DECISOES as readonly string[]).includes(t)) return t as Decisao;
  return ROTULOS[t.replace(/-/g, " ")] ?? null;
}

export { isErro };

/** A resposta de uma decisão que não valeu (a rota «decisao»): o erro com o código e o item. null = valeu. */
export function respostaDaDecisao(outcome: FilaDecideOutcome) {
  if (outcome.ok) return null;
  if (outcome.motivo === "not-found") return falha(404, "nao_achou", "Item da fila não encontrado.");
  const frases: Record<Exclude<typeof outcome.motivo, "not-found">, [number, string, string]> = {
    already: [409, "ja_decidido", outcome.item.decisao ? `Já foi decidido: ${filaDecisionLine(outcome.item.decisao)}` : "Já foi decidido."],
    "old-round": [409, "rodada", "Esta prévia é antiga: veja a mais nova."],
    "not-waiting": [409, "estado", "Este item não está esperando o dono."],
    "sem-motivo": [400, "sem_motivo", "Para refazer, diga o que mudar (nota)."],
    opcao: [400, "opcao", "Esta decisão não está entre as opções deste item."],
    versao: [409, "versao", "O item mudou depois que você leu (outra versão). Leia de novo e decida."],
  };
  const [status, codigo, frase] = frases[outcome.motivo];
  return falha(status, codigo, frase, outcome.item);
}
