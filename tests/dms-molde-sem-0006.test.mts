import "./helpers/env.mjs";
import { comAfter } from "./helpers/escopo-next.mjs";
import { createHmac } from "node:crypto";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { BASE_URL, request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Supabase em que a 0006 ainda não foi colada (sem a tabela dm_pending): o webhook segue igual; as rotas do Molde avisam. */
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const FRASE = "Falta colar a atualização 0006 no Supabase (veja docs/ATUALIZACAO_0006.md).";

describe("DMs sem resposta sem a migração 0006", { skip: semBanco }, () => {
  let db: TestDatabase;
  let webhook: typeof import("@/app/api/webhook/route");
  let listar: typeof import("@/app/api/molde/dms/route");
  let item: typeof import("@/app/api/molde/dms/[id]/route");
  let seq = 0;

  before(async () => {
    db = await createTestDatabase({ ate: "0005" });
    webhook = await import("@/app/api/webhook/route");
    listar = await import("@/app/api/molde/dms/route");
    item = await import("@/app/api/molde/dms/[id]/route");
    await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
  });

  after(async () => {
    await db?.close();
  });

  async function dm(de: string, texto: string) {
    seq += 1;
    const corpo = JSON.stringify({ object: "instagram", entry: [{ id: "1001", time: Date.now(), messaging: [{ sender: { id: de, username: `user_${de}` }, recipient: { id: "1001" }, timestamp: Date.now(), message: { mid: `mid-${seq}`, text: texto } }] }] });
    const assinatura = `sha256=${createHmac("sha256", process.env.INSTAGRAM_APP_SECRET as string).update(corpo).digest("hex")}`;
    const pedido = new NextRequest(new URL("/api/webhook", BASE_URL), { method: "POST", body: corpo, headers: { "x-hub-signature-256": assinatura, "content-type": "application/json" } });
    return comAfter(() => webhook.POST(pedido));
  }

  test("o banco de teste está mesmo sem a tabela nova", async () => {
    assert.equal((await db.sql("select 1 from pg_class where relname = 'dm_pending'")).length, 0);
  });

  test("webhook com DM sem resposta: 200, o evento é guardado, nada quebra e o aviso vai ao log uma vez só", async () => {
    const avisos: string[] = [];
    const erros: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...partes: unknown[]) => void avisos.push(partes.join(" "));
    console.error = (...partes: unknown[]) => void erros.push(partes.join(" "));
    try {
      const primeira = await dm("pessoa1", "Oi, tem alguém aí?");
      assert.equal(primeira.status, 200);
      assert.equal((await primeira.json()).ok, true);
      assert.equal((await dm("pessoa1", "olá?")).status, 200);
      assert.equal((await dm("pessoa2", "bom dia")).status, 200);
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
    assert.equal((await db.sql("select 1 from public.events where event_type = 'message'")).length, 3, "o resto do webhook continua gravando");
    assert.equal((await db.sql("select 1 from public.contacts")).length, 2);
    assert.deepEqual(erros, [], "nenhum erro no log");
    const doDm = avisos.filter((aviso) => aviso.includes("[dms]"));
    assert.equal(doDm.length, 1, "o aviso aparece uma vez por processo");
    assert.match(doDm[0], /0006/);
  });

  test("'parar' sem a 0006: 200, sem erro no log; a resposta do Molde na fila é segurada e a confirmação de saída entra", async () => {
    const repos = await import("@/lib/db/repositories");
    assert.equal((await dm("pessoa3", "oi")).status, 200);
    const [contato] = await db.sql<{ id: string; account_id: string }>("select id, account_id from public.contacts where instagram_user_id = 'pessoa3'");
    const saida = await repos.createAutomation({ account_id: contato.account_id, name: "Saída", triggers: ["dm"], keywords: ["zzz-nunca"], match_type: "contains", welcome_dm: "Pronto, você saiu da lista." });
    await db.sql(
      `insert into public.profile_settings (id, account_id, opt_out_automation_id) values (true, $1, $2)
       on conflict (account_id) do update set opt_out_automation_id = excluded.opt_out_automation_id`,
      [contato.account_id, saida.id],
    );
    // Um job de resposta do Molde (como se tivesse entrado antes) e um de automação, os dois esperando.
    await repos.enqueueJob({ sendType: "dm", accountId: contato.account_id, contactId: contato.id, instagramRecipientId: "pessoa3", payload: { text: "Resposta do Molde", origem: "molde_ia", literal: true } });
    await repos.enqueueJob({ sendType: "dm", accountId: contato.account_id, contactId: contato.id, instagramRecipientId: "pessoa3", payload: { text: "Mensagem de automação" } });

    const erros: string[] = [];
    const originalError = console.error;
    console.error = (...partes: unknown[]) => void erros.push(partes.join(" "));
    try {
      assert.equal((await dm("pessoa3", "parar")).status, 200);
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(erros, [], "nenhum erro no log");
    const fila = await db.sql<{ texto: string; status: string; last_error: string | null }>("select payload ->> 'text' as texto, status, last_error from public.queue order by created_at");
    assert.deepEqual(fila.map((f) => [f.texto, f.status, f.last_error]), [
      ["Resposta do Molde", "skipped", "A pessoa pediu para não receber mensagens."],
      ["Mensagem de automação", "pending", null],
      ["Pronto, você saiu da lista.", "pending", null],
    ]);
    await db.sql("delete from public.queue");
  });

  test("GET /api/molde/dms: 503 com a frase (e sem token, 401)", async () => {
    const resposta = await listar.GET(request("/api/molde/dms", { headers: MOLDE }));
    assert.equal(resposta.status, 503);
    assert.equal((await resposta.json()).error, FRASE);
    assert.equal((await listar.GET(request("/api/molde/dms"))).status, 401);
    assert.equal((await listar.GET(request("/api/molde/dms?accountId=abc", { headers: MOLDE }))).status, 400);
  });

  test("POST /api/molde/dms/<id>: 503 com a frase; a conferência do texto vem antes (400) e sem token é 401", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const enviar = (json: unknown, headers: Record<string, string> = MOLDE) => item.POST(request(`/api/molde/dms/${id}`, { method: "POST", json, headers }), routeParams({ id }));

    const resposta = await enviar({ acao: "enviar", texto: "Oi!" });
    assert.equal(resposta.status, 503);
    assert.equal((await resposta.json()).error, FRASE);
    assert.equal((await (await enviar({ acao: "descartar" })).json()).error, FRASE);
    assert.equal((await enviar({ acao: "enviar", texto: "" })).status, 400);
    assert.equal((await enviar({ acao: "enviar", texto: "Oi!" }, {})).status, 401);
    assert.equal((await db.sql("select 1 from public.queue")).length, 0, "nada foi enfileirado");
  });
});
