import "./helpers/env.mjs";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { NextRequest } from "next/server";

/**
 * Vendas por webhook (0010): cada plataforma só aceita o aviso com o segredo certo (Stripe e Whop por assinatura,
 * Gumroad pelo ?key= do endereço, Payhip pelo hash da chave, Cakto pelo campo secret), o mesmo aviso duas vezes não
 * duplica, e o resumo do Molde exige o token e não traz dado pessoal.
 */
const STRIPE = "whsec_segredo-falso-da-stripe";
const WHOP = "ws_segredo-falso-da-whop";
const GUMROAD = "chave-falsa-do-gumroad-com-mais-de-24";
const PAYHIP = "chave-falsa-da-api-do-payhip";
const CAKTO = "segredo-falso-da-cakto";
Object.assign(process.env, { STRIPE_WEBHOOK_SECRET: STRIPE, WHOP_WEBHOOK_SECRET: WHOP, GUMROAD_WEBHOOK_KEY: GUMROAD, PAYHIP_API_KEY: PAYHIP, CAKTO_WEBHOOK_SECRET: CAKTO });
delete process.env.GUMROAD_ACCESS_TOKEN;

const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const lib = await import("@/lib/vendas/webhooks");
const stripe = await import("@/app/api/webhooks/stripe/route");
const whop = await import("@/app/api/webhooks/whop/route");
const gumroad = await import("@/app/api/webhooks/gumroad/route");
const payhip = await import("@/app/api/webhooks/payhip/route");
const cakto = await import("@/app/api/webhooks/cakto/route");
const vendasRoute = await import("@/app/api/molde/vendas/route");
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };

after(async () => {
  meta.restore();
  await db?.close();
});

const stripeSession = (id = "cs_test_1", extra: Record<string, unknown> = {}) => JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  livemode: true,
  data: { object: { id, amount_total: 4790, currency: "brl", payment_status: "paid", payment_intent: "pi_1", client_reference_id: "ebook-sono", payment_link: "plink_1", customer_details: { email: "cliente@exemplo.com" }, created: 1_760_000_000, ...extra } },
});

/** Pedido com o corpo cru exatamente como a plataforma manda (a assinatura vale sobre esses bytes). */
function rawRequest(path: string, body: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "https://uaiflow.teste"), { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}

const whopBody = (type = "payment.succeeded", data: Record<string, unknown> = {}) => JSON.stringify({ id: "msg_1", type, api_version: "v1", data: { id: "pay_1", total: 29.9, currency: "usd", product: { id: "prod_1", title: "Curso" }, user: { email: "x@y.z" }, metadata: { ref: "curso-a" }, paid_at: "2026-10-10T10:00:00Z", ...data } });
const gumroadBody = (extra: Record<string, string> = {}) => new URLSearchParams({ sale_id: "sale_1", product_id: "gp_1", product_name: "Planner", product_permalink: "https://loja.gumroad.com/l/planner", price: "1200", currency: "usd", email: "a@b.c", "url_params[ref]": "planner-ig", sale_timestamp: "2026-10-10T10:00:00Z", resource_name: "sale", ...extra }).toString();
const payhipBody = (type = "paid", signature = createHash("sha256").update(PAYHIP).digest("hex")) => JSON.stringify({ id: "TX1", type, email: "a@b.c", price: 990, currency: "EUR", items: [{ product_id: "ph1", product_key: "AbCd", product_name: "Guia" }], date: 1_760_000_000, signature });
const caktoBody = (event = "purchase_approved", secret = CAKTO) => JSON.stringify({ secret, event, data: { id: "ck-uuid-1", refId: "R1", amount: 97, product: { id: "cp-1", short_id: "abc", name: "Mentoria" }, customer: { email: "a@b.c", name: "Fulano" }, checkoutUrl: "https://pay.cakto.com.br/abc?ref=mentoria-ig", paidAt: "2026-10-10T10:00:00Z" } });

