import { query } from "@/lib/db/client";
import { enqueueJob, MOLDE_REPLY_OPTED_OUT } from "@/lib/db/repositories";
import { isMissingTables } from "@/lib/db/tracked-links";

/**
 * DMs sem resposta esperando o Molde (0006, seção 4): quando ninguém responde a uma mensagem, ela fica aqui até a dona
 * aprovar uma resposta. O envio usa a fila normal (limite de 200 por hora, prazo de 24 h do Instagram, conta pausada).
 * Sem a 0006 a tabela não existe (erro 42P01): o webhook ignora em silêncio e as rotas do Molde respondem 503.
 */

export { isMissingTables };

export type PendingMessage = { texto: string; em: string; eventId: string };
export type PendingStatus = "aguardando" | "na_fila" | "enviada" | "nao_enviada" | "expirada" | "descartada";

const MAX_MESSAGES = 10;
const MAX_TEXT_LENGTH = 2000;
/** Margem antes do fim do prazo de 24 h em que o Molde deve parar de oferecer a resposta. */
const DEADLINE_MARGIN_MINUTES = 10;

export const NOTE_WINDOW_EXPIRED = "Passou o prazo de 24 h do Instagram.";
export const NOTE_HUMAN_PAUSE = "O contato está em atendimento manual.";
const NOTE_LOST_FROM_QUEUE = "A resposta saiu da fila de envios sem ser enviada.";
const NOTE_COULD_NOT_SEND = "Não consegui enviar esta resposta.";
const NOTE_NOT_QUEUED = "Não consegui colocar a resposta na fila de envios.";
export const NOTE_OPTED_OUT = MOLDE_REPLY_OPTED_OUT;
/** Linhas fechadas (e as muito velhas que nunca fecharam) saem do banco depois disto. */
const KEEP_DAYS = 90;
const CLEANUP_EVERY_MS = 6 * 3600_000;
const CLEANUP_BATCH = 500;

let warnedMissingTable = false;

/**
 * Guarda a DM sem resposta (cria a linha "aguardando" do contato ou acrescenta à que já existe, mantendo as 10 mais novas).
 * Nunca lança erro: o webhook não pode falhar por causa disto. Sem a 0006 registra no log uma vez só por processo.
 */
export async function recordPendingDmSafely(input: {
  accountId: string;
  contactId: string;
  instagramUserId: string;
  username?: string | null;
  texto: string;
  em: Date;
  eventId: string;
}) {
  try {
    await recordPendingDm(input);
  } catch (error) {
    if (isMissingTables(error)) {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn("[dms] a atualização 0006 ainda não foi colada no Supabase: as DMs sem resposta não estão sendo guardadas.");
      }
      return;
    }
    console.error("[dms] não consegui guardar a DM sem resposta:", error instanceof Error ? error.message : error);
  }
}

async function recordPendingDm(input: Parameters<typeof recordPendingDmSafely>[0]) {
  const message: PendingMessage = { texto: input.texto.slice(0, MAX_TEXT_LENGTH), em: input.em.toISOString(), eventId: input.eventId };
  // Não entra se: a mesma mensagem (mesmo eventId, a Meta reentrega) já está em QUALQUER linha do contato, mesmo já
  // respondida, descartada ou expirada (senão nasceria outro "aguardando" com mensagem já tratada); ou se a pessoa pediu para sair.
  await query(
    `insert into public.dm_pending (account_id, contact_id, instagram_user_id, username, messages, last_message_at)
     select $1::uuid, $2::uuid, $3::text, $4::text, jsonb_build_array($5::jsonb), $6::timestamptz
     where not exists (
             select 1 from public.dm_pending o
             where o.contact_id = $2 and o.messages @> jsonb_build_array(jsonb_build_object('eventId', $7::text)))
       and not exists (select 1 from public.contacts c where c.id = $2 and c.opted_out_at is not null)
     on conflict (contact_id) where status = 'aguardando' do update set
       messages = (
         select coalesce(jsonb_agg(x.m order by x.ord), '[]'::jsonb)
         from (
           select t.m, t.ord
           from jsonb_array_elements(public.dm_pending.messages || jsonb_build_array($5::jsonb)) with ordinality as t(m, ord)
           order by t.ord desc
           limit ${MAX_MESSAGES}
         ) x
       ),
       last_message_at = greatest(public.dm_pending.last_message_at, excluded.last_message_at),
       username = coalesce(excluded.username, public.dm_pending.username),
       updated_at = now()
     where not (public.dm_pending.messages @> jsonb_build_array(jsonb_build_object('eventId', $7::text)))`,
    [input.accountId, input.contactId, input.instagramUserId, input.username ?? null, JSON.stringify(message), input.em, input.eventId],
  );
}

