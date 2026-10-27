import { query } from "@/lib/db/client";
import { CLAIMABLE_STATES, expireLeases, isMissing0008 } from "@/lib/molde/jobs";
import { sendTelegram, TELEGRAM_TIMEOUT_MS } from "@/lib/notify";
import { maybeSendWeeklyReport, type WeeklyReportResult } from "@/lib/relatorio-semanal";
import { sendDmDraftApproval, sendJobApproval } from "@/lib/telegram/approvals";
import { telegramBotConfig } from "@/lib/telegram/api";
import { deleteR2Object, getR2BackupConfig, getR2Config, keyFromPublicUrl, R2_DELETE_TIMEOUT_MS } from "@/lib/content/r2";
import { pruneBackups } from "@/lib/molde/backup";
import { isMissing0016, limparRascunhos } from "@/lib/molde/fila";
import { sendFilaApproval } from "@/lib/telegram/fila";
import { gruposPendentes, mostrarGrupo } from "@/lib/telegram/progresso";

/**
 * A parte do Molde no relógio (a cada minuto, depois do planner e do aviso de DMs). Tudo curto e dentro do prazo:
 * 1. Trabalhos cujo Mac sumiu (prazo de 10 min vencido) voltam para a fila; na 3ª vez viram "erro".
 * 2. Avisos no Telegram (só com o Telegram configurado), todos juntos e com o mesmo prazo:
 *    - trabalhos que viraram "erro" (1 aviso por trabalho);
 *    - "O Mac parece desligado": nenhum Mac pediu trabalho há mais de 30 min e há trabalho esperando há mais de 30 min
 *      (1 aviso por vez que o Mac some; repete depois de 12 h se continuar assim);
 *    - mensagens de aprovação que não saíram na hora (trabalhos, respostas de DM e, desde a v134, itens da fila única),
 *      de novo a cada 10 min por 1 dia;
 *    - o relatório de domingo.
 * 3. Prévias de aprovação no R2 (pasta molde-previas) de trabalhos parados há mais de 30 dias são apagadas (até 3 por vez).
 *    Um item cujo DELETE falha é pulado por 6 h (não trava os seguintes).
 * 4. Cópias de segurança do Molde: a limpeza das antigas (e das partes de envio esquecidas) roda aqui, no máximo a cada
 *    15 min, com o orçamento de tempo do relógio (as rotas de cópia só guardam).
 * 5. v134 · fila única (0016): os rascunhos do Telegram sem o 2º toque há mais de 1 dia são apagados; as aprovações da fila
 *    que não saíram na hora saem de novo (independe da 0008; sem a 0016, nada).
 * Sem a 0008 só o relatório roda (sem a parte dos gastos). Nunca lança erro.
 */
export const MAC_ASLEEP_MINUTES = 30;
const MAC_ALERT_REPEAT_HOURS = 12;
const ERROR_ALERT_MAX = 5;
const RESEND_MAX = 3;

let warnedMissing = false;

export type MoldeClockResult = {
  devolvidos: number;
  erros: number;
  avisos: number;
  aprovacoes: number;
  relatorio: WeeklyReportResult;
  previasApagadas?: number;
  copiasApagadas?: number;
  rascunhosApagados?: number;
  motivo?: "sem_tempo" | "sem_migracao" | "erro";
};

