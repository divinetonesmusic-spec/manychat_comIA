import "./helpers/env.mjs";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/**
 * Fase 6 · Limpeza do banco no relógio: eventos com mais de 90 dias e envios terminados (enviado, falhou, pulado) sem mudança
 * há mais de 30 dias, em lotes de 500, no máximo 1 vez por hora (a hora fica em app_status).
 */
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const cleanup = await import("@/lib/db/cleanup");

after(async () => {
  await db?.close();
});

describe("limpeza do banco (com a 0007)", { skip: semBanco }, () => {
  let conta: string;

  beforeEach(async () => {
    cleanup.resetCleanupMemory();
    await db!.sql("delete from public.app_status where chave = 'limpeza'");
    await db!.sql("delete from public.dm_pending");
    await db!.sql("delete from public.queue");
    await db!.sql("delete from public.events");
    await db!.sql("delete from public.admin_login_attempts");
    await db!.sql("delete from public.contacts");
    await db!.sql("delete from public.instagram_accounts");
    conta = await seedAccount(db!, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
  });

  async function evento(dias: number, quantos = 1) {
    const linhas = await db!.sql<{ id: string }>(
      `insert into public.events (account_id, event_type, instagram_user_id, payload, received_at)
       select $1, 'message', 'u1', '{"event":{"message":{"text":"oi"}}}'::jsonb, now() - make_interval(days => $2::int) - make_interval(secs => g)
       from generate_series(1, $3::int) g returning id`,
      [conta, dias, quantos],
    );
    return linhas.map((linha) => linha.id);
  }

  async function envio(status: string, dias: number, eventId: string | null = null) {
    const [linha] = await db!.sql<{ id: string }>(
      `insert into public.queue (account_id, event_id, send_type, status, instagram_recipient_id, payload, created_at, updated_at)
       values ($1, $2, 'dm', $3, 'dest', '{"text":"oi"}'::jsonb, now() - make_interval(days => $4::int), now() - make_interval(days => $4::int)) returning id`,
      [conta, eventId, status, dias],
    );
    return linha.id;
  }

  const restam = async (tabela: "events" | "queue") => (await db!.sql<{ id: string }>(`select id from public.${tabela}`)).map((linha) => linha.id);

  test("apaga eventos de mais de 90 dias e envios terminados há mais de 30; o resto fica", async () => {
    const [velho] = await evento(100);
    const [novo] = await evento(80);
    const enviadoVelho = await envio("sent", 40);
    const falhouVelho = await envio("failed", 31);
    const puladoVelho = await envio("skipped", 45);
    const enviadoNovo = await envio("sent", 20);
    const pendenteVelho = await envio("pending", 60);
    const enviandoVelho = await envio("sending", 60);
    const ligadoAoVelho = await envio("pending", 1, velho); // envio vivo ligado a um evento velho: fica, só perde o vínculo

    const resultado = await cleanup.cleanupOldRecords({ deadline: Date.now() + 10_000 });
    assert.equal(resultado.ran, true);
    assert.equal(resultado.events, 1);
    assert.equal(resultado.queue, 3);

    assert.deepEqual(await restam("events"), [novo]);
    assert.deepEqual(new Set(await restam("queue")), new Set([enviadoNovo, pendenteVelho, enviandoVelho, ligadoAoVelho]));
    assert.ok(![enviadoVelho, falhouVelho, puladoVelho].some((id) => id === novo));
    const [ligado] = await db!.sql<{ event_id: string | null }>("select event_id from public.queue where id = $1", [ligadoAoVelho]);
    assert.equal(ligado.event_id, null);

    const [status] = await db!.sql<{ valor: Record<string, number> }>("select valor from public.app_status where chave = 'limpeza'");
    assert.deepEqual(status.valor, { eventos: 1, envios: 3, tentativas: 0 });
  });

  test("lotes de 500: 1.200 eventos velhos saem todos se der tempo", async () => {
    await evento(120, 1200);
    const resultado = await cleanup.cleanupOldRecords({ deadline: Date.now() + 10_000 });
    assert.equal(resultado.events, 1200);
    assert.equal((await restam("events")).length, 0);
  });

  test("no máximo 1 vez por hora (vale para todos os servidores: a hora fica no banco)", async () => {
    assert.equal((await cleanup.cleanupOldRecords({ deadline: Date.now() + 10_000 })).ran, true);
    await evento(100);
    assert.deepEqual(await cleanup.cleanupOldRecords({ deadline: Date.now() + 10_000 }), { ran: false, events: 0, queue: 0, loginAttempts: 0, motivo: "cedo" });

    cleanup.resetCleanupMemory(); // outro servidor (ou o mesmo, reiniciado): ainda não passou 1 hora no banco
    assert.equal((await cleanup.cleanupOldRecords({ deadline: Date.now() + 10_000 })).motivo, "cedo");
    assert.equal((await restam("events")).length, 1);

    cleanup.resetCleanupMemory();
    await db!.sql("update public.app_status set atualizado_em = now() - interval '61 minutes' where chave = 'limpeza'");
    const depois = await cleanup.cleanupOldRecords({ deadline: Date.now() + 10_000 });
    assert.equal(depois.ran, true);
    assert.equal(depois.events, 1);
  });

  test("sem tempo no relógio: não começa (nem conta como feita)", async () => {
    await evento(100);
    assert.equal((await cleanup.cleanupOldRecords({ deadline: Date.now() + 200 })).motivo, "sem_tempo");
    assert.equal((await restam("events")).length, 1);
    assert.equal((await cleanup.cleanupOldRecords({ deadline: Date.now() + 10_000 })).ran, true);
  });

  test("tentativas de senha errada com mais de 1 dia saem", async () => {
    await db!.sql("insert into public.admin_login_attempts (ip_hash, attempted_at) values ('a', now() - interval '2 days'), ('b', now() - interval '1 hour')");
    const resultado = await cleanup.cleanupOldRecords({ deadline: Date.now() + 10_000 });
    assert.equal(resultado.loginAttempts, 1);
    assert.deepEqual((await db!.sql<{ ip_hash: string }>("select ip_hash from public.admin_login_attempts")).map((linha) => linha.ip_hash), ["b"]);
  });

  test("DM sem resposta 'na fila' cujo envio velho foi enviado: fica 'enviada' (não vira 'não enviada' por perder o envio)", async () => {
    const [contato] = await db!.sql<{ id: string }>("insert into public.contacts (account_id, instagram_user_id) values ($1, 'u9') returning id", [conta]);
    const enviado = await envio("sent", 40);
    await db!.sql(
      `insert into public.dm_pending (account_id, contact_id, instagram_user_id, status, queue_id, reply_text, updated_at)
       values ($1, $2, 'u9', 'na_fila', $3, 'resposta', now() - interval '40 days')`,
      [conta, contato.id, enviado],
    );
    await cleanup.cleanupOldRecords({ deadline: Date.now() + 10_000 });
    const [dm] = await db!.sql<{ status: string; queue_id: string | null }>("select status, queue_id from public.dm_pending");
    assert.equal(dm.status, "enviada");
    assert.equal(dm.queue_id, null, "o envio velho saiu; o item fica, já fechado");
  });

  test("as buscas da limpeza usam os atalhos da 0007 (sem varrer a tabela inteira)", async () => {
    // Uma conexão só (o "set" vale para ela). Tabelas pequenas fazem o Postgres preferir a varredura; desligada, ele mostra
    // se o atalho serve à busca.
    const conexao = new pg.Client({ connectionString: db!.url });
    await conexao.connect();
    const planos = async (sql: string) => (await conexao.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows.map((linha) => linha["QUERY PLAN"]).join("\n");
    try {
      await conexao.query("set enable_seqscan = off");
      assert.match(await planos("select id from public.queue where status in ('sent', 'failed', 'skipped') and updated_at < now() - interval '30 days' order by updated_at limit 500"), /queue_finished_idx/);
      assert.match(await planos("select id from public.events where received_at < now() - interval '90 days' order by received_at limit 500"), /events_received_idx/);
      assert.match(await planos("select 1 from public.queue where event_id = '00000000-0000-0000-0000-000000000000'"), /queue_event_id_idx/);
    } finally {
      await conexao.end();
    }
  });
});