type Scope = { accountId?: string | null; id?: string | null };

/**
 * Põe em dia o que mudou sozinho desde a última vez:
 * - "aguardando" cujo contato passou de 24 h sem falar vira "expirada";
 * - "na_fila" acompanha o envio na fila: enviado -> "enviada"; falhou ou foi pulado -> "nao_enviada" com a frase em português.
 */
export async function refreshPending(scope: Scope = {}) {
  const params = [scope.accountId ?? null, scope.id ?? null];
  await query(
    `update public.dm_pending d
     set status = 'expirada', status_note = $3, updated_at = now()
     from public.contacts c
     where d.contact_id = c.id and d.status = 'aguardando'
       and (c.last_response_at is null or c.last_response_at < now() - interval '24 hours')
       and ($1::uuid is null or d.account_id = $1) and ($2::uuid is null or d.id = $2)`,
    [...params, NOTE_WINDOW_EXPIRED],
  );

  // Quem pediu para não receber mais mensagens não recebe a resposta aprovada.
  await query(
    `update public.dm_pending d
     set status = 'descartada', status_note = $3, updated_at = now()
     from public.contacts c
     where d.contact_id = c.id and d.status = 'aguardando' and c.opted_out_at is not null
       and ($1::uuid is null or d.account_id = $1) and ($2::uuid is null or d.id = $2)`,
    [...params, NOTE_OPTED_OUT],
  );

  // Linha "na_fila" ainda sem job (o servidor caiu entre uma coisa e outra) só é dada como perdida depois de 2 minutos.
  await query(
    `with n as (
       select dp.id as dm_id,
              case when q.id is null or q.status in ('failed', 'skipped') then 'nao_enviada'
                   when q.status = 'sent' then 'enviada'
                   else 'na_fila' end as new_status,
              case when q.id is null then $3::text
                   when q.status in ('failed', 'skipped') then
                     case when q.last_error = '24h window expired' then $4::text
                          when q.last_error = 'Contato pausado para atendimento humano' then $5::text
                          else coalesce(nullif(q.last_error, ''), $6::text) end
                   when q.status = 'pending' and q.last_error like 'Limite de %' then q.last_error
                   else null end as new_note
       from public.dm_pending dp
       left join public.queue q on q.id = dp.queue_id
       where dp.status = 'na_fila'
         and (dp.queue_id is not null or dp.updated_at < now() - interval '2 minutes')
         and ($1::uuid is null or dp.account_id = $1) and ($2::uuid is null or dp.id = $2)
     )
     update public.dm_pending d
     set status = n.new_status, status_note = n.new_note, updated_at = now()
     from n
     where d.id = n.dm_id and d.status = 'na_fila'
       and (n.new_status <> d.status or n.new_note is distinct from d.status_note)`,
    [...params, NOTE_LOST_FROM_QUEUE, NOTE_WINDOW_EXPIRED, NOTE_HUMAN_PAUSE, NOTE_COULD_NOT_SEND],
  );
}

export type PendingConversationLine = { de: "pessoa" | "perfil"; texto: string; em: string };

export type PendingItem = {
  id: string;
  accountId: string | null;
  username: string | null;
  instagramUserId: string;
  mensagens: { texto: string; em: string }[];
  ultimaEm: string;
  prazoAte: string | null;
  status: PendingStatus;
  resposta: string | null;
  nota: string | null;
  /** O rascunho que o Molde preparou e espera o «Mandar» (0008); null sem rascunho. */
  rascunho: string | null;
  conversa: PendingConversationLine[];
};

type PendingRow = {
  id: string;
  account_id: string | null;
  contact_id: string | null;
  username: string | null;
  instagram_user_id: string;
  messages: PendingMessage[];
  last_message_at: Date;
  status: PendingStatus;
  reply_text: string | null;
  status_note: string | null;
  last_response_at: Date | null;
};

/**
 * Os "aguardando" e os que mudaram nas últimas 48 h (ou só o item `id`, seja qual for o estado), cada um com a conversa
 * recente (os 6 últimos textos trocados com a pessoa: o que ela mandou e o que o perfil enviou).
 */
