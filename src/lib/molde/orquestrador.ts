import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, transaction } from "@/lib/db/client";
import {
  ESTADO_ORQ,
  estadoEfetivo,
  opcoesDoItem,
  pageState,
  type Decisao,
  type FilaAchado,
  type FilaAprovacao,
  type FilaPreview,
  type FilaRow,
  type FilaState,
} from "@/lib/molde/fila";

/**
 * O orquestrador do Molde na fila única (migração 0019; Molde v135, 2-NUCLEO parte 4).
 *
 * A mesma tabela da 0016 (public.molde_fila). Um item do orquestrador tem `estacao` (a skill do plugin molde-do-avatar que
 * faz); os espelhos da página não têm, e o orquestrador nunca pega um espelho. O ciclo:
 *   criar (chave idempotente) → pegar (posse com prazo que vence sozinho) → passo (o diário de cada skill)
 *   → aprovacao (para no dono, com os achados do revisor) → [decisão do dono: Telegram, página ou MCP]
 *   → pegar de novo → resultado (pronto) | erro (tenta de novo até 2 vezes) | soltar (devolve sem erro).
 * Toda escrita manda a `versao` que leu: outra escrita no meio → 409 «versao» (ninguém apaga o trabalho do outro).
 * Contrato completo: docs/API_MOLDE_ORQUESTRADOR.md.
 */

export const MISSING_0019 = "Falta colar a atualização 0019 no Supabase (veja docs/ATUALIZACAO_0019.md).";

/** Os estados no vocabulário do orquestrador (plugin-molde/ORQUESTRADOR.md). */
export const ORQ_STATES = ["novo", "na-estacao", "na-revisao", "esperando-dono", "aprovado", "refazer", "pronto", "erro", "cancelado"] as const;
export type OrqState = (typeof ORQ_STATES)[number];
const DO_ORQ: Record<OrqState, FilaState> = {
  novo: "na_fila",
  "na-estacao": "produzindo",
  "na-revisao": "na_revisao",
  "esperando-dono": "para_aprovar",
  aprovado: "aprovado",
  refazer: "refazer",
  pronto: "pronto",
  erro: "erro",
  cancelado: "cancelado",
};
export const doOrquestrador = (estado: OrqState) => DO_ORQ[estado];
export const isOrqState = (value: string): value is OrqState => (ORQ_STATES as readonly string[]).includes(value);

export const MOTIVOS = ["revisor", "publico", "gasto", "faltam-dados", "pecas"] as const;
export type MotivoAprovacao = (typeof MOTIVOS)[number];
/** As opções de cada ponto de aprovação quando o orquestrador não manda as dele. «cancelar» vale sempre. */
export const OPCOES_PADRAO: Record<MotivoAprovacao, Decisao[]> = {
  revisor: ["corrigir", "refazer", "publicar", "cancelar"],
  publico: ["aprovar", "refazer", "cancelar"],
  gasto: ["aprovar", "cancelar"],
  "faltam-dados": ["completar", "cancelar"],
  pecas: ["gravar", "nao-gravar"],
};

/** A ordem em que as opções aparecem (nos botões do Telegram e na página). */
const ORDEM: Decisao[] = ["corrigir", "aprovar", "refazer", "gravar", "nao-gravar", "completar", "publicar", "cancelar"];

/** Quanto tempo a posse vale (o orquestrador manda prazoSeg; padrão 15 min). */
export const PRAZO_PADRAO_SEG = 900;
export const PRAZO_MIN_SEG = 60;
export const PRAZO_MAX_SEG = 3600;
/** Uma chave igual reaproveita o item vivo das últimas 2 h (nunca dois itens iguais, nunca pagar duas vezes). */
export const CHAVE_HORAS = 2;
/** «erro» com tentarDeNovo devolve o item a «novo» até 2 vezes; na 3ª fica «erro». */
export const TENTATIVAS_MAX = 2;
export const PASSOS_MAX = 40;

const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);

