import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/**
 * O app por assinatura do Molde (0018, /a/<slug>): o pacote conferido (30 dias, 2 a 8 áudios, o preço abaixo do teto, nada de
 * promessa de cura), as contas (a noite, os dias seguidos, o acesso com a carência, o critério dos 60 dias), os avisos de
 * assinatura de cada plataforma (Hotmart, Kiwify, Stripe e as outras pelo e-mail achado), e, com banco: publicar (áudios privados
 * no R2), a assinatura pelo aviso de venda (aprovada → renovada → cancelada → sem acesso depois da carência; o cancelamento da
 * Stripe sem e-mail pelo código da assinatura), entrar sem senha (link e código), o áudio só com acesso, o uso do dia, o lembrete
 * (o relógio, uma vez por dia, só para quem ligou e não tocou) e os números da decisão dos 60 dias; sem a 0018, nada quebra.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const S = { hotmart: "hottok-falso-da-hotmart", kiwify: "token-falso-da-kiwify", stripe: "whsec_segredo_falso_stripe" };
Object.assign(process.env, { HOTMART_HOTTOK: S.hotmart, KIWIFY_WEBHOOK_TOKEN: S.kiwify, STRIPE_WEBHOOK_SECRET: S.stripe });

function dias(n = 30) {
  return Array.from({ length: n }, (_, i) => ({ titulo: `Noite ${i + 1}: respirar devagar`, fazer: "Deite, apague a luz e toque o áudio. Respire junto com a voz.", audio: i % 7 === 6 ? "som" : "respira", minutos: 8 }));
}
function pacote(extra: Record<string, unknown> = {}) {
  return {
    titulo: "Noites Calmas", nomeCurto: "Noites", promessa: "Uma rotina de 30 noites para desacelerar antes de dormir.", idioma: "pt-BR",
    marca: { nome: "Lua", cores: { fundo: "#12101A", texto: "#EFE9DD", primaria: "#D9B26A", textoPrimaria: "#12101A" } },
    dias: dias(), audios: [{ id: "respira", titulo: "Respiração 4-7-8", minutos: 8 }, { id: "som", titulo: "Som de chuva", minutos: 20 }],
    preco: { valor: 19.9, moeda: "BRL", porque: "Menos que um lanche por mês; 30 noites guiadas valem mais que o PDF." },
    checkout: "https://pay.hotmart.com/X123?src=MOAPPORIGEM&sck=MOAPPORIGEM", convite: "Toque uma vez por noite.",
    lembrete: { assunto: "Sua noite de hoje", texto: "Hora de desacelerar: a noite de hoje está pronta.", hora: 21 }, aviso: "Personagem criado com IA.",
    ...extra,
  };
}

describe("app por assinatura (sem banco)", () => {
  test("lerApp: o pacote bom passa; 29 dias, áudio que não existe, preço acima do teto e promessa de cura não passam", async () => {
    const { lerApp, promessaProibida, checkoutComOrigem } = await import("@/lib/app/pacote");
    const bom = lerApp({ app: pacote(), audios: [{ id: "respira", contentType: "audio/mpeg", size: 1000 }] });
    assert.ok(bom.ok, JSON.stringify(bom));
    if (!bom.ok) return;
    assert.equal(bom.slug, "noites-calmas");
    assert.equal(bom.app.dias.length, 30);
    assert.equal(bom.app.dias[6].audio, "som");
    assert.equal(bom.app.preco.moeda, "BRL");
    assert.equal(bom.produtoRefs, null, "sem códigos de produto no pedido: não mexe nos guardados");
    assert.match(String((lerApp({ app: pacote({ dias: dias(29) }) }) as { erro: string }).erro), /30 dias/);
    assert.match(String((lerApp({ app: pacote({ dias: dias().map((d, i) => (i ? d : { ...d, audio: "nada" })) }) }) as { erro: string }).erro), /áudio que não existe/);
    assert.match(String((lerApp({ app: pacote({ preco: { valor: 27, moeda: "USD" } }) }) as { erro: string }).erro), /abaixo de US\$ 27/);
    assert.ok(lerApp({ app: pacote({ preco: { valor: 9, moeda: "USD", porque: "x" } }) }).ok);
    assert.match(String((lerApp({ app: pacote({ promessa: "Cura a insônia em 30 dias." }) }) as { erro: string }).erro), /promete cura/);
    assert.match(String((lerApp({ app: pacote({ convite: "This treatment fixes your sleep." }) }) as { erro: string }).erro), /tratamento/);
    assert.equal(promessaProibida("Isso se trata de um ritual simples.").length, 0, "«se trata de» não é tratamento");
    assert.equal(promessaProibida("Treat yourself to a calm night.").length, 0);
    assert.match(String((lerApp({ app: pacote(), audios: [{ id: "respira", contentType: "video/mp4", size: 10 }] }) as { erro: string }).erro), /mp3/);
    assert.match(String((lerApp({ app: pacote(), audios: [{ id: "respira", contentType: "audio/mpeg", size: 26 * 1048576 }] }) as { erro: string }).erro), /25 MB/);
    assert.equal(checkoutComOrigem("https://pay.hotmart.com/X123?src=MOAPPORIGEM&sck=MOAPPORIGEM", "mo1a2b3c"), "https://pay.hotmart.com/X123?src=mo1a2b3c&sck=mo1a2b3c");
    assert.equal(checkoutComOrigem("https://pay.hotmart.com/X123?src=MOAPPORIGEM", null), "https://pay.hotmart.com/X123");
    assert.equal(checkoutComOrigem("https://buy.stripe.com/abc", "mo9"), "https://buy.stripe.com/abc?src=mo9");
  });

  test("as contas: a noite, os dias seguidos, o acesso com a carência e o critério dos 60 dias", async () => {
    const { noiteDe, diasSeguidos, acessoDepois, temAcesso, decisao60, diaLocal, fusoValido } = await import("@/lib/app/rotina");
    assert.deepEqual(noiteDe(0, false), { noite: 1, ciclo: 1, total: 30 });
    assert.deepEqual(noiteDe(3, false), { noite: 4, ciclo: 1, total: 30 }, "3 noites feitas: hoje é a Noite 4 de 30");
    assert.deepEqual(noiteDe(4, true), { noite: 4, ciclo: 1, total: 30 }, "já tocou hoje: continua a Noite 4");
    assert.deepEqual(noiteDe(30, false), { noite: 1, ciclo: 2, total: 30 });
    assert.equal(diasSeguidos(["2026-10-25", "2026-10-24", "2026-10-22"], "2026-10-25"), 2);
    assert.equal(diasSeguidos(["2026-10-24", "2026-10-23"], "2026-10-25"), 2, "hoje ainda não tocou: a sequência continua");
    assert.equal(diasSeguidos(["2026-10-22"], "2026-10-25"), 0);
    assert.equal(diaLocal(new Date("2026-10-26T01:30:00Z"), "America/Sao_Paulo"), "2026-10-25");
    assert.equal(fusoValido("America/New_York"), true);
    assert.equal(fusoValido("Lua/Crescente"), false);
    const em = new Date("2026-10-01T12:00:00Z");
    const pago = acessoDepois({ tipo: "aprovada", em, acessoAte: null, carenciaDias: 3 });
    assert.equal(pago.status, "ativo");
    assert.equal(pago.acessoAte.toISOString(), "2026-11-04T12:00:00.000Z", "31 dias + 3 de carência");
    const cancel = acessoDepois({ tipo: "cancelada", em: new Date("2026-10-10T12:00:00Z"), acessoAte: pago.acessoAte, carenciaDias: 3 });
    assert.equal(cancel.acessoAte.toISOString(), "2026-10-13T12:00:00.000Z", "cancelada: só a carência");
    assert.equal(temAcesso(cancel.acessoAte, new Date("2026-10-12T12:00:00Z")), true);
    assert.equal(temAcesso(cancel.acessoAte, new Date("2026-10-14T12:00:00Z")), false);
    const base = { ativos: 40, emCarencia: 0, novos30: 10, cancelamentos30: 3, retencao2: { elegiveis: 25, retidos: 15, taxa: 0.6 }, uso: { tocaramHoje: 20, semana: 0.6, seguidosMedia: 4, quatroDias: 0.5 }, receita30: { BRL: 900 }, mrr: { BRL: 2600 }, diasDeTeste: 61 };
    assert.equal(decisao60(base, "BRL").veredito, "loja");
    assert.equal(decisao60({ ...base, mrr: { BRL: 900 } }, "BRL").veredito, "mais30");
    assert.equal(decisao60({ ...base, mrr: {}, retencao2: { elegiveis: 5, retidos: 5, taxa: 1 } }, "BRL").veredito, "ficar", "retenção com menos de 20 pessoas não conta");
    assert.equal(decisao60({ ...base, diasDeTeste: 30 }, "BRL").veredito, "esperar");
  });

  test("os avisos de assinatura: Hotmart, Kiwify, Stripe e as outras plataformas pelo e-mail achado", async () => {
    const { lerAssinatura, acharEmail } = await import("@/lib/app/assinatura");
    const ign = { tipo: "ignorar" as const, motivo: "x" };
    const hot = (event: string, recurrence = 1) => ({ event, data: { buyer: { email: "Ana@Exemplo.com" }, product: { id: 1234567, ucode: "uc-1" }, purchase: { transaction: `HP${recurrence}`, recurrence_number: recurrence, price: { value: 19.9, currency_value: "BRL" } }, subscription: { subscriber: { code: "SUB1" } } } });
    assert.deepEqual(lerAssinatura("hotmart", hot("PURCHASE_APPROVED"), ign)?.tipo, "aprovada");
    const h2 = lerAssinatura("hotmart", hot("PURCHASE_APPROVED", 2), ign);
    assert.equal(h2?.tipo, "renovada");
    assert.equal(h2?.email, "ana@exemplo.com");
    assert.deepEqual(h2?.produtos, ["1234567", "uc-1"]);
    assert.equal(lerAssinatura("hotmart", hot("PURCHASE_DELAYED", 3), ign)?.tipo, "atrasada");
    assert.equal(lerAssinatura("hotmart", hot("PURCHASE_REFUNDED"), ign)?.tipo, "reembolsada");
    const canc = lerAssinatura("hotmart", { event: "SUBSCRIPTION_CANCELLATION", data: { product: { id: 1234567 }, subscriber: { code: "SUB1", email: "ana@exemplo.com" }, subscription: { id: 99 } } }, ign);
    assert.equal(canc?.tipo, "cancelada");
    assert.equal(canc?.assinaturaRef, "SUB1");
    const kiwi = (evento: string, status = "paid") => ({ webhook_event_type: evento, order_status: status, order_id: `K-${evento}`, subscription_id: "ks1", Customer: { email: "bia@exemplo.com" }, Product: { product_id: "kp-1" }, Commissions: { charge_amount: 1990, currency: "BRL" } });
    assert.equal(lerAssinatura("kiwify", kiwi("order_approved"), ign)?.valor, 19.9);
    assert.equal(lerAssinatura("kiwify", kiwi("subscription_renewed"), ign)?.tipo, "renovada");
    assert.equal(lerAssinatura("kiwify", kiwi("subscription_canceled", "canceled"), ign)?.tipo, "cancelada");
    assert.equal(lerAssinatura("kiwify", kiwi("subscription_late", "waiting_payment"), ign)?.tipo, "atrasada");
    assert.equal(lerAssinatura("kiwify", { ...kiwi("order_approved"), subscription_id: undefined }, ign), null, "compra avulsa não é assinatura");
    const st = (type: string, object: Record<string, unknown>) => ({ type, livemode: true, data: { object } });
    const sess = lerAssinatura("stripe", st("checkout.session.completed", { id: "cs_1", mode: "subscription", payment_status: "paid", customer_details: { email: "c@exemplo.com" }, payment_link: "plink_1", subscription: "sub_1", amount_total: 900, currency: "usd" }), ign);
    assert.deepEqual([sess?.tipo, sess?.email, sess?.assinaturaRef, sess?.valor, sess?.moeda], ["aprovada", "c@exemplo.com", "sub_1", 9, "USD"]);
    assert.equal(lerAssinatura("stripe", st("checkout.session.completed", { id: "cs_2", mode: "payment", payment_status: "paid" }), ign), null);
    const fat = lerAssinatura("stripe", st("invoice.paid", { id: "in_2", billing_reason: "subscription_cycle", customer_email: "c@exemplo.com", subscription: "sub_1", amount_paid: 900, currency: "usd", lines: { data: [{ price: { product: "prod_1" } }] } }), ign);
    assert.deepEqual([fat?.tipo, fat?.produtos], ["renovada", ["prod_1"]]);
    assert.equal(lerAssinatura("stripe", st("invoice.paid", { id: "in_1", billing_reason: "subscription_create" }), ign), null, "a 1ª fatura já veio pelo checkout");
    assert.equal(lerAssinatura("stripe", st("invoice.payment_failed", { id: "in_3", customer_email: "c@exemplo.com", subscription: "sub_1" }), ign)?.tipo, "atrasada");
    const del = lerAssinatura("stripe", st("customer.subscription.deleted", { id: "sub_1", items: { data: [{ price: { product: "prod_1" } }] } }), ign);
    assert.deepEqual([del?.tipo, del?.email, del?.assinaturaRef], ["cancelada", null, "sub_1"]);
    // as outras: pelo leitor de vendas + o e-mail do comprador achado no aviso (o do bloco do comprador vence)
    assert.equal(acharEmail({ produtor: { email: "eu@produtor.com" }, buyer: { email: "Comprou@Exemplo.com" } }), "comprou@exemplo.com");
    const ed = lerAssinatura("eduzz", { data: { buyer: { email: "e@exemplo.com" } } }, { tipo: "venda", rawId: "E1", produtoRef: "ep-1", produtoId: "ep-1", valor: 19.9, moeda: "BRL" });
    assert.deepEqual([ed?.tipo, ed?.email, ed?.produtos, ed?.valor], ["aprovada", "e@exemplo.com", ["ep-1"], 19.9]);
  });

  test("o manifest e o service worker: o nome, as cores e os ícones da marca; o escopo do app; a tela guardada sem internet", async () => {
    const { lerApp } = await import("@/lib/app/pacote");
    const { manifestDe, swScript, caixas } = await import("@/lib/app/pwa");
    const lido = lerApp({ app: pacote() });
    assert.ok(lido.ok);
    if (!lido.ok) return;
    const m = manifestDe("noites-calmas", lido.app);
    assert.equal(m.scope, "/a/noites-calmas");
    assert.equal(m.display, "standalone");
    assert.equal(m.short_name, "Noites");
    assert.equal(m.background_color, "#12101A");
    assert.ok(m.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"));
    const sw = swScript("noites-calmas", 3);
    assert.match(sw, /const AUDIO = "app-noites-calmas-audio-v3"/);
    assert.match(sw, /req\.mode === "navigate"/);
    assert.doesNotMatch(sw, /\/audio\/"\)\) \{\s*e\.respondWith/, "o áudio não passa pelo service worker");
    assert.deepEqual(caixas("x", 2), { tela: "app-x-tela", audio: "app-x-audio-v2", prefixo: "app-x-" });
  });
});

const banco: TestDatabase | null = semBanco ? null : await createTestDatabase();

describe("app por assinatura (com banco)", { skip: semBanco }, () => {
  const db = banco as TestDatabase;
  let apps: typeof import("@/app/api/molde/apps/route");
  let publicar: typeof import("@/app/api/molde/apps/[id]/publicar/route");
  let hotmart: typeof import("@/app/api/webhooks/hotmart/route");
  let stripe: typeof import("@/app/api/webhooks/stripe/route");
  let entrar: typeof import("@/app/a/[slug]/entrar/route");
  let codigoRota: typeof import("@/app/a/[slug]/codigo/route");
  let linkOk: typeof import("@/app/a/[slug]/link/[token]/ok/route");
  let audio: typeof import("@/app/a/[slug]/audio/[id]/route");
  let uso: typeof import("@/app/a/[slug]/uso/route");
  let lembrete: typeof import("@/app/a/[slug]/lembrete/route");
  let sairLembrete: typeof import("@/app/a/[slug]/lembrete/sair/[codigo]/ok/route");
  let assinar: typeof import("@/app/a/[slug]/assinar/route");
  let manifest: typeof import("@/app/a/[slug]/manifest.webmanifest/route");
  let sw: typeof import("@/app/a/[slug]/sw.js/route");
  let dbApps: typeof import("@/lib/db/apps");
  let relogio: typeof import("@/lib/app/relogio");
  let signStripe: typeof import("@/lib/vendas/webhooks").signStripe;
  let appId = "";
  const SLUG = "noites-calmas";

  before(async () => {
    apps = await import("@/app/api/molde/apps/route");
    publicar = await import("@/app/api/molde/apps/[id]/publicar/route");
    hotmart = await import("@/app/api/webhooks/hotmart/route");
    stripe = await import("@/app/api/webhooks/stripe/route");
    entrar = await import("@/app/a/[slug]/entrar/route");
    codigoRota = await import("@/app/a/[slug]/codigo/route");
    linkOk = await import("@/app/a/[slug]/link/[token]/ok/route");
    audio = await import("@/app/a/[slug]/audio/[id]/route");
    uso = await import("@/app/a/[slug]/uso/route");
    lembrete = await import("@/app/a/[slug]/lembrete/route");
    sairLembrete = await import("@/app/a/[slug]/lembrete/sair/[codigo]/ok/route");
    assinar = await import("@/app/a/[slug]/assinar/route");
    manifest = await import("@/app/a/[slug]/manifest.webmanifest/route");
    sw = await import("@/app/a/[slug]/sw.js/route");
    dbApps = await import("@/lib/db/apps");
    relogio = await import("@/lib/app/relogio");
    signStripe = (await import("@/lib/vendas/webhooks")).signStripe;
  });
  after(async () => {
    meta.restore();
    await db.close();
  });

  const hot = (event: string, email: string, transaction: string, recurrence = 1) =>
    JSON.stringify({ event, creation_date: Date.now(), data: { buyer: { email }, product: { id: 1234567, name: "Noites Calmas" }, purchase: { transaction, recurrence_number: recurrence, approved_date: Date.now(), price: { value: 19.9, currency_value: "BRL" }, origin: {} }, subscription: { subscriber: { code: `SUB-${email}` } } } });
  const postHot = (body: string) => hotmart.POST(new NextRequest(new URL("/api/webhooks/hotmart", "https://uaiflow.teste"), { method: "POST", body, headers: { "content-type": "application/json", "x-hotmart-hottok": S.hotmart } }));
  const postStripe = (obj: Record<string, unknown>) => {
    const body = JSON.stringify(obj);
    return stripe.POST(new NextRequest(new URL("/api/webhooks/stripe", "https://uaiflow.teste"), { method: "POST", body, headers: { "content-type": "application/json", "stripe-signature": signStripe(body, S.stripe) } }));
  };
  const cookieDe = (r: Response) => (r.headers.getSetCookie().find((l) => l.startsWith("uf_a_noites_calmas=")) ?? "").split(";")[0].split("=")[1] ?? "";

  test("publicar: o pacote vai, os áudios vão PRIVADOS para o R2 e o app só abre com todos os áudios conferidos", async () => {
    const r = await apps.POST(request("/api/molde/apps", { headers: MOLDE, json: { molde: "proj-1", app: pacote(), produtoRefs: ["1234567", "plink_1"], audios: [{ id: "respira", contentType: "audio/mpeg", size: 5 }, { id: "som", contentType: "audio/wav", size: 4 }] } }));
    const j = (await r.json()) as { data: { id: string; slug: string; url: string; ativo: boolean; envios: Array<{ id: string; uploadUrl: string; headers: Record<string, string> }>; enderecos: { app: string; webhooks: Record<string, string> } } };
    assert.equal(r.status, 200, JSON.stringify(j));
    appId = j.data.id;
    assert.equal(j.data.slug, SLUG);
    assert.equal(j.data.ativo, false);
    assert.equal(j.data.enderecos.webhooks.hotmart, "https://uaiflow.teste/api/webhooks/hotmart");
    for (const e of j.data.envios) assert.match(new URL(e.uploadUrl).pathname, /^\/baldefalso\/uaiflow\/apps\//);
    assert.equal((await (await import("@/lib/content/r2")).isProtectedKey("uaiflow/apps/x/y.mp3")), true, "o áudio do app nunca sai com um post");
    const cedo = await publicar.POST(request(`/api/molde/apps/${appId}/publicar`, { headers: MOLDE, json: { molde: "proj-1" } }), routeParams({ id: appId }));
    assert.equal(cedo.status, 409);
    await fetch(j.data.envios[0].uploadUrl, { method: "PUT", headers: j.data.envios[0].headers, body: "ID3xy" });
    await fetch(j.data.envios[1].uploadUrl, { method: "PUT", headers: j.data.envios[1].headers, body: "RIFF" });
    const pub = await publicar.POST(request(`/api/molde/apps/${appId}/publicar`, { headers: MOLDE, json: { molde: "proj-1" } }), routeParams({ id: appId }));
    const pj = (await pub.json()) as { data: { ativo: boolean; audios: number; versao: number } };
    assert.equal(pub.status, 200, JSON.stringify(pj));
    assert.equal(pj.data.ativo, true);
    assert.equal(pj.data.audios, 2);
    // atualizar só o texto (sem áudios) mantém os áudios
    const r2 = await apps.POST(request("/api/molde/apps", { headers: MOLDE, json: { molde: "proj-1", id: appId, app: pacote({ convite: "Um toque por noite." }) } }));
    assert.equal(r2.status, 200);
    const [row] = await db.sql("select produto_refs, audios, pacote->>'convite' as convite from public.apps where id = $1", [appId]);
    assert.deepEqual(row.produto_refs, ["1234567", "plink_1"], "sem produtoRefs no pedido, os guardados ficam");
    assert.equal(Object.keys(row.audios).length, 2);
    assert.equal(row.convite, "Um toque por noite.");
    // o manifest, o service worker e o link de assinar com a origem do post
    const mf = await manifest.GET(request(`/a/${SLUG}/manifest.webmanifest`), routeParams({ slug: SLUG }));
    assert.match(String(mf.headers.get("content-type")), /manifest\+json/);
    assert.equal(((await mf.json()) as { start_url: string }).start_url, `/a/${SLUG}?de=app`);
    const s = await sw.GET(request(`/a/${SLUG}/sw.js`), routeParams({ slug: SLUG }));
    assert.match(await s.text(), /app-noites-calmas-audio-v/);
    const as = await assinar.GET(request(`/a/${SLUG}/assinar?o=mo1a2b3c`), routeParams({ slug: SLUG }));
    assert.equal(as.headers.get("location"), "https://pay.hotmart.com/X123?src=mo1a2b3c&sck=mo1a2b3c");
    // promessa proibida: o servidor recusa
    const ruim = await apps.POST(request("/api/molde/apps", { headers: MOLDE, json: { molde: "proj-1", app: pacote({ titulo: "Outro", promessa: "Trata a insônia de vez." }) } }));
    assert.equal(ruim.status, 400);
  });

  test("a assinatura pelo aviso da Hotmart: aprovada → acesso; renovada; o mesmo aviso não conta 2 vezes; cancelada → só a carência", async () => {
    const r1 = await postHot(hot("PURCHASE_APPROVED", "Ana@Exemplo.com", "HP-1"));
    assert.equal(r1.status, 200);
    assert.equal(((await r1.json()) as { app: string }).app, "aplicado");
    const [a1] = await db.sql("select status, acesso_ate > now() + interval '30 days' as longe, email from public.app_assinantes");
    assert.deepEqual({ ...a1 }, { status: "ativo", longe: true, email: "ana@exemplo.com" });
    assert.equal(((await (await postHot(hot("PURCHASE_APPROVED", "ana@exemplo.com", "HP-1"))).json()) as { app: string }).app, "repetido");
    assert.equal(((await (await postHot(hot("PURCHASE_COMPLETE", "ana@exemplo.com", "HP-1"))).json()) as { app: string }).app, "repetido", "a compra completa (fim da garantia) é a mesma compra");
    await postHot(hot("PURCHASE_APPROVED", "ana@exemplo.com", "HP-2", 2));
    const pags = await db.sql("select tipo from public.app_pagamentos order by id");
    assert.deepEqual(pags.map((p) => p.tipo), ["aprovada", "renovada"]);
    // um produto que não é de app nenhum: nada muda
    const outro = JSON.parse(hot("PURCHASE_APPROVED", "ze@exemplo.com", "HP-9"));
    outro.data.product.id = 999;
    assert.equal(((await (await postHot(JSON.stringify(outro))).json()) as { app?: string }).app, "sem_app");
    // cancelada: o acesso vai até a carência (3 dias)
    const canc = JSON.stringify({ event: "SUBSCRIPTION_CANCELLATION", creation_date: Date.now(), data: { product: { id: 1234567 }, subscriber: { code: "SUB-ana@exemplo.com", email: "ana@exemplo.com" }, subscription: { id: 7 }, cancellation_date: Date.now() } });
    assert.equal(((await (await postHot(canc)).json()) as { app: string }).app, "aplicado");
    const [a2] = await db.sql("select status, acesso_ate between now() + interval '2 days' and now() + interval '4 days' as carencia from public.app_assinantes where email = 'ana@exemplo.com'");
    assert.deepEqual({ ...a2 }, { status: "cancelada", carencia: true });
  });

  test("Stripe: o checkout cria a assinatura; o cancelamento sem e-mail acha a pessoa pelo código da assinatura", async () => {
    const sess = await postStripe({ type: "checkout.session.completed", livemode: true, data: { object: { id: "cs_10", mode: "subscription", payment_status: "paid", customer_details: { email: "carla@exemplo.com" }, payment_link: "plink_1", subscription: "sub_10", amount_total: 1990, currency: "brl", created: Math.floor(Date.now() / 1000) } } });
    assert.equal(sess.status, 200);
    assert.equal(((await sess.json()) as { app: string }).app, "aplicado");
    const del = await postStripe({ type: "customer.subscription.deleted", livemode: true, data: { object: { id: "sub_10", canceled_at: Math.floor(Date.now() / 1000), items: { data: [{ price: { product: "prod_nao_cadastrado" } }] } } } });
    assert.equal(((await del.json()) as { app: string }).app, "aplicado");
    const [c] = await db.sql("select status from public.app_assinantes where email = 'carla@exemplo.com'");
    assert.equal(c.status, "cancelada");
  });

  test("entrar sem senha: o link e o código por e-mail; o áudio só com acesso; o uso do dia; o lembrete", async () => {
    // a Bia assina (Hotmart)
    await postHot(hot("PURCHASE_APPROVED", "bia@exemplo.com", "HP-B1"));
    const enviados: Array<{ to: string[]; subject: string; text: string }> = [];
    const antes = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).startsWith("https://api.resend.com/")) {
        enviados.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "e1" }), { status: 200 });
      }
      return antes(url, init);
    }) as typeof fetch;
    Object.assign(process.env, { RESEND_API_KEY: "re_falsa", EMAIL_REMETENTE: "Lua <oi@lua.teste>" });
    const ip = (n: number) => ({ "x-forwarded-for": `10.0.0.${n}` });
    try {
      // sem o envio de e-mail: a frase (ninguém entra sem e-mail)
      delete process.env.RESEND_API_KEY;
      const sem = await entrar.POST(request(`/a/${SLUG}/entrar`, { form: { email: "bia@exemplo.com" }, headers: ip(1) }), routeParams({ slug: SLUG }));
      assert.match(String(sem.headers.get("location")), /erro=semEmail/);
      process.env.RESEND_API_KEY = "re_falsa";
      const r = await entrar.POST(request(`/a/${SLUG}/entrar`, { form: { email: "Bia@Exemplo.com" }, headers: ip(2) }), routeParams({ slug: SLUG }));
      assert.match(String(r.headers.get("location")), /\/a\/noites-calmas\?enviado=bia%40exemplo\.com#entrar/);
      assert.equal(enviados.length, 1);
      const link = enviados[0].text.match(/\/a\/noites-calmas\/link\/([a-z0-9]{32})/)?.[1] ?? "";
      const codigo = enviados[0].text.match(/\n(\d{6})\n/)?.[1] ?? "";
      assert.ok(link && codigo, enviados[0].text);
      // quem não assina recebe (só no e-mail dele) o convite; a tela responde igual
      const nao = await entrar.POST(request(`/a/${SLUG}/entrar`, { form: { email: "nao@exemplo.com" }, headers: ip(3) }), routeParams({ slug: SLUG }));
      assert.match(String(nao.headers.get("location")), /enviado=nao%40exemplo\.com/);
      assert.match(enviados[1].text, /\/a\/noites-calmas\/assinar/);
      // o código errado não entra; o certo entra (e vale uma vez)
      const errado = await codigoRota.POST(request(`/a/${SLUG}/codigo`, { form: { email: "bia@exemplo.com", codigo: codigo === "000000" ? "111111" : "000000" }, headers: ip(4) }), routeParams({ slug: SLUG }));
      assert.match(String(errado.headers.get("location")), /erro=codigo/);
      const certo = await codigoRota.POST(request(`/a/${SLUG}/codigo`, { form: { email: "bia@exemplo.com", codigo }, headers: ip(5) }), routeParams({ slug: SLUG }));
      const sessao = cookieDe(certo);
      assert.match(sessao, /^[a-z0-9]{40}$/);
      assert.match(certo.headers.getSetCookie().join(";"), /HttpOnly/i);
      assert.match(certo.headers.getSetCookie().join(";"), /Path=\/a\/noites-calmas/i);
      const deNovo = await linkOk.POST(request(`/a/${SLUG}/link/${link}/ok`, { method: "POST" }), routeParams({ slug: SLUG, token: link }));
      assert.match(String(deNovo.headers.get("location")), /erro=vencido/, "o link e o código são o mesmo acesso: usado uma vez");
      // o áudio: sem sessão, 403; com a sessão, o link assinado do R2 (privado)
      const semSessao = await audio.GET(request(`/a/${SLUG}/audio/respira`), routeParams({ slug: SLUG, id: "respira" }));
      assert.equal(semSessao.status, 403);
      const comSessao = await audio.GET(request(`/a/${SLUG}/audio/respira`, { cookies: { uf_a_noites_calmas: sessao } }), routeParams({ slug: SLUG, id: "respira" }));
      assert.equal(comSessao.status, 302);
      const destino = new URL(String(comSessao.headers.get("location")));
      assert.match(destino.host, /r2\.cloudflarestorage\.com$/);
      assert.ok(destino.searchParams.get("X-Amz-Signature"));
      assert.equal(destino.searchParams.get("X-Amz-Expires"), "900");
      // o uso do dia (uma vez por dia) e o fuso do aparelho
      const u1 = await uso.POST(request(`/a/${SLUG}/uso`, { json: { noite: 1, fuso: "America/New_York" }, cookies: { uf_a_noites_calmas: sessao } }), routeParams({ slug: SLUG }));
      assert.equal(((await u1.json()) as { novo: boolean }).novo, true);
      const u2 = await uso.POST(request(`/a/${SLUG}/uso`, { json: { noite: 1 }, cookies: { uf_a_noites_calmas: sessao } }), routeParams({ slug: SLUG }));
      assert.equal(((await u2.json()) as { novo: boolean }).novo, false);
      const [b] = await db.sql("select fuso, id from public.app_assinantes where email = 'bia@exemplo.com'");
      assert.equal(b.fuso, "America/New_York");
      // o lembrete: ligado às 0 h (já passou) → o relógio manda 1, só para quem não tocou hoje
      const l = await lembrete.POST(request(`/a/${SLUG}/lembrete`, { json: { ativo: true, hora: 0, fuso: "America/New_York" }, cookies: { uf_a_noites_calmas: sessao } }), routeParams({ slug: SLUG }));
      assert.equal(l.status, 200);
      const mandados: Array<{ para: string; texto: string; descadastrarUrl?: string | null }> = [];
      const enviar = async (_c: unknown, m: { para: string; texto: string; descadastrarUrl?: string | null }) => void mandados.push(m);
      assert.equal((await relogio.runAppClock({ deadline: Date.now() + 8000, enviar })).enviados, 0, "a Bia já tocou hoje: nada de lembrete");
      await db.sql("delete from public.app_uso where assinante_id = $1", [b.id]);
      const c1 = await relogio.runAppClock({ deadline: Date.now() + 8000, enviar });
      assert.equal(c1.enviados, 1);
      assert.match(mandados[0].texto, /Hora de desacelerar/);
      assert.match(mandados[0].texto, /Noite 1 de 30/);
      assert.match(String(mandados[0].descadastrarUrl), /\/a\/noites-calmas\/lembrete\/sair\/[a-z0-9]{24}\/ok$/);
      assert.equal((await relogio.runAppClock({ deadline: Date.now() + 8000, enviar })).enviados, 0, "um por dia");
      const codigoSair = String(mandados[0].descadastrarUrl).match(/sair\/([a-z0-9]{24})\/ok/)?.[1] ?? "";
      const sair = await sairLembrete.POST(request(`/a/${SLUG}/lembrete/sair/${codigoSair}/ok`, { method: "POST" }), routeParams({ slug: SLUG, codigo: codigoSair }));
      assert.equal(sair.status, 303);
      const [b2] = await db.sql("select lembrete from public.app_assinantes where id = $1", [b.id]);
      assert.equal(b2.lembrete, false);
      // a assinatura reembolsada vence depois da carência: o áudio fecha
      await postHot(hot("PURCHASE_REFUNDED", "bia@exemplo.com", "HP-B1"));
      await db.sql("update public.app_assinantes set acesso_ate = now() - interval '1 minute' where id = $1", [b.id]);
      const fechado = await audio.GET(request(`/a/${SLUG}/audio/respira`, { cookies: { uf_a_noites_calmas: sessao } }), routeParams({ slug: SLUG, id: "respira" }));
      assert.equal(fechado.status, 403);
    } finally {
      globalThis.fetch = antes;
      for (const k of ["RESEND_API_KEY", "EMAIL_REMETENTE"]) delete process.env[k];
    }
  });

  test("os números do teste: ativos, cancelamentos, retenção no 2º mês, uso e receita mensal (sem e-mail nenhum)", async () => {
    // uma assinante antiga (40 dias) que renovou e usou 4 dias da semana
    const [ant] = await db.sql(`insert into public.app_assinantes (app_id, email, status, inicio_em, acesso_ate, sair_codigo) values ($1, 'dani@exemplo.com', 'ativo', now() - interval '40 days', now() + interval '20 days', 'saircodigo0000000000dani') returning id`, [appId]);
    await db.sql(`insert into public.app_pagamentos (app_id, assinante_id, plataforma, raw_id, tipo, valor, moeda, em) values ($1, $2, 'hotmart', 'D1', 'aprovada', 19.9, 'BRL', now() - interval '40 days'), ($1, $2, 'hotmart', 'D2', 'renovada', 19.9, 'BRL', now() - interval '9 days')`, [appId, ant.id]);
    for (let i = 0; i < 4; i += 1) await db.sql(`insert into public.app_uso (assinante_id, dia) values ($1, ((now() at time zone 'America/Sao_Paulo')::date - $2::int))`, [ant.id, i]);
    const r = await apps.GET(request("/api/molde/apps?molde=proj-1", { headers: MOLDE }));
    const j = (await r.json()) as { data: Array<{ slug: string; url: string; numeros: import("@/lib/app/rotina").NumerosApp }> };
    assert.equal(r.status, 200);
    const n = j.data[0].numeros;
    assert.equal(j.data[0].url, "https://uaiflow.teste/a/noites-calmas");
    assert.ok(n.ativos >= 1);
    assert.ok(n.cancelamentos30 >= 2, "a Ana (cancelou), a Carla (Stripe) e a Bia (reembolso)");
    assert.deepEqual(n.retencao2, { elegiveis: 1, retidos: 1, taxa: 1 });
    assert.equal(n.uso.tocaramHoje, 1);
    // com acesso agora: a Ana e a Carla (na carência) e a Dani (4 dias seguidos): a média é 4 ÷ 3
    assert.equal(n.uso.seguidosMedia, 1.3);
    assert.equal(n.uso.quatroDias, 0.33);
    assert.ok((n.mrr.BRL ?? 0) >= 19.9);
    assert.ok((n.receita30.BRL ?? 0) > 0);
    assert.equal(n.diasDeTeste, 0);
    assert.doesNotMatch(JSON.stringify(j), /@exemplo\.com/, "nenhum e-mail sai para o Molde");
    assert.equal(dbApps.MIGRATION_0018.includes("0018"), true);
  });
});
