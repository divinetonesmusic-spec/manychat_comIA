import { NextResponse, type NextRequest } from "next/server";
import { hasVendasTable, MIGRATION_0010_MISSING } from "@/lib/db/redes";
import { registrarEvento } from "@/lib/db/vendas";
import {
  parseCaktoEvent,
  parseGumroadPing,
  parsePayhipEvent,
  parseStripeEvent,
  parseWhopEvent,
  safeEqualText,
  verifyPayhipSignature,
  verifyStandardWebhook,
  verifyStripeSignature,
  type Plataforma,
  type VendaEvento,
} from "@/lib/vendas/webhooks";

/**
 * Recebe o aviso de venda de uma plataforma: confere o segredo (sem ele configurado, 503), lê o aviso e grava em
 * public.vendas (o mesmo aviso de novo não duplica). Responde rápido; nunca devolve dado da venda.
 */
const SEGREDO: Record<Plataforma, string> = {
  stripe: "STRIPE_WEBHOOK_SECRET",
  whop: "WHOP_WEBHOOK_SECRET",
  gumroad: "GUMROAD_WEBHOOK_KEY",
  payhip: "PAYHIP_API_KEY",
  cakto: "CAKTO_WEBHOOK_SECRET",
};

const MAX_BODY = 512 * 1024;

export async function handleVendaWebhook(plataforma: Plataforma, request: NextRequest) {
  const secret = process.env[SEGREDO[plataforma]] || "";
  if (!secret) {
    return NextResponse.json({ error: `Vendas pela ${nome(plataforma)} desligadas: falta ${SEGREDO[plataforma]} nas variáveis do servidor.`, codigo: "nao_configurado" }, { status: 503 });
  }
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Aviso grande demais.", codigo: "grande_demais" }, { status: 413 });

  let evento: VendaEvento;
  try {
    const checked = verifyAndParse(plataforma, request, raw, secret);
    if (!checked) return NextResponse.json({ error: "Assinatura inválida.", codigo: "assinatura_invalida" }, { status: 401 });
    evento = checked;
  } catch {
    return NextResponse.json({ error: "Aviso em formato inválido.", codigo: "formato_invalido" }, { status: 400 });
  }
  if (evento.tipo === "ignorar") return NextResponse.json({ ok: true, ignorado: evento.motivo });
  if (!(await hasVendasTable())) return NextResponse.json({ error: MIGRATION_0010_MISSING, codigo: "falta_0010" }, { status: 503 });

  if (plataforma === "gumroad" && process.env.GUMROAD_ACCESS_TOKEN) {
    const confirmada = await confirmGumroadSale(evento.rawId, process.env.GUMROAD_ACCESS_TOKEN);
    if (confirmada === false) return NextResponse.json({ error: "A venda não foi confirmada na API do Gumroad.", codigo: "nao_confirmada" }, { status: 400 });
    if (confirmada === null) return NextResponse.json({ error: "Não consegui conferir a venda na API do Gumroad agora.", codigo: "gumroad_fora" }, { status: 503 });
  }

  const resultado = await registrarEvento(plataforma, evento);
  return NextResponse.json({ ok: true, resultado });
}

function nome(plataforma: Plataforma) {
  return { stripe: "Stripe", whop: "Whop", gumroad: "Gumroad", payhip: "Payhip", cakto: "Cakto" }[plataforma];
}

/** Confere a assinatura e lê o aviso. null = não confere. Erro de leitura sobe (400). */
function verifyAndParse(plataforma: Plataforma, request: NextRequest, raw: string, secret: string): VendaEvento | null {
  if (plataforma === "stripe") {
    if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), secret)) return null;
    return parseStripeEvent(JSON.parse(raw));
  }
  if (plataforma === "whop") {
    const ok = verifyStandardWebhook(raw, {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    }, secret);
    if (!ok) return null;
    return parseWhopEvent(JSON.parse(raw));
  }
  if (plataforma === "gumroad") {
    // O Gumroad não assina o aviso: o segredo vai no próprio endereço cadastrado (?key=...).
    if (!safeEqualText(request.nextUrl.searchParams.get("key"), secret)) return null;
    return parseGumroadPing(new URLSearchParams(raw));
  }
  const body = parseJsonOrForm(raw, request.headers.get("content-type"));
  if (plataforma === "payhip") {
    if (!verifyPayhipSignature(body.signature, secret)) return null;
    return parsePayhipEvent(body);
  }
  if (!safeEqualText(typeof body.secret === "string" ? body.secret : null, secret)) return null;
  return parseCaktoEvent(body);
}

function parseJsonOrForm(raw: string, contentType: string | null): Record<string, unknown> {
  if (contentType?.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("corpo inválido");
  return parsed as Record<string, unknown>;
}

/** GET /v2/sales/{id} da API do Gumroad: true = existe, false = não existe, null = não deu para conferir. */
async function confirmGumroadSale(saleId: string, accessToken: string): Promise<boolean | null> {
  try {
    const url = new URL(`https://api.gumroad.com/v2/sales/${encodeURIComponent(saleId)}`);
    url.searchParams.set("access_token", accessToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (response.status === 404) return false;
    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; sale?: { id?: string } };
    if (!response.ok) return response.status >= 500 ? null : false;
    return payload.success === true && Boolean(payload.sale);
  } catch {
    return null;
  }
}
