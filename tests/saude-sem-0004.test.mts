import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";

/** Supabase em que a 0004 ainda não foi colada (banco só com 0001–0003). */
const meta = installFakeMeta();
const WORKER = { "x-worker-secret": process.env.WORKER_SECRET as string };

describe("saúde do relógio sem a migração 0004", { skip: semBanco }, () => {
  let db: TestDatabase;

  before(async () => {
    db = await createTestDatabase({ ate: "0003" });
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  test("o banco de teste está mesmo sem a tabela app_status", async () => {
    const rows = await db.sql("select 1 from information_schema.tables where table_schema = 'public' and table_name = 'app_status'");
    assert.equal(rows.length, 0);
  });

  test("o /api/queue/drain segue normal (a falha do batimento é ignorada)", async () => {
    const { POST } = await import("@/app/api/queue/drain/route");
    const response = await POST(request("/api/queue/drain", { method: "POST", headers: WORKER }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.content.error, undefined, "o ciclo de conteúdo rodou sem erro");
  });

  test("/api/health responde 503 e diz que falta a migração 0004", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.match(body.motivo, /0004_saude\.sql/);
    assert.deepEqual(body.relogio, { ultimaVez: null, minutos: null });
  });
});
