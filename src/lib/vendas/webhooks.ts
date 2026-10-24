import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { acharOrigem, codigoOrigem } from "@/lib/vendas/origem";

/**
 * Vendas por webhook: conferência de cada plataforma e leitura do aviso. Guarda o mínimo (sem e-mail nem nome de
 * cliente). Cada plataforma só é aceita com o seu segredo nas variáveis do servidor.
 */
export const PLATAFORMAS_0010 = ["stripe", "whop", "gumroad", "payhip", "cakto"] as const;
/** As plataformas novas (0012): o banco só as aceita depois da atualização 0012 (antes disso o aviso responde 503). */
export const PLATAFORMAS_0012 = ["hotmart", "kiwify", "eduzz", "monetizze", "braip", "ticto", "perfectpay", "digistore24", "clickbank", "lemonsqueezy"] as const;
export const PLATAFORMAS = [...PLATAFORMAS_0010, ...PLATAFORMAS_0012] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];

export function isPlataforma0012(plataforma: Plataforma) {
  return (PLATAFORMAS_0012 as readonly string[]).includes(plataforma);
}

export type VendaEvento =
  | { tipo: "ignorar"; motivo: string }
  | {
      tipo: "venda" | "reembolso" | "contestacao";
      rawId: string;
      pagamentoId?: string | null;
      produtoRef?: string | null;
      produtoId?: string | null;
      produtoNome?: string | null;
      valor?: number;
      moeda?: string;
      /** No reembolso: quanto voltou (na unidade da moeda) e se foi tudo. */
      valorReembolsado?: number;
      reembolsoTotal?: boolean;
      teste?: boolean;
      criadoEm?: Date | null;
      /** O código da origem do post (mo…) que voltou no aviso (0012). null/ausente = venda sem origem conhecida. */
      origem?: string | null;
    };

/** Tolerância de horário das assinaturas (Stripe e Whop): 5 min. */
export const TOLERANCIA_SEGUNDOS = 300;

function safeEqualBuffers(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Compara dois textos sem pista pelo tempo (hash antes, para terem o mesmo tamanho). Vazio nunca confere. */
export function safeEqualText(provided: string | null | undefined, expected: string | null | undefined) {
  if (!provided || !expected) return false;
  return timingSafeEqual(createHash("sha256").update(provided, "utf8").digest(), createHash("sha256").update(expected, "utf8").digest());
}

/** Stripe-Signature: "t=<segundos>,v1=<hex>[,v1=...]"; assinatura = HMAC-SHA256(segredo whsec_..., "<t>.<corpo cru>"). */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = header.split(",").map((part) => part.trim().split("="));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value ?? "");
  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(nowSeconds - timestamp) > TOLERANCIA_SEGUNDOS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
  return signatures.some((signature) => /^[0-9a-f]+$/i.test(signature) && safeEqualBuffers(Buffer.from(signature, "hex"), expected));
}

/** Monta a Stripe-Signature (só para os testes e para conferir à mão). */
export function signStripe(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;
}

/**
 * Whop (Standard Webhooks): webhook-id, webhook-timestamp, webhook-signature ("v1,<base64>", pode vir mais de uma,
 * separadas por espaço). Assinatura = HMAC-SHA256 de "<id>.<timestamp>.<corpo cru>". A Whop diz para usar o segredo
 * ws_... como está; um segredo whsec_... (padrão Standard Webhooks) também é aceito, com a parte depois do prefixo em base64.
 */
export function standardWebhookKeys(secret: string) {
  const keys = [Buffer.from(secret, "utf8")];
  if (secret.startsWith("whsec_")) keys.push(Buffer.from(secret.slice(6), "base64"));
  return keys;
}

export function verifyStandardWebhook(rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!headers.id || !headers.timestamp || !headers.signature || !secret) return false;
  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > TOLERANCIA_SEGUNDOS) return false;
  const content = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const given = headers.signature.split(" ").map((item) => item.trim()).filter((item) => item.startsWith("v1,")).map((item) => Buffer.from(item.slice(3), "base64"));
  if (!given.length) return false;
  return standardWebhookKeys(secret).some((key) => {
    const expected = createHmac("sha256", key).update(content, "utf8").digest();
    return given.some((signature) => safeEqualBuffers(signature, expected));
  });
}

export function signStandardWebhook(rawBody: string, secret: string, id: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${timestamp}.${rawBody}`, "utf8").digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${signature}` };
}

/** Payhip: o campo `signature` do corpo é sha256 (hex) da chave de API (Configurações → Desenvolvedor). */
export function verifyPayhipSignature(signature: unknown, apiKey: string) {
  if (typeof signature !== "string" || !apiKey) return false;
  return safeEqualText(signature.trim().toLowerCase(), createHash("sha256").update(apiKey, "utf8").digest("hex"));
}

/* ---------------- Leitura de cada plataforma ---------------- */

/** Moedas sem centavos na Stripe (o valor já vem inteiro). */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

export function fromMinor(amount: unknown, currency: string) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? value : Math.round(value) / 100;
}

