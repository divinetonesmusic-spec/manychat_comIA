import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, transaction } from "@/lib/db/client";

/**
 * Fila de trabalho do Molde (migração 0008, tabela public.molde_jobs).
 *
 * A página do Molde põe trabalhos na fila; o robô do Mac ("Estúdio do Molde") pede o próximo (claim), avisa o andamento
 * (batimento, que renova o prazo de 10 min), pede aprovação com uma prévia e, no fim, conclui ou registra o erro.
 * Se o Mac sumir no meio (desligou, perdeu a internet), o relógio devolve o trabalho para a fila quando o prazo vence;
 * na 3ª vez o trabalho vira "erro" (com aviso no Telegram). Há um teto de gastos por mês (MOLDE_TETO_USD, padrão 50).
 * Sem a 0008 a tabela não existe (erro 42P01): as rotas respondem "Falta colar a atualização 0008".
 * Documentação completa da API: docs/API_MOLDE_JOBS.md.
 */

export const JOB_STATES = ["na_fila", "rodando", "esperando_aprovacao", "aprovado", "recusado", "pronto", "erro", "cancelado"] as const;
export type JobState = (typeof JOB_STATES)[number];
/** Estados que o robô pode pegar: começar (na_fila), continuar depois do «Aprovar» (aprovado) ou refazer (recusado). */
export const CLAIMABLE_STATES: JobState[] = ["na_fila", "aprovado", "recusado"];
export const FINISHED_STATES: JobState[] = ["pronto", "erro", "cancelado"];

export const LEASE_MINUTES = 10;
export const MAX_ATTEMPTS = 3;
export const DEFAULT_CAP_USD = 50;
/** Trava curta do "pegar o próximo": dois Macs pedindo ao mesmo tempo não passam juntos do teto do mês. */
const CLAIM_LOCK_KEY = 7_726_009;

export const MISSING_0008 = "Falta colar a atualização 0008 no Supabase (veja docs/ATUALIZACAO_0008.md).";
export const NOTE_LEASE_GAVE_UP = "O Mac parou de responder no meio deste trabalho 3 vezes. Confira o Mac e peça para tentar de novo.";

/** Começo do mês no horário de São Paulo (os gastos zeram no dia 1º). */
export const MONTH_START_SQL = "(date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')";

/** A 0008 ainda não foi colada (tabela ou coluna inexistente). */
export function isMissing0008(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

/** Teto de gastos do mês em dólares (MOLDE_TETO_USD; padrão 50). 0 = nenhum trabalho que custa sai sem "forçar". */
export function capUsd() {
  const raw = process.env.MOLDE_TETO_USD?.trim().replace(",", ".");
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CAP_USD;
}

export type JobPreview = { texto?: string; imagem?: string; video?: string; audio?: string; link?: string };
export type JobApproval = { decisao: "aprovar" | "refazer"; via: "pagina" | "telegram"; por: string | null; em: string; nota: string | null; rodada: number };

export type JobRow = {
  id: string;
  account_id: string | null;
  account_username?: string | null;
  projeto: string;
  tipo: string;
  ref: string;
  titulo: string;
  estado: JobState;
  etapa: string | null;
  progresso: number;
  prioridade: number;
  payload: Record<string, unknown>;
  resultado: Record<string, unknown> | null;
  previa: JobPreview | null;
  erro: string | null;
  tentativas: number;
  retomar_estado: JobState | null;
  lease_until: Date | null;
  worker: string | null;
  /** Código de posse do último claim (só sai na resposta do claim). */
  posse?: string | null;
  custo_estimado_usd: string | number;
  forcar_custo: boolean;
  rodada: number;
  aprovacao: JobApproval | null;
  aprovacoes: JobApproval[];
  telegram_msg_id: string | number | null;
  previa_apagada_em?: Date | null;
  iniciado_em: Date | null;
  concluido_em: Date | null;
  criado_em: Date;
  atualizado_em: Date;
};

const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);

/**
 * Por onde o robô retoma um trabalho que acabou de pegar (ou que está esperando ser pego):
 * "comecar" (do zero, com o payload), "continuar" (a dona tocou em «Aprovar» na prévia atual: siga sem refazer)
 * ou "refazer" (tocou em «Refazer»: faça de novo, levando em conta `aprovacao.nota`).
 */