export async function runMoldeClock(options: { deadline: number; origin?: string | null; now?: Date }): Promise<MoldeClockResult> {
  const out: MoldeClockResult = { devolvidos: 0, erros: 0, avisos: 0, aprovacoes: 0, relatorio: { sent: false } };
  const timeLeft = () => options.deadline - Date.now();
  if (timeLeft() < 300) return { ...out, motivo: "sem_tempo", relatorio: { sent: false, motivo: "sem_tempo" } };

  const sends: Array<() => Promise<boolean>> = [];
  let has0008 = true;
  try {
    const expired = await expireLeases();
    out.devolvidos = expired.devolvidos;
    out.erros = expired.erros;
  } catch (error) {
    if (isMissing0008(error)) {
      has0008 = false;
      out.motivo = "sem_migracao";
      if (!warnedMissing) {
        warnedMissing = true;
        console.warn("[molde] a atualização 0008 ainda não foi colada no Supabase: a fila de trabalho do Molde está desligada.");
      }
    } else {
      console.error("[molde] não consegui conferir os trabalhos parados:", error instanceof Error ? error.message : error);
      out.motivo = "erro";
      has0008 = false;
    }
  }

  if (has0008 && timeLeft() > 3000) {
    out.previasApagadas = await cleanupOldPreviews(() => timeLeft()).catch((error) => {
      console.error("[molde] não consegui apagar as prévias antigas:", error instanceof Error ? error.message : error);
      return 0;
    });
  }

  if (timeLeft() > 5000) {
    const poda = await pruneBackupsIfDue(() => timeLeft()).catch((error) => {
      console.error("[molde] não consegui limpar as cópias antigas:", error instanceof Error ? error.message : error);
      return null;
    });
    if (poda) out.copiasApagadas = poda.apagadas;
  }

  const telegramTimeout = () => Math.min(TELEGRAM_TIMEOUT_MS, timeLeft() - 300);
  if (has0008 && telegramBotConfig() && timeLeft() > 1200) {
    try {
      sends.push(...(await errorAlerts(telegramTimeout())));
      sends.push(...(await macAsleepAlert(telegramTimeout())));
      sends.push(...(await resendApprovals(telegramTimeout())));
    } catch (error) {
      console.error("[molde] não consegui preparar os avisos do Molde:", error instanceof Error ? error.message : error);
    }
  }

  if (timeLeft() > 1500) {
    try {
      out.rascunhosApagados = await limparRascunhos();
      if (telegramBotConfig()) sends.push(...(await resendFilaApprovals(telegramTimeout())));
      // 0020 · as mensagens de progresso dos vídeos que mudaram e não couberam na hora (1 edição por segundo por mensagem)
      if (telegramBotConfig() && telegramTimeout() > 500) {
        const timeoutMs = telegramTimeout();
        sends.push(...(await gruposPendentes()).map((grupo) => () => mostrarGrupo(grupo, { timeoutMs })));
      }
    } catch (error) {
      if (!isMissing0016(error)) console.error("[molde] não consegui cuidar da fila única:", error instanceof Error ? error.message : error);
    }
  }

  // O relatório de domingo corre junto com os avisos (cada um com o seu prazo).
  const report = maybeSendWeeklyReport({ deadline: options.deadline, origin: options.origin, now: options.now });
  const [results, relatorio] = await Promise.all([Promise.all(sends.map((send) => send())), report]);
  out.avisos = results.filter(Boolean).length;
  out.relatorio = relatorio;
  return out;
}

/** Trabalhos que viraram "erro" nos últimos 2 dias e ainda não foram avisados: 1 mensagem com todos. */
async function errorAlerts(timeoutMs: number): Promise<Array<() => Promise<boolean>>> {
  const { rows } = await query<{ id: string; titulo: string; ref: string; erro: string | null; username: string | null }>(
    `select j.id, j.titulo, j.ref, j.erro, ia.instagram_username as username
     from public.molde_jobs j left join public.instagram_accounts ia on ia.id = j.account_id
     where j.estado = 'erro' and j.aviso_erro_em is null and j.atualizado_em > now() - interval '2 days'
     order by j.atualizado_em
     limit ${ERROR_ALERT_MAX}`,
  );
  if (!rows.length || timeoutMs < 500) return [];
  const lines = rows.map((row) => {
    const conta = row.username ? ` (@${row.username})` : "";
    const motivo = (row.erro ?? "").trim() || "sem detalhe.";
    return `- «${row.titulo || row.ref}»${conta}: ${motivo.length > 300 ? `${motivo.slice(0, 299)}…` : motivo}`;
  });
  const text = [
    rows.length === 1 ? "UaiFlow: um trabalho do Molde deu erro." : `UaiFlow: ${rows.length} trabalhos do Molde deram erro.`,
    ...lines,
    "Abra a página do Molde para tentar de novo.",
  ].join("\n");
  return [() => sendTelegram(text, { timeoutMs }).then(async (result) => {
    if (!result.ok) return false;
    await query("update public.molde_jobs set aviso_erro_em = now() where id = any($1::uuid[])", [rows.map((row) => row.id)]).catch(() => undefined);
    return true;
  })];
}

