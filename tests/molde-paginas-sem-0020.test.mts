import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/**
 * Supabase sem a 0020: as rotas das páginas dizem «Falta colar a atualização 0020» (503, codigo falta_0020), /v/<nome>
 * responde «Página não encontrada» e a fila + o Telegram continuam como na v135 (sem a mensagem de progresso).
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };

describe("v137 · sem a migração 0020", { skip: semBanco }, () => {
  let db: TestDatabase;
  let rota: typeof import("@/app/api/molde/paginas/route");
  let rotaId: typeof import("@/app/api/molde/paginas/[id]/route");
  let publica: typeof import("@/app/v/[slug]/route");
  let filaRoute: typeof import("@/app/api/molde/fila/route");

  before(async () => {
    db = await createTestDatabase({ ate: "0019" });
    rota = await import("@/app/api/molde/paginas/route");
    rotaId = await import("@/app/api/molde/paginas/[id]/route");
    publica = await import("@/app/v/[slug]/route");
    filaRoute = await import("@/app/api/molde/fila/route");
  });

  beforeEach(() => {
    meta.reset();
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    process.env.TELEGRAM_CHAT_ID = "42";
  });

  after(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    meta.restore();
    await db?.close();
  });

  test("o banco de teste está mesmo sem a tabela nova", async () => {
    assert.equal((await db.sql("select to_regclass('public.molde_paginas') as t"))[0].t, null);
  });

  test("as rotas das páginas dizem o que falta; /v responde 404 em português", async () => {
    const r = await rota.POST(request("/api/molde/paginas", { method: "POST", headers: MOLDE, json: { titulo: "x", html: "<p>x</p>", molde: "birdie" } }));
    assert.equal(r.status, 503);
    const e = await r.json();
    assert.equal(e.codigo, "falta_0020");
    assert.match(e.error, /Falta colar a atualização 0020/);
    assert.equal((await rota.GET(request("/api/molde/paginas?molde=birdie", { headers: MOLDE }))).status, 503);
    const id = "2b6c0d6e-8a51-4c41-9a39-7c1d1c1b0f10";
    assert.equal((await rotaId.DELETE(request(`/api/molde/paginas/${id}`, { method: "DELETE", headers: MOLDE }), routeParams({ id }))).status, 503);
    const v = await publica.GET(request("/v/qualquer"), routeParams({ slug: "qualquer" }));
    assert.equal(v.status, 404);
    assert.match(await v.text(), /Página não encontrada/);
  });

  test("a fila e o Telegram seguem iguais: espelho de vídeo grava, e só a aprovação sai (sem progresso)", async () => {
    const r = await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { itens: [
      { ref: "pedido:p1", tipo: "reel_final", estado: "produzindo", projeto: "birdie", titulo: "Vídeo final · Oração", grupo: "cal-1", passos: 6 },
      { ref: "pedido:p2", tipo: "reel_final", estado: "para_aprovar", projeto: "birdie", titulo: "Vídeo final · Outra", previa: { texto: "ok" } },
    ] } }));
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.telegram, 1);
    assert.equal(corpo.progresso, 0);
    assert.equal(meta.telegram.length, 1);
  });
});