/** O item como o orquestrador vê (docs/API_MOLDE_ORQUESTRADOR.md). */
export function orqView(row: FilaRow) {
  const efetivo = estadoEfetivo(row);
  const pegoVivo = Boolean(row.pego_ate && new Date(row.pego_ate).getTime() >= Date.now());
  return {
    id: row.id,
    chave: row.chave,
    versao: row.versao ?? 1,
    projeto: row.projeto,
    conta: row.conta ?? null,
    avatar: row.avatar,
    estacao: row.estacao ?? null,
    tipo: row.tipo,
    titulo: row.titulo,
    estado: ESTADO_ORQ[efetivo],
    /** O mesmo estado no vocabulário da página (docs/API_MOLDE_FILA.md). */
    estadoPagina: pageState(efetivo),
    origem: row.origem,
    ref: row.ref,
    pedidoId: row.pedido_id,
    detalhes: row.detalhes ?? {},
    entrada: row.entrada ?? null,
    passos: row.passos ?? [],
    aprovacao: row.aprovacao ?? null,
    resultado: row.resultado ?? null,
    previa: row.previa,
    custoEstimadoUsd: Number(row.custo_estimado_usd),
    rodada: row.rodada,
    decisao: row.decisao,
    tentativas: row.tentativas ?? 0,
    pegoPor: pegoVivo ? row.pego_por ?? null : null,
    pegoAte: pegoVivo ? iso(row.pego_ate) : null,
    /** true = alguém pegou e o prazo venceu sem terminar (o item voltou sozinho ao estado de antes). */
    prazoVencido: Boolean(row.pego_ate) && !pegoVivo && efetivo !== row.estado,
    erro: row.erro ?? null,
    etapa: row.etapa,
    nota: row.nota,
    criadoEm: iso(row.criado_em),
    atualizadoEm: iso(row.atualizado_em),
  };
}
export type OrqView = ReturnType<typeof orqView>;

/** O estado efetivo em SQL (o prazo vencido devolve o item ao estado de quando foi pego). Precisa da 0019. */
const EFETIVO_SQL = `(case when estado in ('produzindo', 'na_revisao') and pego_ate is not null and pego_ate < now() then coalesce(pego_de, 'na_fila') else estado end)`;

export type OrqFiltro = { estados?: FilaState[] | null; projeto?: string | null; avatar?: string | null; estacao?: string | null; todos?: boolean; limite?: number; maisNovos?: boolean };

/**
 * Os itens da fila para o orquestrador: os mais velhos primeiro (pelo estado efetivo). Só os do orquestrador (com estação),
 * a não ser com `todos` (aí também os espelhos da página e os pedidos do Telegram; nunca os rascunhos).
 * `avatar` acha pelo projeto ou pelo nome do avatar (sem diferença de maiúsculas).
 */
export async function listarOrq(filtro: OrqFiltro) {
  const { rows } = await query<FilaRow>(
    `select * from public.molde_fila
     where estado <> 'rascunho'
       and ($1 or estacao is not null)
       and ($2::text[] is null or ${EFETIVO_SQL} = any($2))
       and ($3::text is null or projeto = $3)
       and ($4::text is null or estacao = $4)
       and ($5::text is null or lower(projeto) = lower($5) or lower(avatar) = lower($5))
     order by ${filtro.maisNovos ? "criado_em desc, id desc" : "criado_em asc, id"}
     limit $6`,
    [filtro.todos === true, filtro.estados?.length ? filtro.estados : null, filtro.projeto ?? null, filtro.estacao ?? null, filtro.avatar ?? null, filtro.limite ?? 50],
  );
  return rows;
}

// ---------- criar ----------

export type OrqCriar = {
  projeto: string;
  estacao: string;
  tipo: string;
  titulo?: string | null;
  avatar?: string | null;
  conta?: string | null;
  origem?: "pagina" | "telegram" | "piloto";
  detalhes?: Record<string, unknown>;
  entrada?: Record<string, unknown> | null;
  chave?: string | null;
  custoEstimadoUsd?: number;
};

