import "./helpers/env.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/**
 * Supabase sem a 0018 (até a 0015): nada quebra. As rotas do Molde respondem 503 com a frase da 0018, /a/<slug> não acha o app
 * e o aviso de venda (Hotmart) é gravado como antes, sem mexer em assinatura nenhuma.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
process.env.HOTMART_HOTTOK = "hottok-falso-da-hotmart";
const banco: TestDatabase | null = semBanco ? null : await createTestDatabase({ ate: "0015" });

describe("app por assinatura sem a 0018", { skip: semBanco }, () => {
  after(async () => {
    meta.restore();
    await banco?.close();
  });

  test("as rotas do Molde dizem que falta a 0018; o app não abre; o aviso de venda segue como antes", async () => {
    const apps = await import("@/app/api/molde/apps/route");
    const app = { titulo: "Noites", idioma: "pt-BR", audios: [{ id: "a", titulo: "A" }, { id: "b", titulo: "B" }], dias: Array.from({ length: 30 }, () => ({ titulo: "Noite", fazer: "Toque o áudio.", audio: "a" })), preco: { valor: 19.9, moeda: "BRL", porque: "x" }, lembrete: { texto: "Hora da noite." } };
    const r = await apps.POST(request("/api/molde/apps", { headers: MOLDE, json: { molde: "proj-1", app } }));
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as { codigo: string }).codigo, "falta_0018");
    const lista = await apps.GET(request("/api/molde/apps?molde=proj-1", { headers: MOLDE }));
    assert.equal(lista.status, 503);
    const audio = await import("@/app/a/[slug]/audio/[id]/route");
    assert.equal((await audio.GET(request("/a/noites/audio/a"), routeParams({ slug: "noites", id: "a" }))).status, 404);
    const hotmart = await import("@/app/api/webhooks/hotmart/route");
    const body = JSON.stringify({ event: "PURCHASE_APPROVED", data: { buyer: { email: "x@exemplo.com" }, product: { id: 1 }, purchase: { transaction: "SEM18", price: { value: 10, currency_value: "BRL" } } } });
    const v = await hotmart.POST(new NextRequest(new URL("/api/webhooks/hotmart", "https://uaiflow.teste"), { method: "POST", body, headers: { "content-type": "application/json", "x-hotmart-hottok": "hottok-falso-da-hotmart" } }));
    assert.equal(v.status, 200);
    const vj = (await v.json()) as { resultado: string; app?: string };
    assert.equal(vj.resultado, "nova");
    assert.equal(vj.app, "sem_app");
  });
});
