import { query } from "@/lib/db/client";
import { isTelegramConfigured, sendTelegram, TELEGRAM_TIMEOUT_MS } from "@/lib/notify";

/**
 * Aviso no Telegram de DM esperando resposta (as "DMs sem resposta" da 0006, que esperam a dona aprovar no Molde).
 * Roda no relógio. Manda UMA mensagem por perfil quando há conversa esperando há mais de 30 min que ainda não foi avisada,
 * no máximo 1 aviso a cada 2 h por perfil, com quantas mensagens esperam e quanto falta para vencer o prazo de 24 h do
 * Instagram (a mais urgente). Marca o aviso no banco (dm_pending.notified_at, migração 0007) para não repetir; uma
 * mensagem nova da mesma pessoa depois do aviso pode gerar outro aviso (respeitando as 2 h).
 * Sem Telegram, sem a 0006 ou sem a 0007: não faz nada e não quebra. Nunca lança erro.
 */
export const DM_ALERT_AFTER_MINUTES = 30;
export const DM_ALERT_EVERY_HOURS = 2;
const WINDOW_HOURS = 24;

let warnedMissing = false;

type AlertRow = {
  account_id: string;
  username: string | null;
  pessoas: number;
  mensagens: number;
  prazo: Date;
  ids: string[];
};

export type DmAlertResult = { sent: number; skipped?: "sem_telegram" | "sem_migracao" | "sem_tempo" | "erro" };

export async function notifyWaitingDms(options: { deadline?: number; origin?: string | null } = {}): Promise<DmAlertResult> {
  if (!isTelegramConfigured()) return { sent: 0, skipped: "sem_telegram" };
  const deadline = options.deadline ?? Date.now() + TELEGRAM_TIMEOUT_MS + 1000;

  let rows: AlertRow[];
  try {
    ({ rows } = await query<AlertRow>(
      `with base as (
         select d.id, d.account_id, d.messages, d.notified_at, c.last_response_at,
                -- a mensagem mais antiga que ainda não foi avisada (se não houver, a conversa não entra na conta do "esperando há 30 min")
                (select min((m ->> 'em')::timestamptz)
                   from jsonb_array_elements(d.messages) m
                  where (m ->> 'em')::timestamptz > coalesce(d.notified_at, '-infinity'::timestamptz)) as esperando_desde
         from public.dm_pending d
         join public.contacts c on c.id = d.contact_id
         where d.status = 'aguardando'
           and d.account_id is not null
           and c.opted_out_at is null
           and c.last_response_at > now() - make_interval(hours => $2)
       ),
       contas as (
         select distinct b.account_id
         from base b
         left join public.app_status s on s.chave = 'aviso_dms:' || b.account_id::text
         where b.esperando_desde < now() - make_interval(mins => $1)
           and (s.atualizado_em is null or s.atualizado_em < now() - make_interval(hours => $3))
       )
       select b.account_id, ia.instagram_username as username,
              count(*)::int as pessoas,
              sum(greatest(jsonb_array_length(b.messages), 1))::int as mensagens,
              min(b.last_response_at) + make_interval(hours => $2) as prazo,
              array_agg(b.id) as ids
       from base b
       join contas using (account_id)
       left join public.instagram_accounts ia on ia.id = b.account_id
       group by b.account_id, ia.instagram_username
       order by prazo asc`,
      [DM_ALERT_AFTER_MINUTES, WINDOW_HOURS, DM_ALERT_EVERY_HOURS],
    ));
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      if (!warnedMissing) {
        warnedMissing = true;
        console.warn("[dms] falta colar a atualização 0006 ou 0007 no Supabase: o aviso de DM esperando no Telegram está desligado.");
      }
      return { sent: 0, skipped: "sem_migracao" };
    }
    console.error("[dms] não consegui conferir as DMs esperando resposta:", error instanceof Error ? error.message : error);
    return { sent: 0, skipped: "erro" };
  }
  if (!rows.length) return { sent: 0 };

  const timeoutMs = Math.min(TELEGRAM_TIMEOUT_MS, deadline - Date.now() - 300);
  if (timeoutMs < 500) return { sent: 0, skipped: "sem_tempo" }; // fica para o próximo minuto

  const now = new Date();
  const results = await Promise.all(rows.map(async (row) => {
    const result = await sendTelegram(waitingDmsMessage(row, now), { timeoutMs });
    if (!result.ok) return false;
    try {
      await query("update public.dm_pending set notified_at = now() where id = any($1::uuid[])", [row.ids]);
      await query(
        `insert into public.app_status (chave, valor, atualizado_em) values ($1, $2::jsonb, now())
         on conflict (chave) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
        [`aviso_dms:${row.account_id}`, JSON.stringify({ pessoas: row.pessoas, mensagens: row.mensagens })],
      );
    } catch (error) {
      console.error("[dms] mandei o aviso, mas não consegui marcar no banco:", error instanceof Error ? error.message : error);
    }
    return true;
  }));
  return { sent: results.filter(Boolean).length };
}

/**
 * Ex.: "UaiFlow: 3 mensagens no Direct de @conta esperam resposta (de 2 pessoas).
 *       A mais urgente vence em 5 h 20 min (o Instagram só deixa responder até 24 h depois da última mensagem da pessoa).
 *       Responda pelo Molde."
 */
export function waitingDmsMessage(row: Pick<AlertRow, "username" | "pessoas" | "mensagens" | "prazo">, now = new Date()) {
  const perfil = row.username ? `de @${row.username}` : "do seu perfil";
  const mensagens = row.mensagens === 1 ? "1 mensagem" : `${row.mensagens} mensagens`;
  const verbo = row.mensagens === 1 ? "espera" : "esperam";
  const pessoas = row.pessoas === 1 ? "de 1 pessoa" : `de ${row.pessoas} pessoas`;
  const falta = new Date(row.prazo).getTime() - now.getTime();
  const quem = row.mensagens === 1 ? "Ela vence" : "A mais urgente vence";
  return [
    `UaiFlow: ${mensagens} no Direct ${perfil} ${verbo} resposta (${pessoas}).`,
    `${quem} em ${durationText(falta)} (o Instagram só deixa responder até 24 h depois da última mensagem da pessoa).`,
    "Responda pelo Molde.",
  ].join("\n");
}

/** 5 h 20 min, 45 min, menos de 1 min. */
export function durationText(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "menos de 1 min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
