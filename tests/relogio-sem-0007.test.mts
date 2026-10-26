import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/**
 * Supabase em que a 0007 ainda não foi colada (a 0006 sim): o relógio segue igual; o aviso de DM no Telegram e a limpeza
 * do banco não fazem nada (e avisam no log uma vez só).
 */
const meta = installFakeMeta();

describe("relógio sem a migração 0007", { skip: semBanco }, () => {
  let db: TestDatabase;
  let route: typeof import("@/app/api/queue/drain/route");

  before(async () => {
    db = await createTestDatabase({ ate: "0006" });
    route = await import("@/app/api/queue/drain/route");
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    // O relatório de domingo (9h de São Paulo) dispararia junto com o relógio aos domingos e mudaria a contagem deste teste;
    // ele tem o seu teste próprio (molde-jobs, com a hora fixa).
    process.env.RELATORIO_SEMANAL = "desligado";
    process.env.TELEGRAM_CHAT_ID = "42";
    const conta = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
    const [contato] = await db.sql<{ id: string }>(
      "insert into public.contacts (account_id, instagram_user_id, last_response_at) values ($1, 'u1', now() - interval '1 hour') returning id",
      [conta],
    );
    await db.sql(
      `insert into public.dm_pending (account_id, contact_id, instagram_user_id, messages, created_at)
       values ($1, $2, 'u1', jsonb_build_array(jsonb_build_object('texto', 'oi', 'em', (now() - interval '1 hour')::text, 'eventId', 'ev1')), now() - interval '1 hour')`,
      [conta, contato.id],
    );
    await db.sql("insert into public.events (account_id, event_type, payload, received_at) values ($1, 'message', '{}'::jsonb, now() - interval '200 days')", [conta]);
    await db.sql("insert into public.queue (account_id, send_type, status, payload, updated_at) values ($1, 'dm', 'sent', '{}'::jsonb, now() - interval '200 days')", [conta]);
  });

  after(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    meta.restore();
    await db?.close();
  });

  test("post com limite de uso da Meta sem a 0007: cada espera gasta uma tentativa; na 3ª vira 'Com erro' (nunca espera para sempre)", async () => {
    const { insertPost, readPost } = await import("./helpers/seed.mjs");
    const scheduler = await import("@/lib/content/scheduler");
    const [{ id: conta }] = await db.sql<{ id: string }>("select id from public.instagram_accounts limit 1");
    const id = await insertPost(db, conta);
    meta.createMediaFailure = { status: 429, error: { message: "Too many calls" } };
    try {
      await scheduler.runContentCycle(8000);
      let post = await readPost(db, id);
      assert.equal(post.status, "scheduled");
      assert.equal(post.attempts, 1);
      await db.sql("update public.content_posts set attempts = 2, scheduled_at = now() - interval '1 minute' where id = $1", [id]);
      await scheduler.runContentCycle(8000);
      post = await readPost(db, id);
      assert.equal(post.status, "failed");
      assert.equal(post.last_error, scheduler.META_LIMIT_POST_GAVE_UP);
    } finally {
      meta.createMediaFailure = null;
      meta.telegram.length = 0;
      await db.sql("delete from public.content_posts");
    }
  });

  test("o banco de teste está mesmo sem a 0007", async () => {
    assert.equal((await db.sql("select 1 from information_schema.columns where table_name = 'dm_pending' and column_name = 'notified_at'")).length, 0);
    assert.equal((await db.sql("select 1 from pg_class where relname = 'queue_finished_idx'")).length, 0);
    assert.equal((await db.sql("select 1 from information_schema.columns where table_name = 'content_posts' and column_name = 'meta_limit_waits'")).length, 0);
  });

  test("o relógio responde 200; nem aviso de DM nem limpeza; nada é apagado; o aviso vai ao log uma vez só", async () => {
    const avisos: string[] = [];
    const erros: string[] = [];
    const warn = console.warn;
    const error = console.error;
    console.warn = (...partes: unknown[]) => void avisos.push(partes.join(" "));
    console.error = (...partes: unknown[]) => void erros.push(partes.join(" "));
    try {
      for (let vez = 0; vez < 2; vez += 1) {
        const response = await route.POST(request("/api/queue/drain", { method: "POST", headers: { "x-worker-secret": process.env.WORKER_SECRET as string } }));
        assert.equal(response.status, 200);
        const corpo = await response.json();
        assert.equal(corpo.ok, true);
        assert.deepEqual(corpo.avisosDm, { sent: 0, skipped: "sem_migracao" });
        if (vez === 0) assert.equal(corpo.limpeza.motivo, "sem_migracao");
      }
    } finally {
      console.warn = warn;
      console.error = error;
    }
    assert.equal(meta.telegram.length, 0);
    assert.equal((await db.sql("select 1 from public.events")).length, 1);
    assert.equal((await db.sql("select 1 from public.queue")).length, 1);
    assert.deepEqual(erros, []);
    assert.equal(avisos.filter((aviso) => aviso.includes("[dms]") && aviso.includes("0007")).length, 1);
    assert.equal(avisos.filter((aviso) => aviso.includes("[limpeza]") && aviso.includes("0007")).length, 1);
  });
});
