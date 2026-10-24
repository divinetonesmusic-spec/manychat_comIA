import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/**
 * As 10 plataformas da 0012 (Hotmart, Kiwify, Eduzz, Monetizze, Braip, Ticto, Perfect Pay, Digistore24, ClickBank, Lemon
 * Squeezy), a origem do post no checkout (contrato v131 da página) e o GET /api/molde/vendas?refs=&desde=.
 * Os corpos abaixo seguem a documentação pública de cada plataforma: são EXEMPLOS (veja «conferir com um webhook real» em
 * docs/ATUALIZACAO_0012.md). Nenhum segredo é real.
 */
const S = {
  hotmart: "hottok-falso-da-hotmart",
  kiwify: "token-falso-da-kiwify",
  eduzz: "segredo-falso-da-eduzz",
  monetizze: "chave-unica-falsa-monetizze",
  braip: "chave-falsa-da-braip",
  ticto: "token-falso-da-ticto",
  perfectpay: "token-falso-perfectpay",
  digistore24: "senha-falsa-do-ipn",
  clickbank: "SEGREDOFALSO1234",
  lemonsqueezy: "segredo-falso-lemon",
};
Object.assign(process.env, {
  HOTMART_HOTTOK: S.hotmart, KIWIFY_WEBHOOK_TOKEN: S.kiwify, EDUZZ_WEBHOOK_SECRET: S.eduzz, MONETIZZE_CHAVE_UNICA: S.monetizze,
  BRAIP_AUTH_KEY: S.braip, TICTO_WEBHOOK_TOKEN: S.ticto, PERFECTPAY_WEBHOOK_TOKEN: S.perfectpay, DIGISTORE24_IPN_PASSPHRASE: S.digistore24,
  CLICKBANK_SECRET_KEY: S.clickbank, LEMONSQUEEZY_WEBHOOK_SECRET: S.lemonsqueezy, STRIPE_WEBHOOK_SECRET: "whsec_segredo-falso-da-stripe",
});

const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const novas = await import("@/lib/vendas/webhooks-novas");
const origemLib = await import("@/lib/vendas/origem");
const stripeLib = await import("@/lib/vendas/webhooks");
const rotas = {
  hotmart: await import("@/app/api/webhooks/hotmart/route"),
  kiwify: await import("@/app/api/webhooks/kiwify/route"),
  eduzz: await import("@/app/api/webhooks/eduzz/route"),
  monetizze: await import("@/app/api/webhooks/monetizze/route"),
  braip: await import("@/app/api/webhooks/braip/route"),
  ticto: await import("@/app/api/webhooks/ticto/route"),
  perfectpay: await import("@/app/api/webhooks/perfectpay/route"),
  digistore24: await import("@/app/api/webhooks/digistore24/route"),
  clickbank: await import("@/app/api/webhooks/clickbank/route"),
  lemonsqueezy: await import("@/app/api/webhooks/lemonsqueezy/route"),
  stripe: await import("@/app/api/webhooks/stripe/route"),
};
const vendasRoute = await import("@/app/api/molde/vendas/route");
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const ORIGEM = "mo1x2y3z";

after(async () => {
  meta.restore();
  await db?.close();
});

function raw(path: string, body: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "https://uaiflow.teste"), { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}
const FORM = { "content-type": "application/x-www-form-urlencoded" };

/* ---------- corpos de exemplo (formato da documentação pública; CONFERIR com um aviso real) ---------- */