export type JobResume = "comecar" | "continuar" | "refazer";
export function jobResume(row: Pick<JobRow, "estado" | "retomar_estado" | "aprovacao" | "rodada">): JobResume {
  const origem = row.estado === "rodando" ? row.retomar_estado : row.estado;
  const decisaoAtual = row.aprovacao && Number(row.aprovacao.rodada) === row.rodada ? row.aprovacao.decisao : null;
  if (origem === "aprovado" && decisaoAtual === "aprovar") return "continuar";
  if (origem === "recusado" && decisaoAtual === "refazer") return "refazer";
  return "comecar";
}

/** O que a página e o robô veem de cada trabalho. */
export function jobView(row: JobRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    username: row.account_username ?? null,
    projeto: row.projeto,
    tipo: row.tipo,
    ref: row.ref,
    titulo: row.titulo,
    estado: row.estado,
    etapa: row.etapa,
    progresso: row.progresso,
    prioridade: row.prioridade,
    payload: row.payload ?? {},
    resultado: row.resultado,
    previa: row.previa,
    /** true = o relógio já apagou do R2 a prévia (30 dias depois): os links de `previa` não abrem mais. */
    previaApagada: Boolean(row.previa_apagada_em),
    erro: row.erro,
    tentativas: row.tentativas,
    worker: row.worker,
    leaseAte: iso(row.lease_until),
    custoEstimadoUsd: Number(row.custo_estimado_usd),
    forcarCusto: row.forcar_custo,
    rodada: row.rodada,
    aprovacao: row.aprovacao,
    aprovacoes: row.aprovacoes ?? [],
    /** De onde o trabalho saiu ao ser pego (na_fila, aprovado ou recusado); null antes do primeiro claim. */
    retomarEstado: row.retomar_estado,
    /** "comecar" | "continuar" | "refazer": o que o robô faz com este trabalho (veja docs/API_MOLDE_JOBS.md). */
    retomada: jobResume(row),
    iniciadoEm: iso(row.iniciado_em),
    concluidoEm: iso(row.concluido_em),
    criadoEm: iso(row.criado_em),
    atualizadoEm: iso(row.atualizado_em),
  };
}
export type JobView = ReturnType<typeof jobView>;

const SELECT_JOB = `select j.*, ia.instagram_username as account_username
  from public.molde_jobs j left join public.instagram_accounts ia on ia.id = j.account_id`;

export async function getJob(id: string, client?: PoolClient): Promise<JobRow | null> {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run<JobRow>(`${SELECT_JOB} where j.id = $1`, [id]);
  return rows[0] ?? null;
}

export class JobAccountNotFoundError extends Error {}

export type NewJob = {
  projeto: string;
  tipo: string;
  ref: string;
  titulo?: string;
  accountId?: string | null;
  payload?: Record<string, unknown>;
  custoEstimadoUsd?: number;
  prioridade?: number;
  forcarCusto?: boolean;
};

/** Cria o trabalho; se já existe um com o mesmo (projeto, tipo, ref), devolve o que existe sem mudar nada. */
export async function createJob(input: NewJob): Promise<{ job: JobRow; criado: boolean }> {
  try {
    const { rows } = await query<{ id: string; criado: boolean }>(
      `insert into public.molde_jobs (projeto, tipo, ref, titulo, account_id, payload, custo_estimado_usd, prioridade, forcar_custo)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       on conflict (projeto, tipo, ref) do update set ref = public.molde_jobs.ref
       returning id, (xmax = 0) as criado`,
      [
        input.projeto,
        input.tipo,
        input.ref,
        input.titulo ?? "",
        input.accountId ?? null,
        JSON.stringify(input.payload ?? {}),
        input.custoEstimadoUsd ?? 0,
        input.prioridade ?? 0,
        input.forcarCusto === true,
      ],
    );
    const job = await getJob(rows[0].id);
    return { job: job as JobRow, criado: rows[0].criado };
  } catch (error) {
    if ((error as { code?: string }).code === "23503") throw new JobAccountNotFoundError("Perfil não encontrado.");
    throw error;
  }
}

