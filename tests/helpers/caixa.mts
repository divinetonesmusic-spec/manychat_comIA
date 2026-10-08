import type { TestDatabase } from "./db.mjs";

/** A consulta de `listContacts` como era antes da tarefa U1 (referência: a nova tem que dar o mesmo resultado). */
export const LIST_CONTACTS_ANTIGA = `select c.id, c.account_id, ia.instagram_username as account_username,
            c.instagram_user_id, c.instagram_username, c.instagram_name,
            c.instagram_profile_picture_url, c.tags, c.instagram_follower_count,
            c.is_user_follow_business, c.is_business_follow_user, c.follower_checked_at,
            c.first_contact_at, c.last_response_at, c.updated_at,
            c.human_paused_at, c.human_paused_until, c.human_pause_reason,
            a.name as last_automation_name,
            coalesce(ev.event_count, 0)::int as event_count,
            coalesce(q.sent_count, 0)::int as sent_count,
            coalesce(q.pending_count, 0)::int as pending_count,
            coalesce(q.failed_count, 0)::int as failed_count,
            ev.last_event_at, ev.last_event_type, ev.last_event_text,
            q.last_queue_at, q.last_queue_status, q.last_queue_error
     from public.contacts c
     left join public.instagram_accounts ia on ia.id = c.account_id
     left join public.automations a on a.id = c.last_automation_id
     left join lateral (
       select count(*) as event_count,
              max(e.received_at) as last_event_at,
              (array_agg(e.event_type order by e.received_at desc))[1] as last_event_type,
              (array_agg(coalesce(e.payload #>> '{change,value,text}', e.payload #>> '{event,message,text}', e.payload #>> '{event,postback,title}') order by e.received_at desc))[1] as last_event_text
       from public.events e
       where e.account_id is not distinct from c.account_id
         and e.instagram_user_id = c.instagram_user_id
     ) ev on true
     left join lateral (
       select count(*) filter (where q.status = 'sent') as sent_count,
              count(*) filter (where q.status = 'pending') as pending_count,
              count(*) filter (where q.status = 'failed') as failed_count,
              max(q.created_at) as last_queue_at,
              (array_agg(q.status order by q.created_at desc))[1] as last_queue_status,
              (array_agg(q.last_error order by q.created_at desc))[1] as last_queue_error
       from public.queue q
       where q.account_id is not distinct from c.account_id
         and q.contact_id = c.id
     ) q on true
     where ($2::uuid is null or c.account_id = $2)
     order by greatest(coalesce(ev.last_event_at, c.first_contact_at), coalesce(q.last_queue_at, c.first_contact_at), c.updated_at) desc
     limit $1`;

/**
 * Base grande em SQL: 5.000 contatos (o de número 1 é o mais recente), 10 eventos por contato (50.000)
 * e 1 item de fila por contato (5.000). Termina com `analyze`, como o autovacuum faria no Supabase.
 */
export async function semearBaseGrande(db: TestDatabase, accountId: string) {
  await db.sql(
    `insert into public.contacts (account_id, instagram_user_id, instagram_username, first_contact_at, last_response_at, updated_at)
     select $1::uuid, 'u' || g, 'pessoa' || g, now() - interval '90 days', now() - make_interval(secs => g), now() - make_interval(secs => g)
     from generate_series(1, 5000) g`,
    [accountId],
  );
  await db.sql(
    `insert into public.events (account_id, event_type, instagram_event_id, instagram_user_id, instagram_username, payload, received_at)
     select $1::uuid, case when e % 2 = 0 then 'comment' else 'message' end, 'ev' || g || '_' || e, 'u' || g, 'pessoa' || g,
            jsonb_build_object('change', jsonb_build_object('value', jsonb_build_object('text', 'mensagem ' || e || ' de ' || g))),
            now() - make_interval(secs => g) - make_interval(mins => e)
     from generate_series(1, 5000) g, generate_series(1, 10) e`,
    [accountId],
  );
  await db.sql(
    `insert into public.queue (account_id, contact_id, send_type, status, instagram_recipient_id, payload, sent_at, created_at)
     select c.account_id, c.id, 'dm', case when n % 3 = 0 then 'sent' when n % 3 = 1 then 'pending' else 'failed' end, c.instagram_user_id,
            '{"text":"Aqui está o link"}'::jsonb, case when n % 3 = 0 then c.updated_at end, c.updated_at - interval '30 seconds'
     from (select *, row_number() over (order by instagram_user_id) as n from public.contacts) c`,
  );
  await db.sql("analyze");
}

