import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Saúde do relógio: batimento gravado pelo /api/queue/drain e a rota pública /api/health (migração 0004). */
const meta = installFakeMeta();
const WORKER = { "x-worker-secret": process.env.WORKER_SECRET as string };

describe("saúde do relógio (com a migração 0004)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let drainRoute: typeof import("@/app/api/queue/drain/route");
  let healthRoute: typeof import("@/app/api/health/route");
  let proxy: typeof import("@/proxy").proxy;

  before(async () => {
    db = await createTestDatabase();
    drainRoute = await import("@/app/api/queue/drain/route");
    healthRoute = await import("@/app/api/health/route");
    ({ proxy } = await import("@/proxy"));
  });

  beforeEach(async () => {
    meta.reset();
    await db.sql("delete from public.app_status");
    await db.sql("delete from public.instagram_accounts");
    await seedAccount(db, { username: "ruthie", userId: "1001", token: "IGAA-TESTE-RUTHIE", isDefault: true, expiresInDays: 20 });
    await seedAccount(db, { username: "payoff", userId: "1002", token: "IGAA-TESTE-PAYOFF", isDefault: false, expiresInDays: 50 });
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  test("a 0004 cria public.app_status com RLS ligado e nenhuma política, e pode rodar de novo", async () => {
    const [tabela] = await db.sql<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.app_status'::regclass");
    assert.equal(tabela.relrowsecurity, true);
    const politicas = await db.sql("select 1 from pg_policies where schemaname = 'public' and tablename = 'app_status'");
    assert.equal(politicas.length, 0, "só o servidor acessa");
    const colunas = await db.sql<{ column_name: string; data_type: string; is_nullable: string }>(
      "select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'app_status' order by ordinal_position",
    );
    assert.deepEqual(colunas.map((coluna) => [coluna.column_name, coluna.data_type, coluna.is_nullable]), [
      ["chave", "text", "NO"],
      ["valor", "jsonb", "NO"],
      ["atualizado_em", "timestamp with time zone", "NO"],
    ]);
    await db.sql(readFileSync("supabase/migrations/0004_saude.sql", "utf8"));
  });

  test("cada execução do /api/queue/drain grava o batimento do relógio", async () => {
    const response = await drainRoute.POST(request("/api/queue/drain", { method: "POST", headers: WORKER }));
    assert.equal(response.status, 200);
    const [batimento] = await db.sql<{ chave: string; segundos: number }>(
      "select chave, extract(epoch from now() - atualizado_em)::float as segundos from public.app_status where chave = 'relogio'",
    );
    assert.ok(batimento, "gravou a linha 'relogio'");
    assert.ok(batimento.segundos < 60);

    await db.sql("update public.app_status set atualizado_em = now() - interval '1 hour' where chave = 'relogio'");
    await drainRoute.POST(request("/api/queue/drain", { method: "POST", headers: WORKER }));
    const [depois] = await db.sql<{ segundos: number }>("select extract(epoch from now() - atualizado_em)::float as segundos from public.app_status where chave = 'relogio'");
    assert.ok(depois.segundos < 60, "a execução seguinte atualiza o mesmo batimento");
  });

  test("drain sem o segredo do relógio não grava batimento", async () => {
    const response = await drainRoute.POST(request("/api/queue/drain", { method: "POST" }));
    assert.equal(response.status, 401);
    assert.equal((await db.sql("select 1 from public.app_status")).length, 0);
  });

  test("/api/health com batimento recente: ok, minutos e o menor prazo dos tokens (sem @ nem segredo)", async () => {
    await drainRoute.POST(request("/api/queue/drain", { method: "POST", headers: WORKER }));
    const response = await healthRoute.GET();
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.ok, true);
    assert.equal(body.motivo, undefined);
    assert.equal(body.relogio.minutos, 0);
    assert.ok(Math.abs(new Date(body.relogio.ultimaVez).getTime() - Date.now()) < 60_000);
    assert.ok([19, 20].includes(body.tokens.menorPrazoDias), `menorPrazoDias = ${body.tokens.menorPrazoDias}`);
    assert.deepEqual(Object.keys(body).sort(), ["ok", "relogio", "tokens"]);
    assert.doesNotMatch(text, /ruthie|payoff|IGAA|1001|1002/);
  });

  test("/api/health com batimento de 14 min ainda está ok", async () => {
    await db.sql("insert into public.app_status (chave, atualizado_em) values ('relogio', now() - interval '14 minutes')");
    const response = await healthRoute.GET();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).relogio.minutos, 14);
  });

  test("/api/health com batimento velho (mais de 15 min): 503 e o motivo em português", async () => {
    await db.sql("insert into public.app_status (chave, atualizado_em) values ('relogio', now() - interval '20 minutes')");
    const response = await healthRoute.GET();
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.relogio.minutos, 20);
    assert.match(body.motivo, /O relógio .*não roda há 20 minutos/);
  });

  test("/api/health sem nenhum batimento ainda: 503", async () => {
    const response = await healthRoute.GET();
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.relogio.ultimaVez, null);
    assert.match(body.motivo, /ainda não rodou/);
  });

  test("/api/health é pública (o proxy deixa passar sem login)", async () => {
    const response = await proxy(request("/api/health"));
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
});
