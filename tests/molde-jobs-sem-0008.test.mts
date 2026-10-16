import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Supabase em que a 0008 ainda não foi colada: as rotas novas dizem o que falta e o resto (relógio, relatório, DMs) segue. */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const FRASE = "Falta colar a atualização 0008 no Supabase (veja docs/ATUALIZACAO_0008.md).";
const SEGREDO = "segredo-falso-do-webhook-do-telegram-0123";

describe("Fase 9 sem a migração 0008", { skip: semBanco }, () => {
  let db: TestDatabase;
  let jobsRoute: typeof import("@/app/api/molde/jobs/route");
  let claimRoute: typeof import("@/app/api/molde/jobs/claim/route");
  let acaoRoute: typeof import("@/app/api/molde/jobs/[id]/[acao]/route");
  let jobRoute: typeof import("@/app/api/molde/jobs/[id]/route");
  let dmsRoute: typeof import("@/app/api/molde/dms/route");
  let dmRoute: typeof import("@/app/api/molde/dms/[id]/route");
  let webhookRoute: typeof import("@/app/api/telegram/webhook/route");
  let relogio: typeof import("@/lib/molde/relogio");
  let callbackData: typeof import("@/lib/telegram/callback-data");
  let conta: string;

  before(async () => {
    db = await createTestDatabase({ ate: "0007" });
    jobsRoute = await import("@/app/api/molde/jobs/route");
    claimRoute = await import("@/app/api/molde/jobs/claim/route");
    acaoRoute = await import("@/app/api/molde/jobs/[id]/[acao]/route");
    jobRoute = await import("@/app/api/molde/jobs/[id]/route");
    dmsRoute = await import("@/app/api/molde/dms/route");
    dmRoute = await import("@/app/api/molde/dms/[id]/route");
    webhookRoute = await import("@/app/api/telegram/webhook/route");
    relogio = await import("@/lib/molde/relogio");
    callbackData = await import("@/lib/telegram/callback-data");
    conta = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
  });

  beforeEach(() => {
    meta.reset();
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    process.env.TELEGRAM_CHAT_ID = "42";
    process.env.TELEGRAM_WEBHOOK_SECRET = SEGREDO;
  });

  after(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    meta.restore();
    await db?.close();
  });

  test("o banco de teste está mesmo sem a tabela nova", async () => {
    assert.equal((await db.sql("select 1 from pg_class where relname = 'molde_jobs'")).length, 0);
  });

  test("as rotas /api/molde/jobs respondem 503 com a frase de falta", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const respostas = await Promise.all([
      jobsRoute.POST(request("/api/molde/jobs", { method: "POST", json: { tipo: "reel_pipeline", ref: "a" }, headers: MOLDE })),
      jobsRoute.GET(request("/api/molde/jobs", { headers: MOLDE })),
      claimRoute.POST(request("/api/molde/jobs/claim", { method: "POST", json: { worker: "Mac", tipos: ["reel_pipeline"] }, headers: MOLDE })),
      jobRoute.GET(request(`/api/molde/jobs/${id}`, { headers: MOLDE }), routeParams({ id })),
      acaoRoute.POST(request(`/api/molde/jobs/${id}/batimento`, { method: "POST", json: { worker: "Mac" }, headers: MOLDE }), routeParams({ id, acao: "batimento" })),
      acaoRoute.POST(request(`/api/molde/jobs/${id}/cancelar`, { method: "POST", json: {}, headers: MOLDE }), routeParams({ id, acao: "cancelar" })),
    ]);
    for (const response of respostas) {
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, FRASE);
    }
  });

  test("o relógio do Molde não quebra (sem_migracao) e o relatório de domingo sai sem a parte dos gastos", async () => {
    const resultado = await relogio.runMoldeClock({ deadline: Date.now() + 8000, now: new Date("2026-10-18T12:00:00Z") });
    assert.equal(resultado.motivo, "sem_migracao");
    assert.equal(resultado.relatorio.sent, true);
    const texto = String(meta.telegram.at(-1)?.body.text);
    assert.match(texto, /resumo da semana/);
    assert.doesNotMatch(texto, /Gastos do Molde/);
  });

  test("as DMs do Molde continuam (sem rascunho); preparar responde a frase de falta da 0008", async () => {
    const [contato] = await db.sql<{ id: string }>(
      "insert into public.contacts (account_id, instagram_user_id, last_response_at) values ($1, 'p1', now()) returning id",
      [conta],
    );
    const [dm] = await db.sql<{ id: string }>(
      "insert into public.dm_pending (account_id, contact_id, instagram_user_id, messages) values ($1, $2, 'p1', '[]'::jsonb) returning id",
      [conta, contato.id],
    );
    const lista = await dmsRoute.GET(request("/api/molde/dms", { headers: MOLDE }));
    assert.equal(lista.status, 200);
    assert.equal((await lista.json()).data[0].rascunho, null);
    const preparar = await dmRoute.POST(request(`/api/molde/dms/${dm.id}`, { method: "POST", json: { acao: "preparar", texto: "Oi" }, headers: MOLDE }), routeParams({ id: dm.id }));
    assert.equal(preparar.status, 503);
    assert.equal((await preparar.json()).error, FRASE);
  });

  test("toque num botão de trabalho sem a 0008: responde o toque com a frase de falta, sem erro 500", async () => {
    const data = callbackData.signCallback({ kind: "j", action: "a", id: "00000000-0000-4000-8000-000000000001", version: 1 }) as string;
    const response = await webhookRoute.POST(request("/api/telegram/webhook", {
      method: "POST",
      json: { update_id: 1, callback_query: { id: "cb", data, message: { message_id: 1, chat: { id: 42 } } } },
      headers: { "x-telegram-bot-api-secret-token": SEGREDO },
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).acao, "sem_migracao");
    assert.match(String(meta.telegramApi.find((c) => c.method === "answerCallbackQuery")?.body.text), /0008/);
  });
  test("a 0008 colada 2 vezes não dá erro nem muda dado; sem a 0006, a parte das DMs é pulada", async () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase", "migrations", "0008_fase9.sql"), "utf8");
    const urlDoApp = process.env.DATABASE_URL;
    const extra = await createTestDatabase({ ate: "0005" });
    process.env.DATABASE_URL = urlDoApp;
    try {
      await extra.sql(sql);
      await extra.sql(sql);
      assert.equal((await extra.sql("select 1 from pg_class where relname = 'molde_jobs'")).length, 1);
    } finally {
      await extra.close();
    }
    await db.sql(sql);
    await db.sql("insert into public.molde_jobs (projeto, tipo, ref, custo_estimado_usd) values ('p', 'narrar', 'r1', 1.5)");
    await db.sql(sql);
    const [job] = await db.sql<{ custo_estimado_usd: string }>("select custo_estimado_usd from public.molde_jobs");
    assert.equal(Number(job.custo_estimado_usd), 1.5);
    assert.equal((await db.sql("select 1 from information_schema.columns where table_name = 'dm_pending' and column_name = 'draft_seq'")).length, 1);
  });

});
