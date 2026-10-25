/**
 * Os avisos de venda que mexem numa assinatura do app (0018), lidos do MESMO aviso que já chega por webhook (lib/vendas/handler):
 * a assinatura é casada pelo código do produto na plataforma (apps.produto_refs) e pela pessoa pelo e-mail do comprador.
 *
 * Hotmart, Kiwify e Stripe: compra, renovação, atraso, cancelamento, reembolso e chargeback, cada um pelo seu evento.
 * As outras 12 plataformas: pelo que o leitor de vendas já entende (venda → pagamento; reembolso; chargeback), com o e-mail achado
 * no aviso. Nelas, sem aviso de renovação, o acesso vence sozinho 31 dias (+ a carência) depois do último pagamento.
 * Puro: nada de banco. Só o e-mail sai daqui (é o que dá o acesso); o resto do comprador não é lido.
 */
import { decimal, fromMinor, moeda, obj, type Json, type Plataforma, type VendaEvento } from "@/lib/vendas/webhooks";
import type { TipoPagamento } from "@/lib/app/rotina";

export type AvisoAssinatura = {
  tipo: TipoPagamento;
  /** O código deste aviso (o mesmo aviso de novo não conta duas vezes). */
  rawId: string;
  email: string | null;
  /** Os códigos de produto do aviso (qualquer um que bata com apps.produto_refs). */
  produtos: string[];
  /** O código da assinatura na plataforma (casa avisos sem e-mail). */
  assinaturaRef: string | null;
  valor: number;
  moeda: string;
  teste: boolean;
  em: Date | null;
};

const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;
export function emailDe(value: unknown) {
  const t = typeof value === "string" ? value.trim().toLowerCase() : "";
  return EMAIL.test(t) && t.length <= 254 ? t : null;
}
function t(value: unknown, max = 120) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}
function lista(...valores: unknown[]) {
  return Array.from(new Set(valores.map((v) => t(v)).filter(Boolean) as string[]));
}
function data(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  const d = Number.isFinite(n) && /^\d+$/.test(String(value)) ? new Date(n * (n < 1e12 ? 1000 : 1)) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** O e-mail do comprador em qualquer lugar do aviso (para as plataformas sem leitor próprio): primeiro nos blocos do comprador. */
export function acharEmail(corpo: unknown): string | null {
  const preferidos = /^(buyer|customer|cliente|comprador|subscriber|assinante|client|payer|purchaser|billing|customer_details|contact)$/i;
  const chaves = /^(e-?mail|email_address|buyer_email|customer_email|cus_email|client_email|payer_email|contact_email|cliente_email|comprador_email)$/i;
  const fila: Array<{ v: unknown; nota: number }> = [{ v: corpo, nota: 0 }];
  let melhor: { email: string; nota: number } | null = null;
  for (let i = 0; i < fila.length && i < 400; i += 1) {
    const { v, nota } = fila[i];
    if (!v || typeof v !== "object") continue;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (chaves.test(k)) {
        const e = emailDe(x);
        if (e && (!melhor || nota > melhor.nota)) melhor = { email: e, nota };
      } else if (x && typeof x === "object") fila.push({ v: x, nota: preferidos.test(k) ? nota + 2 : nota - 1 });
    }
  }
  return melhor?.email ?? null;
}

/* ---------------- Hotmart (webhook 2.0.0) ---------------- */
function hotmart(corpo: Json): AvisoAssinatura | null {
  const evento = String(corpo.event ?? "").toUpperCase();
  const d = obj(corpo.data);
  const produto = obj(d.product);
  const produtos = lista(produto.id, produto.ucode);
  if (evento === "SUBSCRIPTION_CANCELLATION") {
    const sub = obj(d.subscription), subscriber = obj(d.subscriber);
    const ref = t(subscriber.code) ?? t(sub.id);
    return { tipo: "cancelada", rawId: `cancel:${t(sub.id) ?? ref ?? t(corpo.id) ?? ""}`, email: emailDe(subscriber.email), produtos, assinaturaRef: ref, valor: 0, moeda: "BRL", teste: false, em: data(d.cancellation_date ?? corpo.creation_date) };
  }
  const compra = obj(d.purchase);
  const rawId = t(compra.transaction);
  if (!rawId) return null;
  const preco = obj(Object.keys(obj(compra.full_price)).length ? compra.full_price : compra.price);
  const sub = obj(d.subscription);
  const ref = t(obj(sub.subscriber).code) ?? t(sub.id);
  const base = { rawId, email: emailDe(obj(d.buyer).email), produtos, assinaturaRef: ref, valor: decimal(preco.value), moeda: moeda(preco.currency_value, "BRL"), teste: false, em: data(compra.approved_date ?? compra.order_date ?? corpo.creation_date) };
  if (evento === "PURCHASE_APPROVED" || evento === "PURCHASE_COMPLETE") return { ...base, tipo: Number(compra.recurrence_number) > 1 ? "renovada" : "aprovada" };
  if (evento === "PURCHASE_DELAYED") return { ...base, tipo: "atrasada", valor: 0 };
  if (evento === "PURCHASE_REFUNDED") return { ...base, tipo: "reembolsada" };
  if (evento === "PURCHASE_CHARGEBACK") return { ...base, tipo: "chargeback" };
  return null;
}