type Repos = typeof import("@/lib/db/repositories");

/**
 * Base pequena feita com as funções reais do webhook (recordEvent, upsertContact, enqueueJob), na ordem do webhook:
 * evento, contato, fila. Contatos revisitados em ordem embaralhada, para a ordem final não ser a da criação.
 */
export async function semearBasePequena(repos: Repos, accountId: string, contatos = 300) {
  let seed = 12345;
  const aleatorio = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };

  for (let rodada = 0; rodada < 3; rodada += 1) {
    for (let i = 0; i < contatos; i += 1) {
      const numero = rodada === 0 ? i : aleatorio(contatos);
      const userId = `p${numero}`;
      if (rodada === 2 && numero % 4 === 0) continue;
      const eventId = await repos.recordEvent({
        accountId,
        eventType: numero % 2 ? "comment" : "message",
        instagramEventId: `pe-${rodada}-${i}`,
        instagramUserId: userId,
        instagramUsername: `pessoa${numero}`,
        payload: { change: { value: { text: `texto ${rodada} de ${numero}` } } },
      });
      const contactId = await repos.upsertContact({ accountId, instagramUserId: userId, instagramUsername: `pessoa${numero}`, markResponse: numero % 3 === 0 });
      if (numero % 2 === 0) {
        await repos.enqueueJob({
          accountId,
          eventId,
          contactId,
          instagramRecipientId: userId,
          sendType: "dm",
          payload: { text: `Resposta ${rodada}` },
        });
      }
    }
  }
}

/** A busca de eventos da conversa como era antes da onda final ("is not distinct from"): referência de equivalência. */
export const EVENTOS_CONVERSA_ANTIGA = `select id from public.events
  where account_id is not distinct from $1 and instagram_user_id = $2
  order by received_at desc limit 140`;

/**
 * Confere que os eventos da conversa são os mesmos da consulta antiga, para um contato com perfil e para um contato
 * sem perfil (conta nula), e que eventos de outro perfil com o mesmo id do Instagram não entram.
 * Devolve os totais conferidos (com perfil, sem perfil).
 */
export async function conferirConversaIgualAntiga(db: TestDatabase, repos: Repos, accountId: string, outraContaId: string) {
  const totais: number[] = [];
  for (const [conta, userId] of [[accountId, "conv-com-perfil"], [null, "conv-sem-perfil"]] as const) {
    for (let i = 0; i < 3; i += 1) {
      for (const dona of [conta, outraContaId]) {
        await repos.recordEvent({ accountId: dona, eventType: "message", instagramEventId: `${userId}-${dona ?? "nulo"}-${i}`, instagramUserId: userId, instagramUsername: userId, payload: { event: { message: { text: `${userId} ${dona ?? "nulo"} ${i}` } } } });
      }
    }
    // Contato sem perfil só existe por SQL (o webhook sempre usa o perfil padrão).
    const contactId = conta
      ? await repos.upsertContact({ accountId: conta, instagramUserId: userId, instagramUsername: userId })
      : (await db.sql<{ id: string }>("insert into public.contacts (account_id, instagram_user_id, instagram_username) values (null, $1, $1) returning id", [userId]))[0].id;
    const antigo = (await db.sql<{ id: string }>(EVENTOS_CONVERSA_ANTIGA, [conta, userId])).map((linha) => linha.id);
    const { messages } = await repos.getInboxConversation(contactId, conta);
    const novo = messages.filter((mensagem) => mensagem.direction === "inbound").map((mensagem) => mensagem.id);
    totais.push(novo.length);
    if (novo.length !== 3 || JSON.stringify(novo) !== JSON.stringify(antigo)) {
      throw new Error(`conversa de ${userId} diferente da consulta antiga: novo=${JSON.stringify(novo)} antigo=${JSON.stringify(antigo)}`);
    }
  }
  return totais;
}