/** JSON com as chaves em ordem (a mesma chave para os mesmos detalhes, em qualquer ordem). */
function estavel(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(estavel).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${estavel((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A chave quando quem cria não manda a dele: k + 16 letras do projeto, da estação, do tipo e dos detalhes. */
export function chaveDoItem(input: Pick<OrqCriar, "projeto" | "estacao" | "tipo" | "detalhes">) {
  return `k${createHash("sha256").update(estavel([input.projeto, input.estacao, input.tipo, input.detalhes ?? {}])).digest("hex").slice(0, 16)}`;
}

/**
 * Cria um item do orquestrador. Com uma chave que já existe num item vivo (não pronto, não cancelado) das últimas 2 h,
 * devolve o que existe (`reaproveitado: true`): nunca dois itens iguais. A trava por chave impede dois ao mesmo tempo.
 */
export async function criarItem(input: OrqCriar): Promise<{ item: FilaRow; reaproveitado: boolean }> {
  const chave = input.chave || chaveDoItem(input);
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('molde_fila:' || $1))", [chave]);
    const existe = (await client.query<FilaRow>(
      `select * from public.molde_fila
       where chave = $1 and estacao is not null and estado not in ('pronto', 'cancelado', 'rascunho') and criado_em > now() - make_interval(hours => $2)
       order by criado_em desc limit 1`,
      [chave, CHAVE_HORAS],
    )).rows[0];
    if (existe) return { item: existe, reaproveitado: true };
    const avatar = input.avatar ?? (await client.query<{ nome: string }>("select nome from public.molde_avatares where projeto = $1", [input.projeto])).rows[0]?.nome ?? "";
    const { rows } = await client.query<FilaRow>(
      `insert into public.molde_fila (ref, origem, chave, projeto, avatar, conta, estacao, tipo, titulo, estado, custo_estimado_usd, detalhes, entrada, etapa)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'na_fila', $10, $11::jsonb, $12::jsonb, 'Esperando o orquestrador')
       returning *`,
      [`orq:${randomUUID()}`, input.origem ?? "pagina", chave, input.projeto, avatar, input.conta ?? null, input.estacao, input.tipo,
        (input.titulo ?? "").slice(0, 200), input.custoEstimadoUsd ?? 0, JSON.stringify(input.detalhes ?? {}), input.entrada ? JSON.stringify(input.entrada) : null],
    );
    return { item: rows[0], reaproveitado: false };
  });
}

// ---------- escritas com versão ----------

export type OrqCodigo = "nao_achou" | "versao" | "pego" | "estado" | "pagina";
/** `final` (só no erro): true = ficou «erro» (não volta sozinho). */
export type OrqOutcome = { ok: true; item: FilaRow; final?: boolean } | { ok: false; codigo: OrqCodigo; item?: FilaRow };

const NA_ESTACAO: FilaState[] = ["produzindo", "na_revisao"];
const posseViva = (item: FilaRow) => Boolean(item.pego_ate && new Date(item.pego_ate).getTime() >= Date.now());

/** Abre o item com a trava da linha e confere: existe, é do orquestrador e a versão é a que quem escreve leu. */
async function comItem(id: string, versao: number, work: (item: FilaRow, client: PoolClient) => Promise<OrqOutcome>): Promise<OrqOutcome> {
  return transaction(async (client) => {
    const item = (await client.query<FilaRow>("select * from public.molde_fila where id = $1 for update", [id])).rows[0];
    if (!item || item.estado === "rascunho") return { ok: false, codigo: "nao_achou" };
    if (!("versao" in item)) throw Object.assign(new Error("a 0019 ainda não foi colada"), { code: "42703" }); // a rota diz «Falta colar a 0019»
    if (!item.estacao) return { ok: false, codigo: "pagina", item };
    if (item.versao !== versao) return { ok: false, codigo: "versao", item };
    return work(item, client);
  });
}

/**
 * Pegar: o item fica «na-estacao» com a posse de `quem` até `agora + prazoSeg`. Vale para «novo», «aprovado» e «refazer»
 * (e para um item «na-estacao» cujo prazo venceu). Já pego por outro e no prazo → «pego». O mesmo `quem` de novo renova.
 * Ao pegar um item decidido, a decisão conta como aplicada (é o orquestrador quem aplica nos itens dele).
 */
export async function pegarItem(id: string, input: { versao: number; quem: string; prazoSeg: number }): Promise<OrqOutcome> {
  return comItem(id, input.versao, async (item, client) => {
    const viva = posseViva(item);
    if (NA_ESTACAO.includes(item.estado) && viva && item.pego_por !== input.quem) return { ok: false, codigo: "pego", item };
    const efetivo = estadoEfetivo(item);
    const renovar = NA_ESTACAO.includes(item.estado) && (viva ? item.pego_por === input.quem : true);
    if (!renovar && !["na_fila", "aprovado", "refazer"].includes(efetivo)) return { ok: false, codigo: "estado", item };
    const { rows } = await client.query<FilaRow>(
      `update public.molde_fila
       set estado = case when estado in ('produzindo', 'na_revisao') then estado else 'produzindo' end,
           pego_de = case when estado in ('produzindo', 'na_revisao') then pego_de else estado end,
           pego_por = $2, pego_ate = now() + make_interval(secs => $3), pego_prazo_seg = $3,
           decisao_aplicada_em = case when decisao is not null and decisao_aplicada_em is null then now() else decisao_aplicada_em end,
           etapa = 'Com o orquestrador', atualizado_em = now()
       where id = $1 returning *`,
      [item.id, input.quem, input.prazoSeg],
    );
    return { ok: true, item: rows[0] };
  });
}

/** Só quem está com o item (na-estacao / na-revisao) escreve passo, aprovação, resultado e soltar. */
function naEstacao(item: FilaRow, quem: string | null | undefined): OrqOutcome | null {
  if (!NA_ESTACAO.includes(item.estado)) return { ok: false, codigo: "estado", item };
  if (quem && posseViva(item) && item.pego_por && item.pego_por !== quem) return { ok: false, codigo: "pego", item };
  return null;
}

/** Passo: grava a saída de uma skill no diário (os 40 mais novos) e renova o prazo. O revisor deixa o item «na-revisao». */
export async function passoItem(id: string, input: { versao: number; estacao: string; saida: Record<string, unknown>; quem?: string | null }): Promise<OrqOutcome> {
  return comItem(id, input.versao, async (item, client) => {
    const barrado = naEstacao(item, input.quem);
    if (barrado) return barrado;
    const passos = [...(item.passos ?? []), { estacao: input.estacao, em: new Date().toISOString(), saida: input.saida }].slice(-PASSOS_MAX);
    const { rows } = await client.query<FilaRow>(
      `update public.molde_fila
       set passos = $2::jsonb, estado = $3, etapa = $4,
           pego_ate = now() + make_interval(secs => coalesce(pego_prazo_seg, $5)), atualizado_em = now()
       where id = $1 returning *`,
      [item.id, JSON.stringify(passos), input.estacao === "molde-revisor" ? "na_revisao" : "produzindo", `Passo: ${input.estacao}`, PRAZO_PADRAO_SEG],
    );
    return { ok: true, item: rows[0] };
  });
}

export type OrqAprovacaoInput = {
  versao: number;
  motivo: MotivoAprovacao;
  pergunta?: string | null;
  opcoes?: Decisao[] | null;
  achados?: FilaAchado[];
  custo?: number | null;
  resumo?: string | null;
  previa?: FilaPreview | null;
  quem?: string | null;
};

/**
 * Aprovação: o item para em «esperando-dono» (para a página, «para_aprovar») numa rodada nova, com o motivo, a pergunta,
 * as opções e os achados do revisor. A posse acaba (o orquestrador segue para o próximo item). Quem chama manda a
 * mensagem do Telegram depois (sendFilaApproval). Revisor: «Corrigir», «Refazer» e «Publicar mesmo assim» estão sempre
 * (decisão 21); «Cancelar» está sempre em todos.
 */
export async function pedirAprovacao(id: string, input: OrqAprovacaoInput): Promise<OrqOutcome> {
  return comItem(id, input.versao, async (item, client) => {
    const barrado = naEstacao(item, input.quem);
    if (barrado) return barrado;
    const base = input.opcoes?.length ? input.opcoes : OPCOES_PADRAO[input.motivo];
    const aprovacao: FilaAprovacao = {
      necessaria: true,
      motivo: input.motivo,
      pergunta: input.pergunta ?? "",
      opcoes: [],
      achados: input.achados ?? [],
      custo: input.custo ?? null,
      resumo: input.resumo ?? "",
      canais: ["telegram", "pagina"],
      pedidaEm: new Date().toISOString(),
      decisao: null,
      decididaEm: null,
      nota: "",
    };
    aprovacao.opcoes = opcoesDoItem({ aprovacao: { ...aprovacao, opcoes: base } }).sort((a, b) => ORDEM.indexOf(a) - ORDEM.indexOf(b));
    const { rows } = await client.query<FilaRow>(
      `update public.molde_fila
       set estado = 'para_aprovar', rodada = rodada + 1, aprovacao = $2::jsonb, previa = coalesce($3::jsonb, previa),
           pego_por = null, pego_ate = null, pego_de = null, etapa = 'Esperando o dono',
           telegram_msg_id = null, telegram_aviso_em = null, espera_motivo_em = null, atualizado_em = now()
       where id = $1 returning *`,
      [item.id, JSON.stringify(aprovacao), input.previa ? JSON.stringify(input.previa) : null],
    );
    return { ok: true, item: rows[0] };
  });
}

/** Resultado: o item fica «pronto» com a saída e as peças para gravar (quem grava é a página, depois do «Gravar»). */
export async function gravarResultado(id: string, input: { versao: number; saida: Record<string, unknown>; pecasParaGravar?: Record<string, unknown> | null; quem?: string | null }): Promise<OrqOutcome> {
  return comItem(id, input.versao, async (item, client) => {
    const barrado = naEstacao(item, input.quem);
    if (barrado) return barrado;
    const { rows } = await client.query<FilaRow>(
      `update public.molde_fila
       set estado = 'pronto', resultado = $2::jsonb, erro = null, pego_por = null, pego_ate = null, pego_de = null,
           etapa = 'Pronto', atualizado_em = now()
       where id = $1 returning *`,
      [item.id, JSON.stringify({ saida: input.saida, pecasParaGravar: input.pecasParaGravar ?? {} })],
    );
    return { ok: true, item: rows[0] };
  });
}

/**
 * Erro: com `tentarDeNovo`, volta a «novo» (tentativas + 1) até 2 vezes; depois (ou sem tentarDeNovo) fica «erro» com o
 * motivo, e o dono vê (o Telegram avisa). Vale para qualquer item vivo do orquestrador (pego ou não).
 */
export async function marcarErro(id: string, input: { versao: number; motivo: string; tentarDeNovo: boolean; quem?: string | null }): Promise<OrqOutcome> {
  return comItem(id, input.versao, async (item, client) => {
    if (["pronto", "erro", "cancelado"].includes(item.estado)) return { ok: false, codigo: "estado", item };
    if (input.quem && NA_ESTACAO.includes(item.estado) && posseViva(item) && item.pego_por && item.pego_por !== input.quem) return { ok: false, codigo: "pego", item };
    const deNovo = input.tentarDeNovo && (item.tentativas ?? 0) < TENTATIVAS_MAX;
    const { rows } = await client.query<FilaRow>(
      `update public.molde_fila
       set estado = $2, erro = $3, tentativas = tentativas + 1, pego_por = null, pego_ate = null, pego_de = null,
           etapa = $4, atualizado_em = now()
       where id = $1 returning *`,
      [item.id, deNovo ? "na_fila" : "erro", input.motivo, deNovo ? "Vai tentar de novo" : "Com erro"],
    );
    return { ok: true, item: rows[0], final: !deNovo };
  });
}

/**
 * Soltar (além do ORQUESTRADOR.md): devolve o item ao estado de quando foi pego, sem contar tentativa, com uma nota
 * (ex.: «Esperando o Mac ligar»). O próximo ciclo pega de novo.
 */
export async function soltarItem(id: string, input: { versao: number; nota?: string | null; quem?: string | null }): Promise<OrqOutcome> {
  return comItem(id, input.versao, async (item, client) => {
    const barrado = naEstacao(item, input.quem);
    if (barrado) return barrado;
    const { rows } = await client.query<FilaRow>(
      `update public.molde_fila
       set estado = coalesce(pego_de, 'na_fila'), pego_por = null, pego_ate = null, pego_de = null,
           etapa = coalesce($2, 'Esperando o orquestrador'), atualizado_em = now()
       where id = $1 returning *`,
      [item.id, input.nota ?? null],
    );
    return { ok: true, item: rows[0] };
  });
}

/** Um item qualquer (com os campos da 0019). */
export async function getItem(id: string) {
  const { rows } = await query<FilaRow>("select * from public.molde_fila where id = $1 and estado <> 'rascunho'", [id]);
  return rows[0] ?? null;
}

/** A 0019 já foi colada? (para a frase certa quando falta uma coluna: 0016 ou 0019) */
export async function temA0019() {
  const { rows } = await query<{ ok: boolean }>(
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'molde_fila' and column_name = 'versao') as ok",
  );
  return Boolean(rows[0]?.ok);
}