export async function listPending(scope: Scope = {}): Promise<PendingItem[]> {
  const { rows } = await query<PendingRow>(
    `select d.id, d.account_id, d.contact_id, coalesce(c.instagram_username, d.username) as username, d.instagram_user_id,
            d.messages, d.last_message_at, d.status, d.reply_text, d.status_note, c.last_response_at
     from public.dm_pending d
     left join public.contacts c on c.id = d.contact_id
     where ($1::uuid is null or d.account_id = $1)
       and ($2::uuid is null or d.id = $2)
       and ($2::uuid is not null or d.status = 'aguardando' or d.updated_at >= now() - interval '48 hours')
     order by (d.status = 'aguardando') desc, d.last_message_at desc
     limit 200`,
    [scope.accountId ?? null, scope.id ?? null],
  );
  if (!rows.length) return [];

  const { rows: lines } = await query<{ dm_id: string; de: "pessoa" | "perfil"; texto: string; em: Date }>(
    `select d.id as dm_id, x.de, x.texto, x.em
     from public.dm_pending d
     cross join lateral (
       select t.de, t.texto, t.em
       from (
         select 'pessoa'::text as de, e.payload #>> '{event,message,text}' as texto, e.received_at as em
         from public.events e
         where e.account_id = d.account_id and e.instagram_user_id = d.instagram_user_id
           and e.event_type in ('message', 'story_reply')
         union all
         select 'perfil'::text, q.payload ->> 'text', coalesce(q.sent_at, q.created_at)
         from public.queue q
         where q.contact_id = d.contact_id and q.status = 'sent' and q.send_type = 'dm'
       ) t
       where t.texto is not null and t.texto <> ''
       order by t.em desc
       limit 6
     ) x
     where d.id = any($1::uuid[])`,
    [rows.map((row) => row.id)],
  );
  const drafts = await draftsFor(rows.map((row) => row.id));
  const conversation = new Map<string, PendingConversationLine[]>();
  for (const line of lines) {
    const list = conversation.get(line.dm_id) ?? [];
    list.push({ de: line.de, texto: line.texto, em: line.em.toISOString() });
    conversation.set(line.dm_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    username: row.username,
    instagramUserId: row.instagram_user_id,
    mensagens: (row.messages ?? []).map((message) => ({ texto: message.texto, em: message.em })),
    ultimaEm: row.last_message_at.toISOString(),
    prazoAte: row.last_response_at ? new Date(row.last_response_at.getTime() + (24 * 60 - DEADLINE_MARGIN_MINUTES) * 60_000).toISOString() : null,
    status: row.status,
    resposta: row.reply_text,
    nota: row.status_note,
    rascunho: row.status === "aguardando" ? drafts.get(row.id) ?? null : null,
    conversa: (conversation.get(row.id) ?? []).sort((a, b) => a.em.localeCompare(b.em)),
  }));
}

export type ReplyOutcome = "ok" | "not-found" | "closed" | "expired" | "opted-out";

/**
 * Coloca a resposta aprovada na fila normal de envios. O texto vai como a dona aprovou (`literal`: sem trocar {{marcações}}).
 * Não liga a pausa de atendimento humano. A fila decide o resto (limite por hora, prazo de 24 h, conta pausada).
 */
export async function queueReply(id: string, texto: string): Promise<ReplyOutcome> {
  const { rows } = await query<PendingRow & { expired: boolean; opted_out: boolean }>(
    `select d.id, d.account_id, d.contact_id, d.instagram_user_id, d.messages, d.status,
            (c.last_response_at is null or c.last_response_at < now() - interval '24 hours') as expired,
            (c.opted_out_at is not null) as opted_out
     from public.dm_pending d
     left join public.contacts c on c.id = d.contact_id
     where d.id = $1`,
    [id],
  );
  const item = rows[0];
  if (!item) return "not-found";
  if (item.status !== "aguardando") return "closed";
  if (item.opted_out) {
    await query("update public.dm_pending set status = 'descartada', status_note = $2, updated_at = now() where id = $1 and status = 'aguardando'", [id, NOTE_OPTED_OUT]);
    return "opted-out";
  }
  if (item.expired) {
    await query("update public.dm_pending set status = 'expirada', status_note = $2, updated_at = now() where id = $1 and status = 'aguardando'", [id, NOTE_WINDOW_EXPIRED]);
    return "expired";
  }

  // Reserva o item antes de enfileirar: dois "enviar" ao mesmo tempo não mandam duas respostas.
  const claimed = await query(
    "update public.dm_pending set status = 'na_fila', reply_text = $2, status_note = null, updated_at = now() where id = $1 and status = 'aguardando'",
    [id, texto],
  );
  if (!claimed.rowCount) return "closed";

  try {
    const lastEventId = item.messages.at(-1)?.eventId;
    const queueId = await enqueueJob({
      sendType: "dm",
      accountId: item.account_id,
      contactId: item.contact_id,
      eventId: typeof lastEventId === "string" ? lastEventId : null,
      instagramRecipientId: item.instagram_user_id,
      availableAt: new Date(),
      payload: { text: texto, origem: "molde_ia", literal: true },
    });
    if (!queueId) throw new Error("A fila não aceitou a resposta.");
    await query("update public.dm_pending set queue_id = $2, updated_at = now() where id = $1", [id, queueId]);
  } catch (error) {
    await releaseClaim(id);
    throw error;
  }
  return "ok";
}