const hotmart = (event = "PURCHASE_APPROVED", extra: Record<string, unknown> = {}) => JSON.stringify({
  id: "evt-h1", creation_date: Date.now(), event, version: "2.0.0",
  data: {
    product: { id: 123, ucode: "uc-1", name: "Ebook Oração" },
    buyer: { email: "comprador@exemplo.com", name: "Fulano" },
    purchase: { transaction: "HP123", status: "APPROVED", approved_date: Date.now(), full_price: { value: 97, currency_value: "BRL" }, price: { value: 90, currency_value: "BRL" }, origin: { src: ORIGEM, sck: `${ORIGEM}-story`, xcod: "" }, ...extra },
  },
});
const kiwify = (status = "paid", event = "order_approved") => JSON.stringify({
  order_id: "kw-1", order_ref: "KWREF", order_status: status, webhook_event_type: event,
  Product: { product_id: "kp-1", product_name: "Curso Kiwify" }, Customer: { email: "c@d.e", full_name: "Ciclana" },
  Commissions: { charge_amount: 4790, currency: "BRL" }, TrackingParameters: { src: null, sck: ORIGEM, utm_content: null }, approved_date: "2026-10-20 14:03",
});
const eduzz = (event = "myeduzz.invoice_paid") => JSON.stringify({
  id: "ed-evt-1", event, sentDate: "2026-10-20T14:03:00Z",
  data: { id: "ed-1", status: "paid", buyer: { email: "e@f.g" }, items: [{ productId: "ep-1", name: "Mentoria Eduzz" }], paid: { value: 197, currency: "BRL" }, utm: { source: "instagram", content: ORIGEM }, paidAt: "2026-10-20T14:03:00Z" },
});
const monetizzeForm = (status = "Finalizada", codigo = "2") => new URLSearchParams({
  chave_unica: S.monetizze, "tipoPostback[codigo]": codigo, "tipoPostback[descricao]": status, "venda[codigo]": "mz-1", "venda[status]": status,
  "venda[valor]": "67.00", "venda[src]": ORIGEM, "venda[dataFinalizada]": "2026-10-20 14:03:00", "produto[codigo]": "mp-1", "produto[nome]": "Planner", "comprador[email]": "x@y.z",
}).toString();
const braip = (status = "Pagamento Aprovado", auth = S.braip) => JSON.stringify({
  basic_authentication: auth, type: "STATUS_ALTERADO", trans_key: "br-1", trans_status: status, trans_total_value: 9700,
  product_key: "bp-1", product_name: "Guia Braip", trans_createdate: "2026-10-20 14:03:00", utm_content: ORIGEM, client_email: "a@b.c",
});
const ticto = (status = "authorized", token = S.ticto) => JSON.stringify({
  version: "2.0", token, status, order: { hash: "tc-1", paid_amount: 2990, order_date: "2026-10-20 14:03:00" },
  item: { product_id: 77, product_name: "Ticto Pack" }, customer: { email: "t@t.t" }, query_params: { utm_content: ORIGEM },
});
const perfectpay = (statusEnum = 2, token = S.perfectpay) => JSON.stringify({
  token, code: "PPCPMTB1", sale_amount: 49.9, currency_enum: 1, sale_status_enum: statusEnum, product: { code: "PPPB1", name: "Perfect Ebook" },
  customer: { email: "p@p.p" }, metadata: { src: ORIGEM, utm_source: "instagram" }, date_approved: "2026-10-20 14:03:00",
});
function digistore(event = "on_payment", extra: Record<string, string> = {}) {
  const fields: Record<string, string> = { event, order_id: "DS1", transaction_id: "DT1", amount: "37.00", currency: "EUR", product_id: "991", product_name: "Digi Kurs", custom: ORIGEM, email: "d@d.d", ...extra };
  fields.sha_sign = novas.digistoreSign(fields, S.digistore24);
  return new URLSearchParams(fields).toString();
}
const clickbankPayload = (type = "SALE") => ({
  transactionTime: "2026-10-20T14:03:00-07:00", receipt: "CWOGBZLN", transactionType: type, vendor: "molde", role: "VENDOR",
  totalOrderAmount: type === "RFND" ? -47 : 47, currency: "USD", trackingCodes: [ORIGEM], lineItems: [{ itemNo: "1", productTitle: "CB Course" }],
  customer: { billing: { email: "cb@cb.cb" } }, version: 8.0,
});
const lemon = (event = "order_created", test = false) => JSON.stringify({
  meta: { event_name: event, test_mode: test, custom_data: { molde_origem: ORIGEM } },
  data: { type: "orders", id: test ? "lm-teste" : "lm-1", attributes: { identifier: "uuid-lm", status: event === "order_refunded" ? "refunded" : "paid", currency: "USD", total: 1999, refunded_amount: 1999, user_email: "l@l.l", first_order_item: { product_id: 5, product_name: "Lemon Pack" }, created_at: "2026-10-20T14:03:00Z" } },
});