export function decimal(value: unknown) {
  const number = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

export function text(value: unknown, max = 200) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export function moeda(value: unknown, fallback = "USD") {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

export function dateFrom(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "number" || /^\d+$/.test(String(value)) ? new Date(Number(value) * (Number(value) < 1e12 ? 1000 : 1)) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Um parâmetro de um link (checkout), se houver. */
function paramFromUrl(value: unknown, name: string) {
  if (typeof value !== "string" || !value) return null;
  try {
    return new URL(value).searchParams.get(name);
  } catch {
    return null;
  }
}

/** ?ref= de um link (checkout), se houver. */
function refFromUrl(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return text(url.searchParams.get("ref") || url.searchParams.get("produto_ref"), 120);
  } catch {
    return null;
  }
}

export type Json = Record<string, unknown>;
export const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});

export function parseStripeEvent(event: Json): VendaEvento {
  const type = String(event.type ?? "");
  const data = obj(obj(event.data).object);
  const teste = event.livemode === false;
  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    if (type === "checkout.session.completed" && data.payment_status === "unpaid") return { tipo: "ignorar", motivo: "pagamento ainda não confirmado" };
    const currency = moeda(data.currency);
    const metadata = obj(data.metadata);
    const rawId = text(data.id);
    if (!rawId) return { tipo: "ignorar", motivo: "sem id" };
    // client_reference_id: a origem do post (mo…, contrato v131) ou, como antes, a referência do produto.
    const origem = acharOrigem([data.client_reference_id, metadata.molde_origem, metadata.origem]);
    const clientRef = codigoOrigem(data.client_reference_id) ? null : text(data.client_reference_id, 120);
    return {
      tipo: "venda",
      rawId,
      origem,
      pagamentoId: text(data.payment_intent),
      produtoRef: text(metadata.produto_ref, 120) ?? text(metadata.ref, 120) ?? clientRef ?? text(data.payment_link),
      produtoId: text(data.payment_link) ?? text(metadata.product_id),
      produtoNome: text(metadata.produto_nome) ?? text(metadata.product_name),
      valor: fromMinor(data.amount_total, currency),
      moeda: currency,
      teste,
      criadoEm: dateFrom(data.created),
    };
  }
  if (type === "charge.refunded") {
    const currency = moeda(data.currency);
    const rawId = text(data.id);
    if (!rawId) return { tipo: "ignorar", motivo: "sem id" };
    const amount = fromMinor(data.amount, currency);
    const refunded = fromMinor(data.amount_refunded, currency);
    return { tipo: "reembolso", rawId, pagamentoId: text(data.payment_intent), valorReembolsado: refunded, reembolsoTotal: data.refunded === true || refunded >= amount, valor: amount, moeda: currency, teste };
  }
  if (type === "charge.dispute.created") {
    const rawId = text(data.charge) ?? text(data.id);
    if (!rawId) return { tipo: "ignorar", motivo: "sem id" };
    const currency = moeda(data.currency);
    return { tipo: "contestacao", rawId, pagamentoId: text(data.payment_intent), valor: fromMinor(data.amount, currency), moeda: currency, teste };
  }
  return { tipo: "ignorar", motivo: `evento ${type || "sem tipo"} não usado` };
}

export function parseWhopEvent(event: Json): VendaEvento {
  const type = String(event.type ?? event.action ?? "");
  const data = obj(event.data);
  if (type === "payment.succeeded") {
    const rawId = text(data.id);
    if (!rawId) return { tipo: "ignorar", motivo: "sem id" };
    const product = obj(data.product);
    const metadata = obj(data.metadata);
    return {
      tipo: "venda",
      rawId,
      produtoRef: text(metadata.produto_ref, 120) ?? text(metadata.ref, 120) ?? text(product.id),
      produtoId: text(product.id),
      produtoNome: text(product.title) ?? text(product.name),
      valor: decimal(data.total ?? data.final_amount ?? data.subtotal),
      moeda: moeda(data.currency),
      criadoEm: dateFrom(data.paid_at ?? data.created_at),
    };
  }
  if (type === "payment.refunded" || type === "refund.created" || type === "refund.updated") {
    if (type !== "payment.refunded" && ["failed", "canceled", "cancelled", "pending"].includes(String(data.status ?? "").toLowerCase())) {
      return { tipo: "ignorar", motivo: "reembolso ainda não concluído" };
    }
    const paymentId = type === "payment.refunded" ? text(data.id) : text(obj(data.payment).id) ?? text(data.payment_id);
    if (!paymentId) return { tipo: "ignorar", motivo: "sem id do pagamento" };
    const total = decimal(data.total ?? obj(data.payment).total);
    const refunded = decimal(type === "payment.refunded" ? data.refunded_amount ?? data.total : data.amount);
    return { tipo: "reembolso", rawId: paymentId, pagamentoId: paymentId, valorReembolsado: refunded, reembolsoTotal: !total || refunded >= total, moeda: moeda(data.currency) };
  }
  if (type === "dispute.created") {
    const paymentId = text(obj(data.payment).id) ?? text(data.payment_id);
    if (!paymentId) return { tipo: "ignorar", motivo: "sem id do pagamento" };
    return { tipo: "contestacao", rawId: paymentId, pagamentoId: paymentId };
  }
  return { tipo: "ignorar", motivo: `evento ${type || "sem tipo"} não usado` };
}