describe("assinaturas (sem banco)", () => {
  test("Stripe: válida passa; corpo mexido, segredo errado ou horário velho não", () => {
    const body = stripeSession();
    const now = Math.floor(Date.now() / 1000);
    assert.equal(lib.verifyStripeSignature(body, lib.signStripe(body, STRIPE, now), STRIPE, now), true);
    assert.equal(lib.verifyStripeSignature(`${body} `, lib.signStripe(body, STRIPE, now), STRIPE, now), false);
    assert.equal(lib.verifyStripeSignature(body, lib.signStripe(body, "whsec_outro", now), STRIPE, now), false);
    assert.equal(lib.verifyStripeSignature(body, lib.signStripe(body, STRIPE, now - 600), STRIPE, now), false);
    assert.equal(lib.verifyStripeSignature(body, null, STRIPE, now), false);
    assert.equal(lib.verifyStripeSignature(body, `t=${now},v1=zz`, STRIPE, now), false);
  });

  test("Whop (Standard Webhooks): válida passa; outra assinatura, outro id ou horário velho não", () => {
    const body = whopBody();
    const headers = lib.signStandardWebhook(body, WHOP, "msg_1");
    const h = { id: headers["webhook-id"], timestamp: headers["webhook-timestamp"], signature: headers["webhook-signature"] };
    assert.equal(lib.verifyStandardWebhook(body, h, WHOP), true);
    assert.equal(lib.verifyStandardWebhook(body, { ...h, signature: `v1,abc ${h.signature}` }, WHOP), true, "aceita mais de uma assinatura no cabeçalho");
    assert.equal(lib.verifyStandardWebhook(body, { ...h, id: "msg_2" }, WHOP), false);
    assert.equal(lib.verifyStandardWebhook(body, h, "ws_outro"), false);
    const velho = lib.signStandardWebhook(body, WHOP, "msg_1", Math.floor(Date.now() / 1000) - 900);
    assert.equal(lib.verifyStandardWebhook(body, { id: velho["webhook-id"], timestamp: velho["webhook-timestamp"], signature: velho["webhook-signature"] }, WHOP), false);
  });

  test("Payhip: signature = sha256 da chave; outra não", () => {
    assert.equal(lib.verifyPayhipSignature(createHash("sha256").update(PAYHIP).digest("hex"), PAYHIP), true);
    assert.equal(lib.verifyPayhipSignature(createHash("sha256").update("outra").digest("hex"), PAYHIP), false);
    assert.equal(lib.verifyPayhipSignature(undefined, PAYHIP), false);
  });

  test("leitura: Stripe pega o produto pelo client_reference_id e converte centavos; e-mail nunca entra", () => {
    const evento = lib.parseStripeEvent(JSON.parse(stripeSession()));
    assert.equal(evento.tipo, "venda");
    if (evento.tipo === "venda") {
      assert.deepEqual([evento.rawId, evento.pagamentoId, evento.produtoRef, evento.valor, evento.moeda], ["cs_test_1", "pi_1", "ebook-sono", 47.9, "BRL"]);
    }
    assert.doesNotMatch(JSON.stringify(evento), /cliente@exemplo/);
    assert.equal(lib.parseStripeEvent({ type: "customer.created", data: { object: {} } }).tipo, "ignorar");
    const gum = lib.parseGumroadPing(new URLSearchParams(gumroadBody()));
    assert.equal(gum.tipo === "venda" && gum.produtoRef, "planner-ig");
    const ck = lib.parseCaktoEvent(JSON.parse(caktoBody()));
    assert.equal(ck.tipo === "venda" && ck.produtoRef, "mentoria-ig");
    assert.doesNotMatch(JSON.stringify(ck), /Fulano|a@b\.c/);
  });
});

