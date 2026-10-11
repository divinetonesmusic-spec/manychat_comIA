import type { PoolClient } from "pg";
import { query, transaction } from "@/lib/db/client";
import { refreshPending } from "@/lib/db/dm-pending";

/**
 * Limpeza do banco (roda no relógio, no máximo 1 vez por hora):
 * - eventos (public.events, que guardam o webhook inteiro) com mais de 90 dias;
 * - envios terminados (public.queue: enviado, falhou ou pulado) sem mudança há mais de 30 dias;
 * - tentativas de senha errada do administrador com mais de 1 dia.
 * Apaga em lotes de 500, dentro do tempo que sobra do relógio; o que não couber fica para a hora seguinte.
 * Usa os atalhos (índices) da 0007 para não varrer as tabelas inteiras: sem a 0007, não roda (e avisa no log uma vez).
 * A hora da última limpeza fica em public.app_status (chave 'limpeza'). Nunca lança erro.
 */
export const EVENTS_KEEP_DAYS = 90;
export const QUEUE_KEEP_DAYS = 30;
export const CLEANUP_EVERY_MINUTES = 60;
export const CLEANUP_BATCH = 500;
/** Prazo de cada lote no banco: um lote lento não pode segurar o relógio. */
const STATEMENT_TIMEOUT_MS = 2000;

let lastRunInProcess = 0;
let warnedMissing = false;

/** Só para os testes: esquece a última limpeza deste processo. */
export function resetCleanupMemory() {
  lastRunInProcess = 0;
}

export type CleanupResult = {
  ran: boolean;
  events: number;
  queue: number;
  loginAttempts: number;
  motivo?: "cedo" | "sem_tempo" | "sem_migracao" | "erro";
};

export async function cleanupOldRecords(options: { deadline?: number; force?: boolean } = {}): Promise<CleanupResult> {
  const out: CleanupResult = { ran: false, events: 0, queue: 0, loginAttempts: 0 };
  const deadline = options.deadline ?? Date.now() + 3000;
  const timeLeft = () => deadline - Date.now();

  if (!options.force && Date.now() - lastRunInProcess < CLEANUP_EVERY_MINUTES * 60_000) return { ...out, motivo: "cedo" };
  if (timeLeft() < 1000) return { ...out, motivo: "sem_tempo" };

  try {
    const { rows } = await query<{ pronto: boolean }>(
      "select to_regclass('public.events_received_idx') is not null and to_regclass('public.queue_finished_idx') is not null and to_regclass('public.admin_login_attempts') is not null as pronto",
    );
    if (!rows[0]?.pronto) {
      lastRunInProcess = Date.now();
      if (!warnedMissing) {
        warnedMissing = true;
        console.warn("[limpeza] a atualização 0007 ainda não foi colada no Supabase: a limpeza dos eventos e envios antigos não está rodando.");
      }
      return { ...out, motivo: "sem_migracao" };
    }

    // Vale para todos os servidores: só um faz a limpeza por hora (a linha 'limpeza' só muda se já passou 1 hora).
    const claimed = await query(
      `insert into public.app_status (chave, valor, atualizado_em) values ('limpeza', '{}'::jsonb, now())
       on conflict (chave) do update set atualizado_em = now()
       where public.app_status.atualizado_em < now() - make_interval(mins => $1) or $2
       returning chave`,
      [CLEANUP_EVERY_MINUTES, options.force === true],
    );
    lastRunInProcess = Date.now();
    if (!claimed.rowCount) return { ...out, motivo: "cedo" };
    out.ran = true;

    // DMs sem resposta "na fila" acompanham o envio: põe em dia antes de apagar envios velhos (sem a 0006, pula).
    await refreshPending().catch(() => undefined);

    out.queue = await deleteInBatches(timeLeft, `
      delete from public.queue where id in (
        select id from public.queue
        where status in ('sent', 'failed', 'skipped') and updated_at < now() - make_interval(days => ${QUEUE_KEEP_DAYS})
        order by updated_at
        limit ${CLEANUP_BATCH}
      )`);
    out.events = await deleteInBatches(timeLeft, `
      delete from public.events where id in (
        select id from public.events
        where received_at < now() - make_interval(days => ${EVENTS_KEEP_DAYS})
        order by received_at
        limit ${CLEANUP_BATCH}
      )`);
    out.loginAttempts = await deleteInBatches(timeLeft, `
      delete from public.admin_login_attempts where id in (
        select id from public.admin_login_attempts where attempted_at < now() - interval '1 day' limit ${CLEANUP_BATCH}
      )`);

    await query("update public.app_status set valor = $1::jsonb where chave = 'limpeza'", [
      JSON.stringify({ eventos: out.events, envios: out.queue, tentativas: out.loginAttempts }),
    ]).catch(() => undefined);
    return out;
  } catch (error) {
    console.error("[limpeza] não consegui limpar o banco:", error instanceof Error ? error.message : error);
    return { ...out, motivo: "erro" };
  }
}

/** Repete o lote enquanto houver o que apagar e tempo (pelo menos 300 ms). No máximo 20 lotes por vez. */
async function deleteInBatches(timeLeft: () => number, sql: string) {
  let total = 0;
  for (let round = 0; round < 20 && timeLeft() > 300; round += 1) {
    const deleted = await transaction(async (client: PoolClient) => {
      await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      return (await client.query(sql)).rowCount ?? 0;
    });
    total += deleted;
    if (deleted < CLEANUP_BATCH) break;
  }
  return total;
}