/** Um aviso de cada plataforma já assinado, pronto para mandar. */
function aviso(plataforma: keyof typeof rotas, tipo: "venda" | "reembolso" | "chargeback" = "venda") {
  switch (plataforma) {
    case "hotmart": {
      const body = hotmart(tipo === "venda" ? "PURCHASE_APPROVED" : tipo === "reembolso" ? "PURCHASE_REFUNDED" : "PURCHASE_CHARGEBACK");
      return raw("/api/webhooks/hotmart", body, { "x-hotmart-hottok": S.hotmart });
    }
    case "kiwify": {
      const body = tipo === "venda" ? kiwify() : tipo === "reembolso" ? kiwify("refunded", "order_refunded") : kiwify("chargedback", "chargeback");
      return raw(`/api/webhooks/kiwify?signature=${novas.signHmacHex("sha1", S.kiwify, body)}`, body);
    }
    case "eduzz": {
      const body = eduzz(tipo === "venda" ? "myeduzz.invoice_paid" : tipo === "reembolso" ? "myeduzz.invoice_refunded" : "myeduzz.invoice_chargeback");
      return raw("/api/webhooks/eduzz", body, { "x-signature": novas.signHmacHex("sha256", S.eduzz, body) });
    }
    case "monetizze":
      return raw("/api/webhooks/monetizze", tipo === "venda" ? monetizzeForm() : tipo === "reembolso" ? monetizzeForm("Devolvida", "4") : monetizzeForm("Chargeback", "9"), FORM);
    case "braip":
      return raw("/api/webhooks/braip", braip(tipo === "venda" ? "Pagamento Aprovado" : tipo === "reembolso" ? "Devolvida" : "Chargeback"));
    case "ticto":
      return raw("/api/webhooks/ticto", ticto(tipo === "venda" ? "authorized" : tipo === "reembolso" ? "refunded" : "chargeback"));
    case "perfectpay":
      return raw("/api/webhooks/perfectpay", perfectpay(tipo === "venda" ? 2 : tipo === "reembolso" ? 7 : 9));
    case "digistore24":
      return raw("/api/webhooks/digistore24", digistore(tipo === "venda" ? "on_payment" : tipo === "reembolso" ? "on_refund" : "on_chargeback"), FORM);
    case "clickbank":
      return raw("/api/webhooks/clickbank", JSON.stringify(novas.encryptClickbank(clickbankPayload(tipo === "venda" ? "SALE" : tipo === "reembolso" ? "RFND" : "CGBK"), S.clickbank)));
    case "lemonsqueezy": {
      const body = lemon(tipo === "venda" ? "order_created" : "order_refunded");
      return raw("/api/webhooks/lemonsqueezy", body, { "x-signature": novas.signHmacHex("sha256", S.lemonsqueezy, body) });
    }
    default:
      throw new Error("sem exemplo");
  }
}

const NOVAS = ["hotmart", "kiwify", "eduzz", "monetizze", "braip", "ticto", "perfectpay", "digistore24", "clickbank", "lemonsqueezy"] as const;
const SEM_CHARGEBACK = new Set(["lemonsqueezy"]);

describe("a origem do post (sem banco)", () => {
  test("código mo… sozinho ou com sufixo; qualquer outra coisa não", () => {
    assert.equal(origemLib.codigoOrigem("mo1x2y3z"), "mo1x2y3z");
    assert.equal(origemLib.codigoOrigem("MO1X2Y3Z-story"), "mo1x2y3z");
    assert.equal(origemLib.codigoOrigem("mo1x2y3z_dm"), "mo1x2y3z");
    assert.equal(origemLib.codigoOrigem("molde-do-avatar"), null);
    assert.equal(origemLib.codigoOrigem("mo12345678"), null, "mais de 9 letras não é código");
    assert.equal(origemLib.codigoOrigem("instagram"), null);
    assert.equal(origemLib.acharOrigem([null, "", ["x", "mo9"], "mo1"]), "mo9");
  });

  test("reserva: acha o código num campo de rastreio em qualquer nível, nunca em e-mail ou nome", () => {
    assert.equal(origemLib.origemProfunda({ a: { b: { tracking: { utm_content: "mo7abc" } } } }), "mo7abc");
    assert.equal(origemLib.origemProfunda({ "url_params[utm_content]": "mo7abc" }), "mo7abc");
    assert.equal(origemLib.origemProfunda({ name: "mo7abc", email: "mo7abc" }), null);
    assert.equal(origemLib.origemProfunda({ trackingCodes: ["x", "mo7abc"] }), "mo7abc");
  });
});