/* ---------------- Kiwify ---------------- */
function kiwify(corpo: Json): AvisoAssinatura | null {
  const evento = String(corpo.webhook_event_type ?? "").toLowerCase();
  const status = String(corpo.order_status ?? "").toLowerCase();
  const rawId = t(corpo.order_id) ?? t(corpo.order_ref);
  const produto = obj(corpo.Product), sub = obj(corpo.Subscription), comissoes = obj(corpo.Commissions);
  const cur = moeda(comissoes.currency, "BRL");
  const base = {
    rawId: rawId ?? "",
    email: emailDe(obj(corpo.Customer).email),
    produtos: lista(produto.product_id),
    assinaturaRef: t(corpo.subscription_id) ?? t(sub.id),
    valor: fromMinor(comissoes.charge_amount ?? comissoes.product_base_price, cur),
    moeda: cur,
    teste: false,
    em: data(corpo.approved_date ?? corpo.updated_at ?? corpo.created_at),
  };
  if (!base.assinaturaRef && !/^subscription_/.test(evento)) return null; // compra avulsa: não é assinatura
  if (evento === "subscription_canceled") return { ...base, tipo: "cancelada", rawId: `cancel:${base.assinaturaRef ?? rawId ?? ""}`, valor: 0 };
  if (evento === "subscription_late") return { ...base, tipo: "atrasada", rawId: `late:${rawId ?? base.assinaturaRef ?? ""}`, valor: 0 };
  if (!rawId) return null;
  if (evento === "chargeback" || status === "chargedback") return { ...base, tipo: "chargeback" };
  if (evento === "order_refunded" || status === "refunded") return { ...base, tipo: "reembolsada" };
  if (evento === "subscription_renewed") return { ...base, tipo: "renovada" };
  if (evento === "order_approved" || status === "paid" || status === "approved") return { ...base, tipo: "aprovada" };
  return null;
}

/* ---------------- Stripe (Payment Link de preço recorrente) ---------------- */
function produtosDaFatura(fatura: Json) {
  const linhas = Array.isArray(obj(fatura.lines).data) ? (obj(fatura.lines).data as unknown[]).map(obj) : [];
  return lista(...linhas.flatMap((l) => [obj(l.price).product, obj(l.plan).product, obj(obj(l.pricing).price_details).product]));
}
function assinaturaDaFatura(fatura: Json) {
  return t(fatura.subscription) ?? t(obj(obj(fatura.parent).subscription_details).subscription);
}
function stripe(corpo: Json): AvisoAssinatura | null {
  const tipo = String(corpo.type ?? "");
  const d = obj(obj(corpo.data).object);
  const teste = corpo.livemode === false;
  if (tipo === "checkout.session.completed" || tipo === "checkout.session.async_payment_succeeded") {
    if (d.mode !== "subscription" || d.payment_status === "unpaid") return null;
    const rawId = t(d.id);
    if (!rawId) return null;
    const cur = moeda(d.currency);
    const md = obj(d.metadata);
    return { tipo: "aprovada", rawId, email: emailDe(obj(d.customer_details).email) ?? emailDe(d.customer_email), produtos: lista(d.payment_link, md.produto_ref, md.product_id), assinaturaRef: t(d.subscription), valor: fromMinor(d.amount_total, cur), moeda: cur, teste, em: data(d.created) };
  }
  if (tipo === "invoice.paid" || tipo === "invoice.payment_succeeded" || tipo === "invoice.payment_failed") {
    const rawId = t(d.id);
    if (!rawId) return null;
    // a 1ª fatura da assinatura já veio pelo checkout: só as renovações (e os atrasos) contam aqui
    if (tipo !== "invoice.payment_failed" && d.billing_reason !== "subscription_cycle") return null;
    const cur = moeda(d.currency);
    const base = { rawId, email: emailDe(d.customer_email), produtos: produtosDaFatura(d), assinaturaRef: assinaturaDaFatura(d), moeda: cur, teste, em: data(d.created) };
    return tipo === "invoice.payment_failed" ? { ...base, tipo: "atrasada", valor: 0 } : { ...base, tipo: "renovada", valor: fromMinor(d.amount_paid, cur) };
  }
  if (tipo === "customer.subscription.deleted") {
    const itens = Array.isArray(obj(d.items).data) ? (obj(d.items).data as unknown[]).map(obj) : [];
    const ref = t(d.id);
    if (!ref) return null;
    return { tipo: "cancelada", rawId: `cancel:${ref}`, email: null, produtos: lista(...itens.map((i) => obj(i.price).product)), assinaturaRef: ref, valor: 0, moeda: "USD", teste, em: data(d.canceled_at ?? d.ended_at) };
  }
  return null;
}

/**
 * O aviso que mexe numa assinatura do app (ou null). `evento` = o que o leitor de vendas já entendeu do mesmo aviso (as plataformas
 * sem leitor próprio de assinatura usam ele).
 */
export function lerAssinatura(plataforma: Plataforma, corpo: unknown, evento: VendaEvento): AvisoAssinatura | null {
  const c = obj(corpo);
  if (plataforma === "hotmart") return hotmart(c);
  if (plataforma === "kiwify") return kiwify(c);
  if (plataforma === "stripe") return stripe(c);
  if (evento.tipo === "ignorar") return null;
  const tipo: TipoPagamento = evento.tipo === "venda" ? "aprovada" : evento.tipo === "reembolso" ? "reembolsada" : "chargeback";
  return {
    tipo,
    rawId: evento.rawId,
    email: acharEmail(corpo),
    produtos: lista(evento.produtoRef, evento.produtoId),
    assinaturaRef: null,
    valor: tipo === "aprovada" ? evento.valor ?? 0 : 0,
    moeda: evento.moeda ?? "USD",
    teste: Boolean(evento.teste),
    em: evento.criadoEm ?? null,
  };
}