describe("rotas (sem banco: recusam antes de gravar)", () => {
  test("assinatura errada → 401 em todas as plataformas", async () => {
    assert.equal((await stripe.POST(rawRequest("/api/webhooks/stripe", stripeSession(), { "stripe-signature": lib.signStripe(stripeSession(), "whsec_outro") }))).status, 401);
    assert.equal((await stripe.POST(rawRequest("/api/webhooks/stripe", stripeSession()))).status, 401);
    const whopHeaders = lib.signStandardWebhook(whopBody(), "ws_outro", "msg_1");
    assert.equal((await whop.POST(rawRequest("/api/webhooks/whop", whopBody(), whopHeaders))).status, 401);
    assert.equal((await gumroad.POST(rawRequest("/api/webhooks/gumroad?key=errada", gumroadBody(), { "content-type": "application/x-www-form-urlencoded" }))).status, 401);
    assert.equal((await gumroad.POST(rawRequest("/api/webhooks/gumroad", gumroadBody(), { "content-type": "application/x-www-form-urlencoded" }))).status, 401);
    assert.equal((await payhip.POST(rawRequest("/api/webhooks/payhip", payhipBody("paid", "errada")))).status, 401);
    assert.equal((await cakto.POST(rawRequest("/api/webhooks/cakto", caktoBody("purchase_approved", "errado")))).status, 401);
  });

  test("sem o segredo no servidor: 503 com a frase (a plataforma tenta de novo depois)", async () => {
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const response = await stripe.POST(rawRequest("/api/webhooks/stripe", stripeSession(), { "stripe-signature": lib.signStripe(stripeSession(), STRIPE) }));
      assert.equal(response.status, 503);
      assert.match(((await response.json()) as { error: string }).error, /falta STRIPE_WEBHOOK_SECRET/);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = saved;
    }
  });

  test("evento que não interessa: 200 ignorado (sem gravar)", async () => {
    const body = JSON.stringify({ type: "customer.created", data: { object: { id: "cus_1" } } });
    const response = await stripe.POST(rawRequest("/api/webhooks/stripe", body, { "stripe-signature": lib.signStripe(body, STRIPE) }));
    assert.equal(response.status, 200);
    assert.match(JSON.stringify(await response.json()), /ignorado/);
  });

  test("resumo de vendas do Molde exige o token", async () => {
    assert.equal((await vendasRoute.GET(request("/api/molde/vendas?dias=30"))).status, 401);
    assert.equal((await vendasRoute.GET(request("/api/molde/vendas", { headers: { "x-molde-token": "errado-errado-errado-errado" } }))).status, 401);
  });
});