describe("assinaturas e leitura das 10 plataformas (sem banco)", () => {
  test("Hotmart: hottok no cabeçalho ou no corpo; venda com a origem do sck/src; protesto fica de fora", () => {
    assert.equal(novas.verifyHotmart(S.hotmart, {}, S.hotmart), true);
    assert.equal(novas.verifyHotmart(null, { hottok: S.hotmart }, S.hotmart), true);
    assert.equal(novas.verifyHotmart("errado", {}, S.hotmart), false);
    const venda = novas.parseHotmartEvent(JSON.parse(hotmart()));
    assert.equal(venda.tipo, "venda");
    if (venda.tipo === "venda") assert.deepEqual([venda.rawId, venda.valor, venda.moeda, venda.origem, venda.produtoNome], ["HP123", 97, "BRL", ORIGEM, "Ebook Oração"]);
    assert.doesNotMatch(JSON.stringify(venda), /comprador@|Fulano/);
    assert.equal(novas.parseHotmartEvent(JSON.parse(hotmart("PURCHASE_PROTEST"))).tipo, "ignorar");
  });

  test("Kiwify: signature = HMAC-SHA1 do corpo; centavos viram reais", () => {
    const body = kiwify();
    assert.equal(novas.verifyKiwify(body, novas.signHmacHex("sha1", S.kiwify, body), S.kiwify), true);
    assert.equal(novas.verifyKiwify(`${body} `, novas.signHmacHex("sha1", S.kiwify, body), S.kiwify), false);
    const venda = novas.parseKiwifyEvent(JSON.parse(body));
    assert.ok(venda.tipo === "venda" && venda.valor === 47.9 && venda.origem === ORIGEM);
    assert.equal(novas.parseKiwifyEvent(JSON.parse(kiwify("waiting_payment", "pix_created"))).tipo, "ignorar");
  });

  test("Eduzz, Lemon Squeezy: HMAC-SHA256 do corpo no cabeçalho", () => {
    const e = eduzz();
    assert.equal(novas.verifyEduzz(e, novas.signHmacHex("sha256", S.eduzz, e), S.eduzz), true);
    assert.equal(novas.verifyEduzz(e, novas.signHmacHex("sha256", "outro", e), S.eduzz), false);
    const l = lemon();
    assert.equal(novas.verifyLemonSqueezy(l, novas.signHmacHex("sha256", S.lemonsqueezy, l), S.lemonsqueezy), true);
    assert.equal(novas.verifyLemonSqueezy(l, null, S.lemonsqueezy), false);
    const venda = novas.parseLemonSqueezyEvent(JSON.parse(l));
    assert.ok(venda.tipo === "venda" && venda.valor === 19.99 && venda.moeda === "USD" && venda.origem === ORIGEM);
    const teste = novas.parseLemonSqueezyEvent(JSON.parse(lemon("order_created", true)));
    assert.ok(teste.tipo === "venda" && teste.teste === true);
  });

  test("Monetizze, Braip, Ticto, Perfect Pay: o token do corpo; situação de cada uma", () => {
    assert.equal(novas.verifyMonetizze({ chave_unica: S.monetizze }, S.monetizze), true);
    assert.equal(novas.verifyBraip(JSON.parse(braip("x", "errada")), S.braip), false);
    assert.equal(novas.verifyTicto(JSON.parse(ticto()), S.ticto), true);
    assert.equal(novas.verifyPerfectPay(JSON.parse(perfectpay(2, "errado")), S.perfectpay), false);
    const braipVenda = novas.parseBraipEvent(JSON.parse(braip()));
    assert.ok(braipVenda.tipo === "venda" && braipVenda.valor === 97);
    assert.equal(novas.parseBraipEvent(JSON.parse(braip("Aguardando Pagamento"))).tipo, "ignorar");
    assert.equal(novas.parseTictoEvent(JSON.parse(ticto("waiting_payment"))).tipo, "ignorar");
    assert.equal(novas.parsePerfectPayEvent(JSON.parse(perfectpay(1))).tipo, "ignorar");
    assert.equal(novas.parsePerfectPayEvent(JSON.parse(perfectpay(9))).tipo, "contestacao");
  });

  test("Digistore24: sha_sign confere; corpo mexido ou senha errada não; teste de conexão é ignorado", () => {
    const params = new URLSearchParams(digistore());
    assert.equal(novas.verifyDigistore(params, S.digistore24), true);
    assert.equal(novas.verifyDigistore(params, "outra-senha"), false);
    params.set("amount", "1.00");
    assert.equal(novas.verifyDigistore(params, S.digistore24), false);
    assert.equal(novas.parseDigistoreIpn(new URLSearchParams(digistore("connection_test"))).tipo, "ignorar");
  });

  test("ClickBank: abre com a chave certa (e não com outra); TEST_SALE é venda de teste; o tid volta em trackingCodes", () => {
    const enc = novas.encryptClickbank(clickbankPayload(), S.clickbank);
    const aberto = novas.decryptClickbank(enc, S.clickbank);
    assert.ok(aberto && aberto.receipt === "CWOGBZLN");
    assert.equal(novas.decryptClickbank(enc, "OUTRACHAVE12"), null);
    const venda = novas.parseClickbankEvent(aberto!);
    assert.ok(venda.tipo === "venda" && venda.origem === ORIGEM && venda.valor === 47 && !venda.teste);
    const teste = novas.parseClickbankEvent(clickbankPayload("TEST_SALE"));
    assert.ok(teste.tipo === "venda" && teste.teste === true);
    const reembolso = novas.parseClickbankEvent(clickbankPayload("RFND"));
    assert.ok(reembolso.tipo === "reembolso" && reembolso.valor === 47);
  });

  test("Stripe: client_reference_id com o código vira origem (e não referência do produto)", () => {
    const evento = stripeLib.parseStripeEvent({ type: "checkout.session.completed", livemode: true, data: { object: { id: "cs_1", amount_total: 1000, currency: "usd", payment_status: "paid", client_reference_id: ORIGEM } } });
    assert.ok(evento.tipo === "venda" && evento.origem === ORIGEM && evento.produtoRef === null);
  });

  test("rotas: assinatura errada → 401 em todas; sem o segredo → 503", async () => {
    const errados: Array<[keyof typeof rotas, NextRequest]> = [
      ["hotmart", raw("/api/webhooks/hotmart", hotmart(), { "x-hotmart-hottok": "errado" })],
      ["kiwify", raw("/api/webhooks/kiwify?signature=abc", kiwify())],
      ["eduzz", raw("/api/webhooks/eduzz", eduzz(), { "x-signature": "abc" })],
      ["monetizze", raw("/api/webhooks/monetizze", monetizzeForm().replace(S.monetizze, "errada"), FORM)],
      ["braip", raw("/api/webhooks/braip", braip("Pagamento Aprovado", "errada"))],
      ["ticto", raw("/api/webhooks/ticto", ticto("authorized", "errado"))],
      ["perfectpay", raw("/api/webhooks/perfectpay", perfectpay(2, "errado"))],
      ["digistore24", raw("/api/webhooks/digistore24", digistore().replace("amount=37.00", "amount=1.00"), FORM)],
      ["clickbank", raw("/api/webhooks/clickbank", JSON.stringify(novas.encryptClickbank(clickbankPayload(), "OUTRACHAVE12")))],
      ["lemonsqueezy", raw("/api/webhooks/lemonsqueezy", lemon(), { "x-signature": "abc" })],
    ];
    for (const [plataforma, pedido] of errados) assert.equal((await rotas[plataforma].POST(pedido)).status, 401, plataforma);
    const salvo = process.env.HOTMART_HOTTOK;
    delete process.env.HOTMART_HOTTOK;
    try {
      const resposta = await rotas.hotmart.POST(aviso("hotmart"));
      assert.equal(resposta.status, 503);
      assert.match(((await resposta.json()) as { error: string }).error, /falta HOTMART_HOTTOK/);
    } finally {
      process.env.HOTMART_HOTTOK = salvo;
    }
  });
});