/** A resposta não chegou à fila: volta a "aguardando" para a dona tentar de novo (ou, se a pessoa já mandou outra mensagem, fecha). */
async function releaseClaim(id: string) {
  try {
    await query("update public.dm_pending set status = 'aguardando', reply_text = null, updated_at = now() where id = $1 and status = 'na_fila' and queue_id is null", [id]);
  } catch (error) {
    // Já existe outra linha "aguardando" desta pessoa (chegou mensagem nova no meio): esta fica como não enviada.
    if ((error as { code?: string }).code !== "23505") throw error;
    await query("update public.dm_pending set status = 'nao_enviada', status_note = $2, updated_at = now() where id = $1 and status = 'na_fila' and queue_id is null", [id, NOTE_NOT_QUEUED]);
  }
}

export async function discardPending(id: string): Promise<"ok" | "not-found" | "closed"> {
  const done = await query("update public.dm_pending set status = 'descartada', updated_at = now() where id = $1 and status = 'aguardando'", [id]);
  if (done.rowCount) return "ok";
  const { rows } = await query("select 1 from public.dm_pending where id = $1", [id]);
  return rows.length ? "closed" : "not-found";
}

/**
 * O contato pediu para sair ("parar"). Nunca lança.
 * 1. A resposta do Molde que a dona já aprovou e ainda espera na fila (job "pending" com origem molde_ia) não sai mais:
 *    vira "skipped" com a frase. Isso funciona mesmo sem a 0006 (a fila é de antes dela).
 * 2. Os itens "aguardando" viram "descartada" e os "na_fila" cuja resposta foi segurada viram "nao_enviada", com a frase.
 * A confirmação de saída (automação de "parar") não é do Molde: continua saindo. Sem a 0006 a parte 2 é pulada em silêncio.
 */
export async function closePendingForOptOutSafely(contactId: string) {
  let heldJobs: string[] = [];
  try {
    const { rows } = await query<{ id: string }>(
      `update public.queue set status = 'skipped', last_error = $2
       where contact_id = $1 and status = 'pending' and payload ->> 'origem' = 'molde_ia'
       returning id`,
      [contactId, MOLDE_REPLY_OPTED_OUT],
    );
    heldJobs = rows.map((row) => row.id);
  } catch (error) {
    console.error("[dms] não consegui segurar as respostas na fila de quem pediu para sair:", error instanceof Error ? error.message : error);
  }
  try {
    await query("update public.dm_pending set status = 'descartada', status_note = $2, updated_at = now() where contact_id = $1 and status = 'aguardando'", [contactId, NOTE_OPTED_OUT]);
    if (heldJobs.length) {
      await query(
        "update public.dm_pending set status = 'nao_enviada', status_note = $3, updated_at = now() where contact_id = $1 and status = 'na_fila' and queue_id = any($2::uuid[])",
        [contactId, heldJobs, NOTE_OPTED_OUT],
      );
    }
  } catch (error) {
    if (!isMissingTables(error)) console.error("[dms] não consegui fechar as mensagens de quem pediu para sair:", error instanceof Error ? error.message : error);
  }
}

let lastCleanup = 0;

/** Só para os testes: libera a próxima limpeza. */
export function resetCleanupThrottle() {
  lastCleanup = 0;
}