describe("com banco: grava uma vez, reembolso e resumo", { skip: semBanco }, () => {
  beforeEach(async () => {
    meta.reset();
    await db!.sql("delete from public.vendas");
    delete process.env.GUMROAD_ACCESS_TOKEN;
  });

  async function vendas() {
    return db!.sql<{ plataforma: string; raw_id: string; produto_ref: string; valor: string; moeda: string; status: string; valor_reembolsado: string }>(
      "select plataforma, raw_id, produto_ref, valor::text, moeda, status, valor_reembolsado::text from public.vendas order by plataforma, raw_id",
    );
  }

  test("Stripe: venda nova, repetida não duplica, reembolso muda a mesma venda", async () => {
    const body = stripeSession();
    const primeira = await stripe.POST(rawRequest("/api/webhooks/stripe", body, { "stripe-signature": lib.signStripe(body, STRIPE) }));
    assert.deepEqual(await primeira.json(), { ok: true, resultado: "nova" });
    const repetida = await stripe.POST(rawRequest("/api/webhooks/stripe", body, { "stripe-signature": lib.signStripe(body, STRIPE) }));
    assert.deepEqual(await repetida.json(), { ok: true, resultado: "repetida" });
    assert.equal((await vendas()).length, 1);

    const refund = JSON.stringify({ type: "charge.refunded", livemode: true, data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 4790, amount_refunded: 4790, refunded: true, currency: "brl" } } });
    const reembolso = await stripe.POST(rawRequest("/api/webhooks/stripe", refund, { "stripe-signature": lib.signStripe(refund, STRIPE) }));
    assert.deepEqual(await reembolso.json(), { ok: true, resultado: "atualizada" });
    const [venda] = await vendas();
    assert.deepEqual([venda.status, venda.valor, venda.valor_reembolsado, venda.produto_ref, venda.moeda], ["reembolsada", "47.90", "47.90", "ebook-sono", "BRL"]);
    const colunas = await db!.sql<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'vendas'");
    assert.ok(!colunas.some((coluna) => /email|nome_cliente|cliente/.test(coluna.column_name)), "nenhuma coluna de dado pessoal");
  });

  test("Whop, Gumroad, Payhip e Cakto: válida grava uma vez; reembolso atualiza", async () => {
    const wb = whopBody();
    const wh = lib.signStandardWebhook(wb, WHOP, "msg_1");
    assert.equal(((await (await whop.POST(rawRequest("/api/webhooks/whop", wb, wh))).json()) as { resultado: string }).resultado, "nova");
    assert.equal(((await (await whop.POST(rawRequest("/api/webhooks/whop", wb, lib.signStandardWebhook(wb, WHOP, "msg_1")))).json()) as { resultado: string }).resultado, "repetida");
    const wr = whopBody("refund.created", { id: "rf_1", amount: 29.9, status: "succeeded", payment: { id: "pay_1", total: 29.9 } });
    assert.equal(((await (await whop.POST(rawRequest("/api/webhooks/whop", wr, lib.signStandardWebhook(wr, WHOP, "msg_2")))).json()) as { resultado: string }).resultado, "atualizada");

    const form = { "content-type": "application/x-www-form-urlencoded" };
    for (let i = 0; i < 2; i += 1) assert.equal((await gumroad.POST(rawRequest(`/api/webhooks/gumroad?key=${GUMROAD}`, gumroadBody(), form))).status, 200);
    await gumroad.POST(rawRequest(`/api/webhooks/gumroad?key=${GUMROAD}`, gumroadBody({ resource_name: "refund", refunded: "true" }), form));

    for (let i = 0; i < 2; i += 1) assert.equal((await payhip.POST(rawRequest("/api/webhooks/payhip", payhipBody()))).status, 200);
    for (let i = 0; i < 2; i += 1) assert.equal((await cakto.POST(rawRequest("/api/webhooks/cakto", caktoBody()))).status, 200);
    await cakto.POST(rawRequest("/api/webhooks/cakto", caktoBody("chargeback")));

    const lista = await vendas();
    assert.deepEqual(lista.map((venda) => [venda.plataforma, venda.raw_id, venda.produto_ref, venda.valor, venda.moeda, venda.status]), [
      ["cakto", "ck-uuid-1", "mentoria-ig", "97.00", "BRL", "contestada"],
      ["gumroad", "sale_1", "planner-ig", "12.00", "USD", "reembolsada"],
      ["payhip", "TX1", "AbCd", "9.90", "EUR", "paga"],
      ["whop", "pay_1", "curso-a", "29.90", "USD", "reembolsada"],
    ]);
  });

  test("Gumroad com GUMROAD_ACCESS_TOKEN: só grava a venda que a API confirma", async () => {
    process.env.GUMROAD_ACCESS_TOKEN = "token-falso-do-gumroad";
    const form = { "content-type": "application/x-www-form-urlencoded" };
    const falsa = await gumroad.POST(rawRequest(`/api/webhooks/gumroad?key=${GUMROAD}`, gumroadBody(), form));
    assert.equal(falsa.status, 400);
    assert.equal((await vendas()).length, 0);
    meta.gumroadSales.add("sale_1");
    assert.equal((await gumroad.POST(rawRequest(`/api/webhooks/gumroad?key=${GUMROAD}`, gumroadBody(), form))).status, 200);
    assert.equal((await vendas()).length, 1);
  });

  test("resumo do Molde: totais por moeda, produto e plataforma; últimas vendas sem dado pessoal; teste fica de fora", async () => {
    const add = async (body: string) => stripe.POST(rawRequest("/api/webhooks/stripe", body, { "stripe-signature": lib.signStripe(body, STRIPE) }));
    await add(stripeSession("cs_a", { created: Math.floor(Date.now() / 1000) }));
    await add(stripeSession("cs_b", { created: Math.floor(Date.now() / 1000), payment_intent: "pi_2" }));
    await add(stripeSession("cs_velha", { created: Math.floor(Date.now() / 1000) - 60 * 86400, payment_intent: "pi_3" }));
    await add(JSON.stringify({ ...JSON.parse(stripeSession("cs_teste", { payment_intent: "pi_4", created: Math.floor(Date.now() / 1000) })), livemode: false }));
    await cakto.POST(rawRequest("/api/webhooks/cakto", caktoBody().replace("2026-10-10T10:00:00Z", new Date().toISOString())));
    const response = await vendasRoute.GET(request("/api/molde/vendas?dias=30", { headers: MOLDE }));
    assert.equal(response.status, 200);
    const { data } = (await response.json()) as { data: { dias: number; totais: Array<Record<string, unknown>>; porProduto: Array<Record<string, unknown>>; porPlataforma: Array<Record<string, unknown>>; ultimas: Array<Record<string, unknown>> } };
    assert.equal(data.dias, 30);
    const brl = data.totais.find((item) => item.moeda === "BRL");
    assert.deepEqual(brl, { moeda: "BRL", vendas: 3, reembolsos: 0, contestacoes: 0, bruto: 192.8, reembolsado: 0, liquido: 192.8 });
    assert.deepEqual(data.porProduto.map((item) => [item.plataforma, item.produtoRef, item.vendas]).sort(), [["cakto", "mentoria-ig", 1], ["stripe", "ebook-sono", 2]]);
    assert.equal(data.porPlataforma.length, 2);
    assert.equal(data.ultimas.length, 3);
    assert.doesNotMatch(JSON.stringify(data), /@|Fulano|cliente/);
  });
});