export async function listJobs(filter: { projeto?: string | null; estados?: JobState[] | null; tipo?: string | null; limite?: number }) {
  const { rows } = await query<JobRow>(
    `${SELECT_JOB}
     where ($1::text is null or j.projeto = $1)
       and ($2::text[] is null or j.estado = any($2))
       and ($3::text is null or j.tipo = $3)
     order by j.atualizado_em desc, j.id
     limit $4`,
    [filter.projeto ?? null, filter.estados?.length ? filter.estados : null, filter.tipo ?? null, filter.limite ?? 50],
  );
  return rows;
}

/** Soma do custo estimado dos trabalhos começados neste mês (horário de São Paulo). */
export async function monthSpendUsd(client?: PoolClient) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run<{ total: string }>(
    `select coalesce(sum(custo_estimado_usd), 0) as total from public.molde_jobs where iniciado_em >= ${MONTH_START_SQL}`,
  );
  return Number(rows[0]?.total ?? 0);
}

/** Nome do mês atual em português (para as frases). */
export function monthName(now = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long" }).format(now);
}

/** Chave do mês atual em São Paulo (ex.: 2026-10). */
export function monthKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}

export type ClaimResult = {
  job: JobRow | null;
  /** Há trabalho esperando, mas ele passaria do teto do mês (só sai com "forçar"). */
  barradoPeloTeto: number;
  gastoUsd: number;
  tetoUsd: number;
};

/**
 * Pega o próximo trabalho (o de maior prioridade, o mais antigo primeiro) entre os tipos que o Mac sabe fazer.
 * `for update skip locked`: dois Macs nunca pegam o mesmo. O trabalho fica "rodando", com prazo de 10 min (lease).
 * Trabalho que custa e ainda não começou só sai se couber no teto do mês (gasto + custo <= teto) ou com "forçar".
 * Grava também "o Mac pediu trabalho agora" (app_status 'molde_mac'), mesmo que não haja nada: é o "Mac acordado".
 */
export async function claimNextJob(input: { worker: string; tipos: string[] }): Promise<ClaimResult> {
  const teto = capUsd();
  const posse = randomUUID();
  // "O Mac pediu trabalho agora" é gravado ANTES e fora da transação do claim: se o claim falhar (ex.: a 0008 antiga,
  // sem a coluna `posse`) o Mac continua marcado como acordado e o relógio não manda um aviso falso de "Mac desligado".
  await markMacAwake(input.worker);
  const result = await transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock($1)", [CLAIM_LOCK_KEY]);
    const gasto = await monthSpendUsd(client);
    const { rows } = await client.query<{ id: string }>(
      `with candidato as (
         select j.id, j.estado from public.molde_jobs j
         where j.estado = any($1::text[]) and j.tipo = any($2::text[])
           and (j.iniciado_em is not null or j.custo_estimado_usd <= 0 or j.forcar_custo or $3::numeric + j.custo_estimado_usd <= $4::numeric)
         order by j.prioridade desc, j.criado_em, j.id
         limit 1
         for update of j skip locked
       )
       update public.molde_jobs j
       set estado = 'rodando', retomar_estado = c.estado, worker = $5, lease_until = now() + make_interval(mins => $6),
           tentativas = j.tentativas + 1, iniciado_em = coalesce(j.iniciado_em, now()), erro = null,
           etapa = case when c.estado = 'na_fila' then coalesce(j.etapa, 'Começando') else j.etapa end,
           posse = $7::uuid, atualizado_em = now()
       from candidato c
       where j.id = c.id
       returning j.id`,
      [CLAIMABLE_STATES, input.tipos, gasto, teto, input.worker, LEASE_MINUTES, posse],
    );
    if (rows[0]) {
      const job = await getJob(rows[0].id, client);
      return { job, barradoPeloTeto: 0, gastoUsd: gasto, tetoUsd: teto };
    }
    const { rows: blocked } = await client.query<{ n: number }>(
      `select count(*)::int as n from public.molde_jobs j
       where j.estado = any($1::text[]) and j.tipo = any($2::text[])
         and j.iniciado_em is null and j.custo_estimado_usd > 0 and not j.forcar_custo
         and $3::numeric + j.custo_estimado_usd > $4::numeric`,
      [CLAIMABLE_STATES, input.tipos, gasto, teto],
    );
    return { job: null, barradoPeloTeto: blocked[0]?.n ?? 0, gastoUsd: gasto, tetoUsd: teto };
  });
  if (result.job) await markMacAwake(input.worker, result.job.id);
  return result;
}