/**
 * Apaga as linhas fechadas (enviada, nao_enviada, expirada, descartada) e as "na_fila" (ninguém mais acompanhou o envio) sem
 * mudança há mais de 90 dias, e as "aguardando" paradas há mais de 90 dias (o prazo de 24 h passou há muito). No máximo 500 por rodada e uma vez a cada 6 h por processo: barato de chamar no drain.
 * Nunca lança; sem a 0006 não faz nada. Devolve quantas apagou (ou 0 se não era a hora).
 */
export async function cleanupOldPending(options: { force?: boolean } = {}): Promise<number> {
  const now = Date.now();
  if (!options.force && now - lastCleanup < CLEANUP_EVERY_MS) return 0;
  lastCleanup = now;
  try {
    const done = await query(
      `delete from public.dm_pending
       where id in (
         select id from public.dm_pending
         where (status <> 'aguardando' and updated_at < now() - make_interval(days => $1))
            or (status = 'aguardando' and last_message_at < now() - make_interval(days => $1))
         limit ${CLEANUP_BATCH}
       )`,
      [KEEP_DAYS],
    );
    return done.rowCount ?? 0;
  } catch (error) {
    if (!isMissingTables(error)) console.error("[dms] não consegui limpar as mensagens antigas:", error instanceof Error ? error.message : error);
    return 0;
  }
}

// ---------- Rascunho de resposta (0008): o Molde prepara, a dona toca em «Mandar» na página ou no Telegram ----------

export type DraftRow = {
  id: string;
  account_id: string | null;
  account_username: string | null;
  username: string | null;
  status: PendingStatus;
  messages: PendingMessage[];
  reply_text: string | null;
  draft_text: string | null;
  draft_seq: number;
  draft_at: Date | null;
  telegram_msg_id: string | number | null;
  updated_at: Date;
};

/** Lê a conversa com o rascunho (sem a 0008, lança o erro 42703 da coluna que falta). */
export async function readDraft(id: string): Promise<DraftRow | null> {
  const { rows } = await query<DraftRow>(
    `select d.id, d.account_id, ia.instagram_username as account_username, coalesce(c.instagram_username, d.username) as username,
            d.status, d.messages, d.reply_text, d.draft_text, d.draft_seq, d.draft_at, d.telegram_msg_id, d.updated_at
     from public.dm_pending d
     left join public.contacts c on c.id = d.contact_id
     left join public.instagram_accounts ia on ia.id = d.account_id
     where d.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Guarda o rascunho que o Molde preparou (só para conversa "aguardando"). Cada rascunho novo ganha um número novo
 * (draft_seq): um botão do Telegram de um rascunho anterior não manda o novo.
 */
export async function prepareDraft(id: string, texto: string): Promise<{ ok: true; seq: number } | { ok: false; motivo: "not-found" | "closed" }> {
  const { rows } = await query<{ draft_seq: number }>(
    `update public.dm_pending
     set draft_text = $2, draft_seq = draft_seq + 1, draft_at = now(), telegram_msg_id = null, updated_at = now()
     where id = $1 and status = 'aguardando'
     returning draft_seq`,
    [id, texto],
  );
  if (rows[0]) return { ok: true, seq: rows[0].draft_seq };
  const { rows: exists } = await query("select 1 from public.dm_pending where id = $1", [id]);
  return { ok: false, motivo: exists.length ? "closed" : "not-found" };
}

/** «Não mandar»: tira o rascunho (a conversa continua esperando no Molde). Só se o rascunho ainda for o mesmo. */
export async function clearDraft(id: string, seq: number) {
  const done = await query(
    "update public.dm_pending set draft_text = null, updated_at = now() where id = $1 and draft_seq = $2 and status = 'aguardando' and draft_text is not null",
    [id, seq],
  );
  return (done.rowCount ?? 0) > 0;
}

export async function saveDraftTelegramMessage(id: string, seq: number, messageId: number) {
  await query("update public.dm_pending set telegram_msg_id = $3 where id = $1 and draft_seq = $2", [id, seq, messageId]);
}

/** Rascunhos das conversas pedidas (sem a 0008: nenhum, sem erro). */
export async function draftsFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const { rows } = await query<{ id: string; draft_text: string }>(
      "select id, draft_text from public.dm_pending where id = any($1::uuid[]) and draft_text is not null",
      [ids],
    );
    for (const row of rows) out.set(row.id, row.draft_text);
  } catch (error) {
    if ((error as { code?: string }).code !== "42703") throw error;
  }
  return out;
}