/** "O Mac parece desligado: tem N coisas esperando." */
async function macAsleepAlert(timeoutMs: number): Promise<Array<() => Promise<boolean>>> {
  const { rows } = await query<{ esperando: number; avisar: boolean }>(
    `with mac as (select atualizado_em from public.app_status where chave = 'molde_mac'),
          aviso as (select atualizado_em from public.app_status where chave = 'aviso_mac')
     select (select count(*)::int from public.molde_jobs where estado = any($1::text[])) as esperando,
            (
              exists (select 1 from public.molde_jobs where estado = any($1::text[]) and atualizado_em < now() - make_interval(mins => $2))
              and coalesce((select atualizado_em from mac), '-infinity'::timestamptz) < now() - make_interval(mins => $2)
              and (
                (select atualizado_em from aviso) is null
                or (select atualizado_em from aviso) < coalesce((select atualizado_em from mac), '-infinity'::timestamptz)
                or (select atualizado_em from aviso) < now() - make_interval(hours => $3)
              )
            ) as avisar`,
    [CLAIMABLE_STATES, MAC_ASLEEP_MINUTES, MAC_ALERT_REPEAT_HOURS],
  );
  const row = rows[0];
  if (!row?.avisar || timeoutMs < 500) return [];
  const coisas = row.esperando === 1 ? "1 coisa esperando" : `${row.esperando} coisas esperando`;
  const text = [
    `UaiFlow: o Mac parece desligado: tem ${coisas} na fila do Molde.`,
    "Ligue o Mac e abra o app Claude: o Estúdio do Molde pega o trabalho sozinho.",
  ].join("\n");
  return [() => sendTelegram(text, { timeoutMs }).then(async (result) => {
    if (!result.ok) return false;
    await query(
      `insert into public.app_status (chave, valor, atualizado_em) values ('aviso_mac', $1::jsonb, now())
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
      [JSON.stringify({ esperando: row.esperando })],
    ).catch(() => undefined);
    return true;
  })];
}

/** Mensagens de aprovação que não saíram na hora (o Telegram falhou): de novo a cada 10 min, por até 1 dia. */
async function resendApprovals(timeoutMs: number): Promise<Array<() => Promise<boolean>>> {
  if (timeoutMs < 500) return [];
  const { rows: jobs } = await query<{ id: string }>(
    `select id from public.molde_jobs
     where estado = 'esperando_aprovacao' and telegram_msg_id is null
       and atualizado_em < now() - interval '1 minute' and atualizado_em > now() - interval '1 day'
       and (telegram_aviso_em is null or telegram_aviso_em < now() - interval '10 minutes')
     order by atualizado_em
     limit ${RESEND_MAX}`,
  );
  const out = jobs.map((job) => () => sendJobApproval(job.id, { timeoutMs }));
  try {
    const { rows: drafts } = await query<{ id: string; draft_seq: number }>(
      `select id, draft_seq from public.dm_pending
       where status = 'aguardando' and draft_text is not null and telegram_msg_id is null
         and draft_at < now() - interval '1 minute' and draft_at > now() - interval '1 day'
         and (telegram_aviso_em is null or telegram_aviso_em < now() - interval '10 minutes')
       order by draft_at
       limit ${RESEND_MAX}`,
    );
    out.push(...drafts.map((draft) => () => sendDmDraftApproval(draft.id, draft.draft_seq, { timeoutMs })));
  } catch (error) {
    if (!isMissing0008(error)) throw error; // sem a 0006 a tabela não existe: só os trabalhos
  }
  return out;
}

export const PREVIEW_KEEP_DAYS = 30;
const PREVIEW_PREFIX = "uaiflow/molde-previas/";
const PREVIEW_CLEANUP_MAX = 3;

/** As chaves do R2 das prévias de um trabalho (só as da pasta molde-previas: o vídeo final do post não é tocado). */
export function previewKeys(previa: Record<string, unknown> | null, resultado: Record<string, unknown> | null) {
  const links = (resultado?.links ?? null) as Record<string, unknown> | null;
  const urls = [previa?.video, previa?.imagem, previa?.audio, previa?.link, links?.previa];
  const keys = new Set<string>();
  for (const url of urls) {
    const key = typeof url === "string" ? keyFromPublicUrl(url) : null;
    if (key?.startsWith(PREVIEW_PREFIX)) keys.add(key);
  }
  return [...keys];
}

/** Um trabalho cuja prévia não deu para apagar (R2 recusou ou não respondeu) espera 6 h antes de tentarmos de novo. */
export const PREVIEW_RETRY_PAUSE_HOURS = 6;
const PREVIEW_ATTEMPTS_KEY = "previas_tentativas";

async function previewAttempts(): Promise<Record<string, string>> {
  try {
    const { rows } = await query<{ valor: Record<string, string> }>("select valor from public.app_status where chave = $1", [PREVIEW_ATTEMPTS_KEY]);
    const limit = Date.now() - PREVIEW_RETRY_PAUSE_HOURS * 3_600_000;
    return Object.fromEntries(Object.entries(rows[0]?.valor ?? {}).filter(([, em]) => Date.parse(em) > limit));
  } catch {
    return {};
  }
}

/**
 * Apaga do R2 as prévias de aprovação de trabalhos parados há mais de 30 dias. Devolve quantos trabalhos limpou.
 * Se o DELETE de um item falha, ele é anotado (app_status 'previas_tentativas') e pulado por 6 h: os próximos da fila
 * não ficam presos atrás dele.
 */
async function cleanupOldPreviews(timeLeft: () => number) {
  const r2 = getR2Config();
  if (!r2) return 0;
  const tentativas = await previewAttempts();
  const { rows } = await query<{ id: string; previa: Record<string, unknown> | null; resultado: Record<string, unknown> | null }>(
    `select id, previa, resultado from public.molde_jobs
     where previa_apagada_em is null and estado <> 'rodando'
       and atualizado_em < now() - make_interval(days => $1)
       and (previa::text like $2 or resultado::text like $2)
       and id <> all($3::uuid[])
     order by atualizado_em
     limit ${PREVIEW_CLEANUP_MAX}`,
    [PREVIEW_KEEP_DAYS, `%${r2.publicBaseUrl}/${PREVIEW_PREFIX}%`, Object.keys(tentativas)],
  );
  let cleaned = 0;
  let falhou = false;
  for (const row of rows) {
    if (timeLeft() < 2000) break;
    let ok = true;
    let semTempo = false;
    for (const key of previewKeys(row.previa, row.resultado)) {
      // Cada DELETE espera no máximo o que sobra do orçamento (até 2 s); sem tempo, fica para a próxima volta.
      if (timeLeft() < 1500) {
        ok = false;
        semTempo = true;
        break;
      }
      ok = (await deleteR2Object(key, Math.min(R2_DELETE_TIMEOUT_MS, timeLeft() - 1000)).catch(() => false)) && ok;
    }
    if (!ok) {
      if (!semTempo) {
        tentativas[row.id] = new Date().toISOString();
        falhou = true;
      }
      continue;
    }
    await query("update public.molde_jobs set previa_apagada_em = now() where id = $1", [row.id]);
    delete tentativas[row.id];
    cleaned += 1;
  }
  if (falhou || cleaned) {
    await query(
      `insert into public.app_status (chave, valor, atualizado_em) values ($1, $2::jsonb, now())
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
      [PREVIEW_ATTEMPTS_KEY, JSON.stringify(tentativas)],
    ).catch(() => undefined);
  }
  return cleaned;
}

export const BACKUP_PRUNE_EVERY_MIN = 15;

/** A limpeza das cópias roda no máximo a cada 15 min (a reserva fica em app_status 'molde_poda'); sem R2 ou sem a tabela, nada. */
async function pruneBackupsIfDue(timeLeft: () => number) {
  if (!getR2BackupConfig()) return null;
  const claimed = await query(
    `insert into public.app_status (chave, valor, atualizado_em) values ('molde_poda', '{}'::jsonb, now())
     on conflict (chave) do update set atualizado_em = now()
     where public.app_status.atualizado_em < now() - make_interval(mins => $1)
     returning chave`,
    [BACKUP_PRUNE_EVERY_MIN],
  ).catch(() => null); // sem a tabela app_status: não limpa (nunca lança)
  if (!claimed?.rowCount) return null;
  return pruneBackups({ timeLeft });
}

/** v134 · itens da fila única «para aprovar» cuja mensagem não saiu na hora: de novo a cada 10 min, por 1 dia. */
async function resendFilaApprovals(timeoutMs: number): Promise<Array<() => Promise<boolean>>> {
  if (timeoutMs < 500) return [];
  const { rows } = await query<{ id: string }>(
    `select id from public.molde_fila
     where estado = 'para_aprovar' and telegram_msg_id is null
       and atualizado_em < now() - interval '1 minute' and atualizado_em > now() - interval '1 day'
       and (telegram_aviso_em is null or telegram_aviso_em < now() - interval '10 minutes')
     order by atualizado_em
     limit ${RESEND_MAX}`,
  );
  return rows.map((row) => () => sendFilaApproval(row.id, { timeoutMs }));
}