/** Gumroad "ping": formulário (x-www-form-urlencoded). resource_name: sale, refund, dispute... */
export function parseGumroadPing(form: URLSearchParams): VendaEvento {
  const resource = form.get("resource_name") || "sale";
  const rawId = text(form.get("sale_id"));
  if (!rawId) return { tipo: "ignorar", motivo: "sem sale_id" };
  const currency = moeda(form.get("currency"));
  const base = {
    rawId,
    origem: acharOrigem([form.get("url_params[utm_content]"), form.get("url_params[src]"), form.get("url_params[sck]"), form.get("url_params[molde_origem]")]),
    produtoRef: text(form.get("url_params[ref]"), 120) ?? text(form.get("url_params[produto_ref]"), 120) ?? text(form.get("product_permalink") ? lastPath(form.get("product_permalink") as string) : null) ?? text(form.get("short_product_id")) ?? text(form.get("product_id")),
    produtoId: text(form.get("product_id")),
    produtoNome: text(form.get("product_name")),
    valor: fromMinor(form.get("price"), currency),
    moeda: currency,
    teste: form.get("test") === "true",
    criadoEm: dateFrom(form.get("sale_timestamp")),
  };
  if (resource === "refund" || form.get("refunded") === "true") return { ...base, tipo: "reembolso", pagamentoId: rawId, valorReembolsado: base.valor, reembolsoTotal: true };
  if (resource === "dispute" || form.get("disputed") === "true") return { ...base, tipo: "contestacao", pagamentoId: rawId };
  if (resource !== "sale") return { tipo: "ignorar", motivo: `evento ${resource} não usado` };
  return { ...base, tipo: "venda" };
}

function lastPath(value: string) {
  try {
    return new URL(value).pathname.split("/").filter(Boolean).pop() ?? null;
  } catch {
    return value.split("/").filter(Boolean).pop() ?? null;
  }
}

export function parsePayhipEvent(event: Json): VendaEvento {
  const type = String(event.type ?? "");
  const rawId = text(event.id);
  if (!rawId) return { tipo: "ignorar", motivo: "sem id" };
  const currency = moeda(event.currency);
  const items = Array.isArray(event.items) ? event.items.map(obj) : [];
  const keys = items.map((item) => text(item.product_key) ?? text(item.product_id)).filter(Boolean) as string[];
  const base = {
    rawId,
    produtoRef: keys.length ? keys.join("+").slice(0, 120) : null,
    produtoId: items.length === 1 ? text(items[0].product_id) : keys.join("+").slice(0, 200) || null,
    produtoNome: items.length === 1 ? text(items[0].product_name) : items.length ? `${items.length} produtos` : null,
    valor: fromMinor(event.price, currency),
    moeda: currency,
    criadoEm: dateFrom(event.date),
  };
  if (type === "paid") return { ...base, tipo: "venda" };
  if (type === "refunded") {
    const refunded = event.amount_refunded !== undefined ? fromMinor(event.amount_refunded, currency) : base.valor;
    return { ...base, tipo: "reembolso", pagamentoId: rawId, valorReembolsado: refunded, reembolsoTotal: refunded >= base.valor };
  }
  return { tipo: "ignorar", motivo: `evento ${type || "sem tipo"} não usado` };
}

/** Cakto: { secret, event, data }. purchase_approved = venda; refund = reembolso; chargeback = contestação. */
export function parseCaktoEvent(event: Json): VendaEvento {
  const type = String(event.event ?? "");
  const data = obj(event.data);
  const rawId = text(data.id);
  if (!rawId) return { tipo: "ignorar", motivo: "sem id" };
  const product = obj(data.product);
  const base = {
    rawId,
    origem: acharOrigem([paramFromUrl(data.checkoutUrl, "utm_content"), paramFromUrl(data.checkoutUrl, "src"), paramFromUrl(data.checkoutUrl, "sck"), data.utm_content, data.src, data.sck]),
    pagamentoId: text(data.refId),
    produtoRef: refFromUrl(data.checkoutUrl) ?? text(product.short_id) ?? text(product.id),
    produtoId: text(product.id),
    produtoNome: text(product.name),
    valor: decimal(data.amount ?? data.baseAmount),
    moeda: "BRL",
    criadoEm: dateFrom(data.paidAt ?? data.createdAt),
  };
  if (type === "purchase_approved") return { ...base, tipo: "venda" };
  if (type === "refund") return { ...base, tipo: "reembolso", valorReembolsado: base.valor, reembolsoTotal: true };
  if (type === "chargeback") return { ...base, tipo: "contestacao" };
  return { tipo: "ignorar", motivo: `evento ${type || "sem tipo"} não usado` };
}
