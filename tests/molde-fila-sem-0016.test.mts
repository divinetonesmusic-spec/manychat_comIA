import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/** Supabase em que a 0016 ainda não foi colada: a fila diz o que falta, o Telegram responde com a frase e o relógio segue. */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const FRASE = "Falta colar a atualização 0016 no Supabase (veja docs/ATUALIZACAO_0016.md).";
const SEGREDO = "segredo-falso-do-webhook-do-telegram-0123";

describe("v134 · fila única sem a migração 0016", { skip: semBanco }, () => {
  let db: TestDatabase;
  let filaRoute: typeof import("@/app/api/molde/fila/route");
  let acaoRoute: typeof import("@/app/api/molde/fila/[id]/[acao]/route");
  let webhookRoute: typeof import("@/app/api/telegram/webhook/route");
  let relogio: typeof import("@/lib/molde/relogio");

  before(async () => {
    db = await createTestDatabase({ ate: "0015" });
    filaRoute = await import("@/app/api/molde/fila/route");
    acaoRoute = await import("@/app/api/molde/fila/[id]/[acao]/route");
    webhookRoute = await import("@/app/api/telegram/webhook/route");
    relogio = await import("@/lib/molde/relogio");
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
    assert.equal((await db.sql("select 1 from pg_class where relname = 'molde_fila'")).length, 0);
  });

  test("as rotas da fila: 503 com codigo falta_0016 e a frase", async () => {
    const get = await filaRoute.GET(request("/api/molde/fila", { headers: MOLDE }));
    assert.equal(get.status, 503);
    assert.deepEqual(await get.json(), { error: FRASE, codigo: "falta_0016" });
    const post = await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { itens: [{ ref: "pedido:p1", tipo: "fotos", estado: "produzindo" }] } }));
    assert.equal(post.status, 503);
    const id = "2b6c0d6e-8a51-4c41-9a39-7c1d1c1b0f10";
    const acao = await acaoRoute.POST(request(`/api/molde/fila/${id}/aplicada`, { method: "POST", headers: MOLDE, json: { rodada: 1 } }), routeParams({ id, acao: "aplicada" }));
    assert.equal(acao.status, 503);
  });

  test("o Telegram: o comando responde a frase da 0016; o relógio continua", async () => {
    const r = await webhookRoute.POST(request("/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": SEGREDO },
      json: { update_id: 1, message: { message_id: 1, chat: { id: 42 }, from: { id: 7 }, text: "/fotos praia" } },
    }));
    assert.equal((await r.json()).acao, "sem_migracao");
    assert.match(String(meta.telegram.at(-1)?.body.text), /Falta colar a atualização 0016/);
    const clock = await relogio.runMoldeClock({ deadline: Date.now() + 8000, origin: "https://uaiflow.teste" });
    assert.equal(clock.rascunhosApagados, undefined);
  });
});
