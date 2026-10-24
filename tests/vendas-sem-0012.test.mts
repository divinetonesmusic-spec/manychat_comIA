import "./helpers/env.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/**
 * Supabase sem a 0012 (só até a 0011): nada quebra. As plataformas novas respondem 503 (a plataforma tenta de novo depois),
 * as de antes continuam gravando, as vendas por post vêm com ref "" e um aviso, o link com origem é criado como antes (com
 * aviso) e o clique do story conta como "outro".
 */
const HOTTOK = "hottok-falso-da-hotmart";
process.env.HOTMART_HOTTOK = HOTTOK;
process.env.STRIPE_WEBHOOK_SECRET = "whsec_segredo-falso-da-stripe";
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };

describe("sem a 0012", { skip: semBanco }, () => {
  let db: TestDatabase;
  after(async () => {
    await db?.close();
  });

  test("tudo segue funcionando, com a frase de falta onde precisa", async () => {
    db = await createTestDatabase({ ate: "0011" });
    const hotmart = await import("@/app/api/webhooks/hotmart/route");
    const stripe = await import("@/app/api/webhooks/stripe/route");
    const lib = await import("@/lib/vendas/webhooks");
    const vendas = await import("@/app/api/molde/vendas/route");
    const links = await import("@/app/api/molde/links/route");
    const redirecionar = await import("@/app/l/[slug]/route");
    const conta = await seedAccount(db);

    const corpo = JSON.stringify({ event: "PURCHASE_APPROVED", data: { product: { id: 1, name: "Ebook" }, purchase: { transaction: "HP1", price: { value: 10, currency_value: "BRL" }, origin: { sck: "mo1abc" } } } });
    const resposta = await hotmart.POST(new NextRequest(new URL("/api/webhooks/hotmart", "https://uaiflow.teste"), { method: "POST", body: corpo, headers: { "content-type": "application/json", "x-hotmart-hottok": HOTTOK } }));
    assert.equal(resposta.status, 503);
    assert.equal(((await resposta.json()) as { codigo: string }).codigo, "falta_0012");

    const sessao = JSON.stringify({ type: "checkout.session.completed", livemode: true, data: { object: { id: "cs_1", amount_total: 1000, currency: "brl", payment_status: "paid", client_reference_id: "mo1abc", created: Math.floor(Date.now() / 1000) } } });
    const st = await stripe.POST(new NextRequest(new URL("/api/webhooks/stripe", "https://uaiflow.teste"), { method: "POST", body: sessao, headers: { "content-type": "application/json", "stripe-signature": lib.signStripe(sessao, process.env.STRIPE_WEBHOOK_SECRET as string) } }));
    assert.equal(st.status, 200, await st.clone().text());

    const lista = await vendas.GET(request(`/api/molde/vendas?refs=x&desde=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}`, { headers: MOLDE }));
    const json = (await lista.json()) as { vendas: Array<{ ref: string; origem: string; plataforma: string }>; aviso: string };
    assert.deepEqual(json.vendas.map((venda) => [venda.plataforma, venda.ref, venda.origem]), [["stripe", "", ""]]);
    assert.match(json.aviso, /0012/);

    const criado = await links.POST(request("/api/molde/links", { headers: MOLDE, json: { accountId: conta, externalRef: "r1", destino: "https://pay.hotmart.com/X", origem: "mo1abc", destinoComOrigem: "https://pay.hotmart.com/X?sck=mo1abc" } }));
    assert.equal(criado.status, 201);
    const { data } = (await criado.json()) as { data: { slug: string; aviso: string } };
    assert.match(data.aviso, /0012/);
    const ida = await redirecionar.GET(request(`/l/${data.slug}?de=story`, { headers: { "user-agent": "Mozilla/5.0 Instagram" } }), routeParams({ slug: data.slug }));
    assert.equal(ida.headers.get("location"), "https://pay.hotmart.com/X");
    const [clique] = await db.sql<{ origin: string }>("select origin from public.link_clicks");
    assert.equal(clique.origin, "outro");

    // A sequência de DM do pacote não é guardada: o pacote avisa e a automação continua só com a 1ª mensagem.
    const service = await import("@/lib/content/service");
    const sequencias = await import("@/lib/db/dm-sequencias");
    assert.match(String(await service.packageWarning({ automationOptions: { sequencia: { mensagem2: "x" } } }, null)), /0012/);
    assert.equal(await sequencias.hasSequenciaTables(), false);
    assert.equal(await sequencias.iniciarSequencia({ accountId: conta, automationId: "00000000-0000-0000-0000-000000000000", contactId: "00000000-0000-0000-0000-000000000000" }), false);
  });
});
