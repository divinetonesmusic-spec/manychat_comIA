import { NextResponse, type NextRequest } from "next/server";
import { hasVendasTable, MIGRATION_0010_MISSING } from "@/lib/db/redes";
import { hasVendasOrigemColumn, MIGRATION_0012_MISSING, registrarEvento } from "@/lib/db/vendas";
import { origemProfunda } from "@/lib/vendas/origem";
import {
  decryptClickbank,
  formParaObjeto,
  parseBraipEvent,
  parseClickbankEvent,
  parseDigistoreIpn,
  parseEduzzEvent,
  parseHotmartEvent,
  parseKiwifyEvent,
  parseLemonSqueezyEvent,
  parseMonetizzeEvent,
  parsePerfectPayEvent,
  parseTictoEvent,
  verifyBraip,
  verifyDigistore,
  verifyEduzz,
  verifyHotmart,
  verifyKiwify,
  verifyLemonSqueezy,
  verifyMonetizze,
  verifyPerfectPay,
  verifyTicto,
} from "@/lib/vendas/webhooks-novas";
import {
  isPlataforma0012,
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
export const SEGREDO: Record<Plataforma, string> = {
  stripe: "STRIPE_WEBHOOK_SECRET",
  whop: "WHOP_WEBHOOK_SECRET",
  gumroad: "GUMROAD_WEBHOOK_KEY",
  payhip: "PAYHIP_API_KEY",
  cakto: "CAKTO_WEBHOOK_SECRET",
  hotmart: "HOTMART_HOTTOK",
  kiwify: "KIWIFY_WEBHOOK_TOKEN",
  eduzz: "EDUZZ_WEBHOOK_SECRET",
  monetizze: "MONETIZZE_CHAVE_UNICA",
  braip: "BRAIP_AUTH_KEY",
  ticto: "TICTO_WEBHOOK_TOKEN",
  perfectpay: "PERFECTPAY_WEBHOOK_TOKEN",
  digistore24: "DIGISTORE24_IPN_PASSPHRASE",
  clickbank: "CLICKBANK_SECRET_KEY",
  lemonsqueezy: "LEMONSQUEEZY_WEBHOOK_SECRET",
};

export const NOME_PLATAFORMA: Record<Plataforma, string> = {
  stripe: "Stripe",
  whop: "Whop",
  gumroad: "Gumroad",
  payhip: "Payhip",
  cakto: "Cakto",
  hotmart: "Hotmart",
  kiwify: "Kiwify",
  eduzz: "Eduzz",
  monetizze: "Monetizze",
  braip: "Braip",
  ticto: "Ticto",
  perfectpay: "Perfect Pay",
  digistore24: "Digistore24",
  clickbank: "ClickBank",
  lemonsqueezy: "Lemon Squeezy",
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
    evento = checked.evento;
    // A origem do post (mo…): o campo conhecido de cada plataforma; senão, qualquer campo de rastreio do aviso.
    if (evento.tipo !== "ignorar" && !evento.origem) evento = { ...evento, origem: origemProfunda(checked.corpo) };
  } catch {
    return NextResponse.json({ error: "Aviso em formato inválido.", codigo: "formato_invalido" }, { status: 400 });
  }
  if (evento.tipo === "ignorar") return ok(plataforma, { ok: true, ignorado: evento.motivo });
  if (!(await hasVendasTable())) return NextResponse.json({ error: MIGRATION_0010_MISSING, codigo: "falta_0010" }, { status: 503 });
  // As plataformas novas só cabem no banco depois da 0012 (a plataforma tenta de novo mais tarde).
  if (isPlataforma0012(plataforma) && !(await hasVendasOrigemColumn())) return NextResponse.json({ error: MIGRATION_0012_MISSING, codigo: "falta_0012" }, { status: 503 });

  if (plataforma === "gumroad" && process.env.GUMROAD_ACCESS_TOKEN) {
    const confirmada = await confirmGumroadSale(evento.rawId, process.env.GUMROAD_ACCESS_TOKEN);
    if (confirmada === false) return NextResponse.json({ error: "A venda não foi confirmada na API do Gumroad.", codigo: "nao_confirmada" }, { status: 400 });
    if (confirmada === null) return NextResponse.json({ error: "Não consegui conferir a venda na API do Gumroad agora.", codigo: "gumroad_fora" }, { status: 503 });
  }

  const resultado = await registrarEvento(plataforma, evento);
  return ok(plataforma, { ok: true, resultado });
}