describe("com banco: vendas das 10 plataformas e as vendas por post", { skip: semBanco }, () => {
  let links: typeof import("@/app/api/molde/links/route");
  let redirecionar: typeof import("@/app/l/[slug]/route");
  let conta: string;

  before(async () => {
    links = await import("@/app/api/molde/links/route");
    redirecionar = await import("@/app/l/[slug]/route");
  });

  beforeEach(async () => {
    await db!.sql("delete from public.vendas");
    await db!.sql("delete from public.tracked_links");
    await db!.sql("delete from public.instagram_accounts");
    conta = await seedAccount(db!);
  });

  const vendas = () => db!.sql<{ plataforma: string; raw_id: string; status: string; valor: string; moeda: string; origem: string | null; teste: boolean }>(
    "select plataforma, raw_id, status, valor::text, moeda, origem, teste from public.vendas order by plataforma, raw_id",
  );

  test("cada plataforma: venda grava uma vez (com a origem); reembolso e chargeback mudam a mesma venda", async () => {
    for (const plataforma of NOVAS) {
      const primeira = await rotas[plataforma].POST(aviso(plataforma));
      assert.equal(primeira.status, 200, `${plataforma}: ${await primeira.clone().text()}`);
      assert.equal((await rotas[plataforma].POST(aviso(plataforma))).status, 200, `${plataforma} repetida`);
      const lista = (await vendas()).filter((venda) => venda.plataforma === plataforma);
      assert.equal(lista.length, 1, `${plataforma}: o mesmo aviso duas vezes não duplica`);
      assert.deepEqual([lista[0].status, lista[0].origem], ["paga", ORIGEM], plataforma);

      assert.equal((await rotas[plataforma].POST(aviso(plataforma, "reembolso"))).status, 200, `${plataforma} reembolso`);
      let [venda] = (await vendas()).filter((item) => item.plataforma === plataforma);
      assert.equal(venda.status, "reembolsada", `${plataforma}: reembolso muda a mesma venda`);
      if (!SEM_CHARGEBACK.has(plataforma)) {
        assert.equal((await rotas[plataforma].POST(aviso(plataforma, "chargeback"))).status, 200, `${plataforma} chargeback`);
        [venda] = (await vendas()).filter((item) => item.plataforma === plataforma);
        assert.equal(venda.status, "contestada", `${plataforma}: chargeback muda a mesma venda`);
      }
      assert.equal((await vendas()).filter((item) => item.plataforma === plataforma).length, 1, `${plataforma}: continua 1 linha`);
    }
    const colunas = await db!.sql<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'vendas'");
    assert.ok(!colunas.some((coluna) => /email|cliente/.test(coluna.column_name)), "nenhuma coluna de dado pessoal");
  });

  test("Digistore24 responde o texto OK (senão repete o aviso)", async () => {
    const resposta = await rotas.digistore24.POST(aviso("digistore24"));
    assert.equal(resposta.status, 200);
    assert.equal(await resposta.text(), "OK");
  });

  test("link com origem: /l/ leva ao checkout com a origem; story conta e vai no sck; outro endereço é ignorado", async () => {
    const destino = "https://pay.hotmart.com/X123";
    const comOrigem = `${destino}?src=${ORIGEM}&sck=${ORIGEM}`;
    const criar = await links.POST(request("/api/molde/links", { headers: MOLDE, json: { accountId: conta, externalRef: "proj:reel-1", destino, rotulo: "Oração", destinoComOrigem: comOrigem, origem: ORIGEM } }));
    assert.equal(criar.status, 201);
    const { data } = (await criar.json()) as { data: { slug: string; origem: string; destinoComOrigem: string } };
    assert.deepEqual([data.origem, data.destinoComOrigem], [ORIGEM, comOrigem]);

    const clicar = (consulta: string) => redirecionar.GET(request(`/l/${data.slug}${consulta}`, { headers: { "user-agent": "Mozilla/5.0 Instagram" } }), routeParams({ slug: data.slug }));
    const bio = await clicar("?de=bio");
    assert.equal(bio.headers.get("location"), `${destino}?src=${ORIGEM}&sck=${ORIGEM}-bio`);
    const story = await clicar("?de=story");
    assert.equal(story.headers.get("location"), `${destino}?src=${ORIGEM}&sck=${ORIGEM}-story`);
    const semDe = await clicar("");
    assert.equal(semDe.headers.get("location"), comOrigem);
    const origens = await db!.sql<{ origin: string }>("select origin from public.link_clicks order by clicked_at");
    assert.deepEqual(origens.map((o) => o.origin).sort(), ["bio", "outro", "story"]);

    const outroSite = await links.POST(request("/api/molde/links", { headers: MOLDE, json: { accountId: conta, externalRef: "proj:reel-2", destino, destinoComOrigem: "https://golpe.exemplo/x", origem: "nao-e-codigo" } }));
    const outro = (await outroSite.json()) as { data: { slug: string; aviso: string } };
    assert.match(outro.data.aviso, /destinoComOrigem ignorado/);
    assert.match(outro.data.aviso, /origem ignorada/);
    const ida = await redirecionar.GET(request(`/l/${outro.data.slug}`), routeParams({ slug: outro.data.slug }));
    assert.equal(ida.headers.get("location"), destino);

    // O destino mudou sem a origem (página antiga): o link vai ao destino novo, nunca ao checkout antigo.
    await links.POST(request("/api/molde/links", { headers: MOLDE, json: { accountId: conta, externalRef: "proj:reel-1", destino: "https://pay.hotmart.com/Y999" } }));
    assert.equal((await clicar("")).headers.get("location"), "https://pay.hotmart.com/Y999");
  });

  test("GET /api/molde/vendas?refs=&desde=: cada venda com o ref do link pela origem; sem origem, ref vazio; teste fica de fora; ?dias= continua", async () => {
    const ref = "proj-1:reel/ação,1";
    await links.POST(request("/api/molde/links", { headers: MOLDE, json: { accountId: conta, externalRef: ref, destino: "https://pay.hotmart.com/X123", origem: ORIGEM, destinoComOrigem: `https://pay.hotmart.com/X123?sck=${ORIGEM}` } }));
    await rotas.hotmart.POST(aviso("hotmart"));
    // venda sem origem conhecida (Kiwify sem os parâmetros) e uma venda de teste (Lemon Squeezy test_mode)
    const semOrigem = JSON.stringify({ ...JSON.parse(kiwify()), order_id: "kw-sem", TrackingParameters: {} });
    await rotas.kiwify.POST(raw(`/api/webhooks/kiwify?signature=${novas.signHmacHex("sha1", S.kiwify, semOrigem)}`, semOrigem));
    const teste = lemon("order_created", true);
    await rotas.lemonsqueezy.POST(raw("/api/webhooks/lemonsqueezy", teste, { "x-signature": novas.signHmacHex("sha256", S.lemonsqueezy, teste) }));
    // uma venda velha (fora do desde)
    await db!.sql("insert into public.vendas (plataforma, raw_id, valor, moeda, criado_em, origem) values ('braip', 'velha', 10, 'BRL', now() - interval '200 days', $1)", [ORIGEM]);

    const refs = encodeURIComponent(ref);
    const desde = new Date(Date.now() - 90 * 86_400_000).toISOString();
    assert.equal((await vendasRoute.GET(request(`/api/molde/vendas?refs=${refs}&desde=${desde}`))).status, 401);
    const resposta = await vendasRoute.GET(request(`/api/molde/vendas?refs=${refs}&desde=${encodeURIComponent(desde)}`, { headers: MOLDE }));
    assert.equal(resposta.status, 200);
    const corpo = (await resposta.json()) as { vendas: Array<Record<string, unknown>>; totais: Record<string, unknown> };
    const hot = corpo.vendas.find((venda) => venda.plataforma === "hotmart")!;
    assert.deepEqual(hot, { ref, plataforma: "hotmart", produto: "Ebook Oração", valor: 97, moeda: "BRL", status: "aprovada", em: hot.em, origem: ORIGEM });
    const kw = corpo.vendas.find((venda) => venda.plataforma === "kiwify")!;
    assert.deepEqual([kw.ref, kw.origem], ["", ""]);
    assert.equal(corpo.vendas.length, 2, "a de teste e a velha ficam de fora");
    assert.deepEqual(corpo.totais, { aprovadas: 2, reembolsadas: 0, chargebacks: 0, receita: { BRL: 144.9 } });
    assert.doesNotMatch(JSON.stringify(corpo), /@|Fulano|Ciclana/);

    // reembolso muda a mesma venda (não vira 2 linhas)
    await rotas.hotmart.POST(aviso("hotmart", "reembolso"));
    const depois = (await (await vendasRoute.GET(request(`/api/molde/vendas?refs=${refs}&desde=${encodeURIComponent(desde)}`, { headers: MOLDE }))).json()) as { vendas: Array<Record<string, unknown>> };
    assert.deepEqual(depois.vendas.filter((venda) => venda.plataforma === "hotmart").map((venda) => venda.status), ["reembolsada"]);

    const antigo = await vendasRoute.GET(request("/api/molde/vendas?dias=30", { headers: MOLDE }));
    assert.equal(antigo.status, 200);
    assert.ok(Array.isArray(((await antigo.json()) as { data: { totais: unknown[] } }).data.totais));
  });
});