/** Grava "o Mac pediu trabalho agora" (app_status 'molde_mac'). Nunca lança: é só o sinal de Mac acordado. */
async function markMacAwake(worker: string, pegou: string | null = null) {
  try {
    await query(
      `insert into public.app_status (chave, valor, atualizado_em) values ('molde_mac', $1::jsonb, now())
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
      [JSON.stringify({ worker, pegou })],
    );
  } catch (error) {
    console.error("[molde-jobs] não consegui gravar que o Mac está acordado:", error instanceof Error ? error.message : error);
  }
}

/** Resultado das ações do robô sobre um trabalho que ele pegou. */
export type WorkerOutcome =
  | { ok: true; job: JobRow }
  | { ok: false; motivo: "not-found" }
  | { ok: false; motivo: "not-yours"; job: JobRow }
  /** Está rodando com este Mac, mas o código de posse não bate (um claim mais novo pegou o trabalho, ou o robô não mandou). */
  | { ok: false; motivo: "no-posse"; job: JobRow };

/** Código que nunca é de um claim: o robô mandou uma `posse` com formato errado, que conta como "mandou e não bate". */
export const POSSE_INVALIDA = "00000000-0000-0000-0000-000000000000";

/**
 * MOLDE_EXIGIR_POSSE=1 liga a exigência estrita: sem `posse` (ou em trabalho antigo sem posse gravada) a ação do robô é
 * recusada com 409 sem_posse. Desligada (o padrão), robô antigo (0.10.0, sem `posse`) e linhas "rodando" de antes da
 * coluna (posse nula) continuam funcionando; só uma `posse` MANDADA que não bate é recusada.
 * Ordem recomendada: colar a 0008 → publicar o servidor → atualizar o robô → só então exigir (docs/ATUALIZACAO_0008.md).
 */
export function posseEstrita() {
  return /^(1|true|sim)$/i.test(process.env.MOLDE_EXIGIR_POSSE?.trim() ?? "");
}

/** Explica por que a ação do robô não pegou (trabalho sumiu, foi cancelado, voltou para a fila ou está com outro Mac). */
async function explainWorkerMiss(id: string, worker: string, posse: string | null): Promise<WorkerOutcome> {
  const job = await getJob(id);
  if (!job) return { ok: false, motivo: "not-found" };
  // Sem exigência estrita, a falta de `posse` nunca é o motivo da recusa: só uma `posse` mandada que não bate.
  if (job.estado === "rodando" && job.worker === worker && (posse !== null || posseEstrita())) return { ok: false, motivo: "no-posse", job };
  return { ok: false, motivo: "not-yours", job };
}

/**
 * Ação do robô: só vale para o trabalho "rodando" com este Mac. Sobre a `posse` (código do último claim):
 * ausente (null) ou linha antiga sem posse gravada → vale (a não ser com MOLDE_EXIGIR_POSSE=1); mandada e diferente → recusa.
 */
async function workerUpdate(id: string, worker: string, posse: string | null, setSql: string, params: unknown[]): Promise<WorkerOutcome> {
  const posseSql = posseEstrita() ? "posse = $3::uuid" : "($3::uuid is null or posse is null or posse = $3::uuid)";
  const { rows } = await query<{ id: string }>(
    `update public.molde_jobs set ${setSql}, atualizado_em = now()
     where id = $1 and estado = 'rodando' and worker = $2 and ${posseSql}
     returning id`,
    [id, worker, posse, ...params],
  );
  if (!rows[0]) return explainWorkerMiss(id, worker, posse);
  return { ok: true, job: (await getJob(id)) as JobRow };
}

/** Batimento: renova o prazo (10 min) e grava a etapa e o progresso (os que vierem). */
export function heartbeatJob(id: string, worker: string, posse: string | null, input: { etapa?: string | null; progresso?: number | null }) {
  return workerUpdate(
    id,
    worker,
    posse,
    `lease_until = now() + make_interval(mins => $4), etapa = coalesce($5::text, etapa), progresso = coalesce($6::int, progresso)`,
    [LEASE_MINUTES, input.etapa ?? null, input.progresso ?? null],
  );
}

/** Terminou: "pronto", progresso 100, com o resultado (os que vierem). */
export function finishJob(id: string, worker: string, posse: string | null, resultado: Record<string, unknown> | null) {
  return workerUpdate(
    id,
    worker,
    posse,
    `estado = 'pronto', progresso = 100, etapa = coalesce($4::text, 'Pronto'), resultado = coalesce($5::jsonb, resultado),
     lease_until = null, concluido_em = now(), erro = null`,
    ["Pronto", resultado ? JSON.stringify(resultado) : null],
  );
}

/**
 * Erro. Com `tentarDeNovo` (erro passageiro: internet, site fora do ar) e menos de 3 tentativas, volta para a fila
 * (para o mesmo ponto de onde saiu); senão vira "erro" e o relógio avisa no Telegram.
 */
export function failJob(id: string, worker: string, posse: string | null, erro: string, tentarDeNovo: boolean) {
  return workerUpdate(
    id,
    worker,
    posse,
    `estado = case when $5 and tentativas < $6 then coalesce(retomar_estado, 'na_fila') else 'erro' end,
     erro = $4, worker = null, lease_until = null,
     concluido_em = case when $5 and tentativas < $6 then null else now() end`,
    [erro, tentarDeNovo, MAX_ATTEMPTS],
  );
}

/** O robô terminou uma parte e pede aprovação com a prévia. A rodada aumenta; a decisão anterior sai de "aprovacao". */
export function requestApproval(id: string, worker: string, posse: string | null, previa: JobPreview, resultado: Record<string, unknown> | null) {
  return workerUpdate(
    id,
    worker,
    posse,
    `estado = 'esperando_aprovacao', previa = $4::jsonb, resultado = coalesce($5::jsonb, resultado), rodada = rodada + 1,
     aprovacao = null, worker = null, lease_until = null, tentativas = 0, etapa = 'Esperando a sua aprovação',
     telegram_msg_id = null, telegram_aviso_em = null`,
    [JSON.stringify(previa), resultado ? JSON.stringify(resultado) : null],
  );
}

export type DecideOutcome =
  | { ok: true; job: JobRow }
  | { ok: false; motivo: "not-found" }
  /** Já decidido (dois toques, ou a página e o Telegram ao mesmo tempo): `job.aprovacao` diz o que valeu. */
  | { ok: false; motivo: "already"; job: JobRow }
  /** O botão é de uma prévia antiga (o robô já mandou outra depois). */
  | { ok: false; motivo: "old-round"; job: JobRow }
  /** O trabalho não está esperando aprovação (ex.: cancelado). */
  | { ok: false; motivo: "not-waiting"; job: JobRow };

/**
 * «Aprovar» ou «Refazer» (pela página ou pelo Telegram). Só vale para a rodada em que o trabalho está: um botão de uma
 * prévia antiga não aprova a prévia nova. Só a primeira decisão vale (o update só acontece em "esperando_aprovacao").
 */
export async function decideJob(
  id: string,
  input: { decisao: "aprovar" | "refazer"; via: "pagina" | "telegram"; por?: string | null; nota?: string | null; rodada?: number | null },
): Promise<DecideOutcome> {
  const { rows } = await query<{ id: string }>(
    `update public.molde_jobs
     set estado = $2,
         aprovacao = jsonb_build_object('decisao', $3::text, 'via', $4::text, 'por', $5::text, 'em', now(), 'nota', $6::text, 'rodada', rodada),
         aprovacoes = aprovacoes || jsonb_build_array(jsonb_build_object('decisao', $3::text, 'via', $4::text, 'por', $5::text, 'em', now(), 'nota', $6::text, 'rodada', rodada)),
         etapa = case when $3 = 'aprovar' then 'Aprovado' else 'Refazer' end,
         tentativas = 0, atualizado_em = now()
     where id = $1 and estado = 'esperando_aprovacao' and ($7::int is null or rodada = $7)
     returning id`,
    [id, input.decisao === "aprovar" ? "aprovado" : "recusado", input.decisao, input.via, input.por ?? null, input.nota ?? null, input.rodada ?? null],
  );
  const job = await getJob(id);
  if (!job) return { ok: false, motivo: "not-found" };
  if (rows[0]) return { ok: true, job };
  if (input.rodada != null && input.rodada !== job.rodada) return { ok: false, motivo: "old-round", job };
  if (job.aprovacao && Number(job.aprovacao.rodada) === job.rodada) return { ok: false, motivo: "already", job };
  return { ok: false, motivo: "not-waiting", job };
}

/** Cancela. Um trabalho "rodando" para no próximo batimento do robô (ele recebe 409 com estado "cancelado"). */
export async function cancelJob(id: string): Promise<{ ok: true; job: JobRow } | { ok: false; motivo: "not-found" } | { ok: false; motivo: "finished"; job: JobRow }> {
  const { rows } = await query<{ id: string }>(
    `update public.molde_jobs
     set estado = 'cancelado', worker = null, lease_until = null, concluido_em = now(), etapa = 'Cancelado', atualizado_em = now()
     where id = $1 and estado not in ('pronto', 'erro', 'cancelado')
     returning id`,
    [id],
  );
  const job = await getJob(id);
  if (!job) return { ok: false, motivo: "not-found" };
  if (rows[0] || job.estado === "cancelado") return { ok: true, job };
  return { ok: false, motivo: "finished", job };
}

/**
 * «Tentar de novo» depois de erro ou cancelamento: volta para a fila do começo, com as tentativas zeradas. A última
 * decisão (`aprovacao`) sai (o histórico fica em `aprovacoes`): o robô recebe `retomada: "comecar"` e refaz de verdade,
 * mesmo que o trabalho tivesse sido aprovado antes do erro.
 */
export async function retryJob(id: string): Promise<{ ok: true; job: JobRow } | { ok: false; motivo: "not-found" } | { ok: false; motivo: "busy"; job: JobRow }> {
  const { rows } = await query<{ id: string }>(
    `update public.molde_jobs
     set estado = 'na_fila', erro = null, tentativas = 0, worker = null, lease_until = null, retomar_estado = null,
         aprovacao = null, posse = null, etapa = null, progresso = 0, concluido_em = null, aviso_erro_em = null, atualizado_em = now()
     where id = $1 and estado in ('erro', 'cancelado')
     returning id`,
    [id],
  );
  const job = await getJob(id);
  if (!job) return { ok: false, motivo: "not-found" };
  return rows[0] ? { ok: true, job } : { ok: false, motivo: "busy", job };
}

/** A dona confirmou que este trabalho pode passar do teto do mês. */
export async function forceCost(id: string) {
  const { rows } = await query<{ id: string }>(
    "update public.molde_jobs set forcar_custo = true, atualizado_em = now() where id = $1 returning id",
    [id],
  );
  return rows[0] ? getJob(id) : null;
}

/**
 * Relógio: trabalhos "rodando" cujo prazo venceu (o Mac sumiu) voltam para onde estavam (na_fila, aprovado ou
 * recusado); depois da 3ª tentativa viram "erro". Devolve quantos voltaram e quantos viraram erro.
 */
export async function expireLeases() {
  const { rows } = await query<{ estado: JobState }>(
    `update public.molde_jobs
     set estado = case when tentativas >= $1 then 'erro' else coalesce(retomar_estado, 'na_fila') end,
         erro = case when tentativas >= $1 then $2 else erro end,
         concluido_em = case when tentativas >= $1 then now() else concluido_em end,
         worker = null, lease_until = null, atualizado_em = now()
     where estado = 'rodando' and lease_until < now()
     returning estado`,
    [MAX_ATTEMPTS, NOTE_LEASE_GAVE_UP],
  );
  return { devolvidos: rows.filter((row) => row.estado !== "erro").length, erros: rows.filter((row) => row.estado === "erro").length };
}
