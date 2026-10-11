import "./helpers/env.mjs";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Fase 6 · Só um relógio (/api/queue/drain) por vez: o segundo sai na hora, com sucesso, sem mandar nada. */
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const WORKER = { "x-worker-secret": process.env.WORKER_SECRET as string };

after(async () => {
  meta.restore();
  await db?.close();
});

describe("relógio único", { skip: semBanco }, () => {
  let conta: string;
  let seq = 0;

  beforeEach(async () => {
    meta.reset();
    await db!.sql("delete from public.queue");
    await db!.sql("delete from public.contacts");
    await db!.sql("delete from public.instagram_accounts");
    conta = await seedAccount(db!, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
  });

  async function pendentes(quantos: number) {
    for (let i = 0; i < quantos; i += 1) {
      seq += 1;
      const [c] = await db!.sql<{ id: string }>(
        "insert into public.contacts (account_id, instagram_user_id, instagram_username, last_response_at) values ($1, $2, $3, now()) returning id",
        [conta, `u${seq}`, `pessoa${seq}`],
      );
      await db!.sql(
        "insert into public.queue (account_id, contact_id, send_type, status, instagram_recipient_id, payload) values ($1, $2, 'dm', 'pending', $3, '{\"text\":\"oi\"}'::jsonb)",
        [conta, c.id, `dest-${seq}`],
      );
    }
  }

  test("dois relógios ao mesmo tempo: um trabalha, o outro sai na hora com sucesso; cada DM sai uma vez só", async () => {
    await pendentes(4);
    const route = await import("@/app/api/queue/drain/route");
    const [a, b] = await Promise.all([
      route.POST(request("/api/queue/drain", { method: "POST", headers: WORKER })),
      route.POST(request("/api/queue/drain", { method: "POST", headers: WORKER })),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const corpos = [await a.json(), await b.json()];
    const pulados = corpos.filter((corpo) => corpo.skipped === true);
    assert.equal(pulados.length, 1, JSON.stringify(corpos));
    assert.equal(pulados[0].ok, true);
    assert.match(pulados[0].motivo, /Outro relógio já está rodando/);
    const trabalhou = corpos.find((corpo) => !corpo.skipped);
    assert.equal(trabalhou.sent, 4);

    assert.equal(meta.count("/messages", "POST"), 4, "4 DMs, nenhuma em dobro");
    const fila = await db!.sql<{ status: string }>("select status from public.queue");
    assert.deepEqual(fila.map((linha) => linha.status), ["sent", "sent", "sent", "sent"]);
  });

  test("com a trava presa por outro (relógio ainda rodando), o relógio não manda nada; solta a trava e ele volta a mandar", async () => {
    await pendentes(2);
    const { DRAIN_LOCK_KEY } = await import("@/lib/queue/drain-lock");
    const outro = new pg.Client({ connectionString: db!.url });
    await outro.connect();
    try {
      await outro.query("begin");
      await outro.query("select pg_advisory_xact_lock($1)", [DRAIN_LOCK_KEY]);
      const route = await import("@/app/api/queue/drain/route");
      const corpo = await (await route.GET(request("/api/queue/drain", { headers: WORKER }))).json();
      assert.equal(corpo.skipped, true);
      assert.equal(meta.count("/messages", "POST"), 0);
      await outro.query("commit");
      const depois = await (await route.GET(request("/api/queue/drain", { headers: WORKER }))).json();
      assert.equal(depois.skipped, undefined);
      assert.equal(depois.sent, 2);
    } finally {
      await outro.end();
    }
  });

  test("trava presa: os relógios saem sem trabalhar e, sem batimento há 15 min, o /api/health diz que é a trava", async () => {
    const { DRAIN_LOCK_KEY } = await import("@/lib/queue/drain-lock");
    const { readHealth } = await import("@/lib/health");
    await db!.sql("delete from public.app_status where chave in ('relogio', 'relogio_pulado')");
    await db!.sql("insert into public.app_status (chave, valor, atualizado_em) values ('relogio', '{}'::jsonb, now() - interval '20 minutes')");
    const outro = new pg.Client({ connectionString: db!.url });
    await outro.connect();
    try {
      await outro.query("begin");
      await outro.query("select pg_advisory_xact_lock($1)", [DRAIN_LOCK_KEY]);
      const route = await import("@/app/api/queue/drain/route");
      for (let vez = 0; vez < 3; vez += 1) assert.equal((await (await route.GET(request("/api/queue/drain", { headers: WORKER }))).json()).skipped, true);
      const [pulado] = await db!.sql<{ valor: { seguidas: number } }>("select valor from public.app_status where chave = 'relogio_pulado'");
      assert.equal(pulado.valor.seguidas, 3);
      const saude = await readHealth();
      assert.equal(saude.ok, false);
      assert.match(saude.motivo ?? "", /está sendo chamado, mas não trabalha há 20 minutos: saiu 3 vezes seguidas/);
      await outro.query("commit");
      await route.GET(request("/api/queue/drain", { headers: WORKER }));
      assert.equal((await readHealth()).ok, true, "a trava soltou: o relógio trabalhou e o batimento voltou");
      await route.GET(request("/api/queue/drain", { headers: WORKER })); // um "pulado" velho não conta depois do batimento
    } finally {
      await outro.end();
    }
  });

  test("a conexão da trava tem prazo: solta sozinha em 30 s parada e nenhum comando passa de 5 s", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/lib/queue/drain-lock.ts", "utf8");
    assert.match(fonte, /client\.query\("begin"\);\s*(\/\/[^\n]*\n\s*)*await client\.query\("set local idle_in_transaction_session_timeout = '30s'"\);\s*await client\.query\("set local statement_timeout = '5s'"\);/);
  });

  test("a trava é solta no fim (também quando o relógio dá erro) e não sobra conexão aberta", async () => {
    const { withDrainLock } = await import("@/lib/queue/drain-lock");
    await assert.rejects(withDrainLock(async () => {
      throw new Error("falha simulada no meio do relógio");
    }), /falha simulada/);
    const de_novo = await withDrainLock(async () => "rodou");
    assert.deepEqual(de_novo, { ran: true, result: "rodou" });
    const travas = await db!.sql("select 1 from pg_locks where locktype = 'advisory' and database = (select oid from pg_database where datname = current_database())");
    assert.equal(travas.length, 0, "nenhuma trava sobrando");
  });

  test("sem conseguir abrir a conexão da trava, o relógio roda como antes (e avisa no log)", async () => {
    const { withDrainLock } = await import("@/lib/queue/drain-lock");
    const original = process.env.DATABASE_URL;
    const avisos: string[] = [];
    const warn = console.warn;
    console.warn = (...partes: unknown[]) => void avisos.push(partes.join(" "));
    process.env.DATABASE_URL = "postgresql://ninguem@127.0.0.1:1/nada?sslmode=disable";
    try {
      assert.deepEqual(await withDrainLock(async () => 42), { ran: true, result: 42 });
    } finally {
      process.env.DATABASE_URL = original;
      console.warn = warn;
    }
    assert.ok(avisos.some((aviso) => aviso.includes("[relogio]")));
  });
});