/** Resposta de sucesso. A Digistore24 espera o texto "OK" (senão repete o aviso); as outras recebem o JSON de sempre. */
function ok(plataforma: Plataforma, body: Record<string, unknown>) {
  if (plataforma === "digistore24") return new NextResponse("OK", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  return NextResponse.json(body);
}

function nome(plataforma: Plataforma) {
  return NOME_PLATAFORMA[plataforma];
}

/** Confere a assinatura e lê o aviso. null = não confere. Erro de leitura sobe (400). `corpo` serve à busca da origem. */
function verifyAndParse(plataforma: Plataforma, request: NextRequest, raw: string, secret: string): { evento: VendaEvento; corpo: unknown } | null {
  if (plataforma === "stripe") {
    if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), secret)) return null;
    const corpo = JSON.parse(raw);
    return { evento: parseStripeEvent(corpo), corpo };
  }
  if (plataforma === "whop") {
    const ok = verifyStandardWebhook(raw, {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    }, secret);
    if (!ok) return null;
    const corpo = JSON.parse(raw);
    return { evento: parseWhopEvent(corpo), corpo };
  }
  if (plataforma === "gumroad") {
    // O Gumroad não assina o aviso: o segredo vai no próprio endereço cadastrado (?key=...).
    if (!safeEqualText(request.nextUrl.searchParams.get("key"), secret)) return null;
    const form = new URLSearchParams(raw);
    return { evento: parseGumroadPing(form), corpo: Object.fromEntries(form) };
  }
  if (plataforma === "digistore24") {
    const form = new URLSearchParams(raw);
    if (!verifyDigistore(form, secret)) return null;
    return { evento: parseDigistoreIpn(form), corpo: Object.fromEntries(form) };
  }
  // Os que conferem o corpo cru (HMAC) antes de ler.
  if (plataforma === "kiwify") {
    if (!verifyKiwify(raw, request.nextUrl.searchParams.get("signature"), secret)) return null;
    const corpo = parseJsonOrForm(raw, request.headers.get("content-type"));
    return { evento: parseKiwifyEvent(corpo), corpo };
  }
  if (plataforma === "eduzz") {
    if (!verifyEduzz(raw, request.headers.get("x-signature"), secret)) return null;
    const corpo = parseJsonOrForm(raw, request.headers.get("content-type"));
    return { evento: parseEduzzEvent(corpo), corpo };
  }
  if (plataforma === "lemonsqueezy") {
    if (!verifyLemonSqueezy(raw, request.headers.get("x-signature"), secret)) return null;
    const corpo = parseJsonOrForm(raw, request.headers.get("content-type"));
    return { evento: parseLemonSqueezyEvent(corpo), corpo };
  }
  const body = parseJsonOrForm(raw, request.headers.get("content-type"));
  if (plataforma === "clickbank") {
    const aberto = decryptClickbank(body, secret);
    if (!aberto) return null;
    return { evento: parseClickbankEvent(aberto), corpo: aberto };
  }
  const leitores: Partial<Record<Plataforma, [(corpo: Record<string, unknown>) => boolean, (corpo: Record<string, unknown>) => VendaEvento]>> = {
    payhip: [(corpo) => verifyPayhipSignature(corpo.signature, secret), parsePayhipEvent],
    cakto: [(corpo) => safeEqualText(typeof corpo.secret === "string" ? corpo.secret : null, secret), parseCaktoEvent],
    hotmart: [(corpo) => verifyHotmart(request.headers.get("x-hotmart-hottok"), corpo, secret), parseHotmartEvent],
    monetizze: [(corpo) => verifyMonetizze(corpo, secret), parseMonetizzeEvent],
    braip: [(corpo) => verifyBraip(corpo, secret), parseBraipEvent],
    ticto: [(corpo) => verifyTicto(corpo, secret), parseTictoEvent],
    perfectpay: [(corpo) => verifyPerfectPay(corpo, secret), parsePerfectPayEvent],
  };
  const leitor = leitores[plataforma];
  if (!leitor || !leitor[0](body)) return null;
  return { evento: leitor[1](body), corpo: body };
}

function parseJsonOrForm(raw: string, contentType: string | null): Record<string, unknown> {
  // Formulário: nomes com colchetes viram objeto (venda[codigo] → { venda: { codigo } }), como a Monetizze e a Braip mandam.
  if (contentType?.includes("application/x-www-form-urlencoded")) return formParaObjeto(new URLSearchParams(raw));
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
