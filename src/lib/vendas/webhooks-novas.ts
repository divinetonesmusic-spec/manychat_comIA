import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import { acharOrigem } from "@/lib/vendas/origem";
import { dateFrom, decimal, fromMinor, moeda, obj, safeEqualText, text, type Json, type VendaEvento } from "@/lib/vendas/webhooks";

/**
 * As 10 plataformas novas (0012): Hotmart, Kiwify, Eduzz, Monetizze, Braip, Ticto, Perfect Pay, Digistore24, ClickBank e
 * Lemon Squeezy. Mesmo padrão das de antes: cada uma só é aceita com o seu segredo, a venda é única pelo id da transação,
 * reembolso e chargeback mudam a mesma venda, venda de teste é marcada (fica fora dos resumos) e nenhum dado pessoal entra.
 *
 * «CONFERIR COM UM WEBHOOK REAL»: os formatos abaixo foram escritos pela documentação pública de cada plataforma, sem um aviso
 * real em mãos. Cada trecho incerto está marcado com `CONFERIR:`; a lista completa está em docs/ATUALIZACAO_0012.md. A origem do
 * post (mo…) também é procurada em qualquer campo de rastreio do aviso (origemProfunda, no handler), então um nome de campo
 * diferente do esperado não perde a venda do post.
 */

/** Um valor de texto que seja "verdadeiro" (true, "true", "1"). */
function verdade(value: unknown) {
  return value === true || value === 1 || (typeof value === "string" && /^(true|1|yes|sim)$/i.test(value.trim()));
}

/**
 * Venda de teste quando a plataforma marca (test, is_test, isTest, test_mode, testMode, sandbox), no topo ou em `data`.
 * CONFERIR: Hotmart, Kiwify, Eduzz, Monetizze, Braip, Ticto, Perfect Pay e Digistore24 não têm (que eu saiba com certeza)
 * um campo único de teste: estes nomes são os usuais; confira no aviso de teste de cada uma.
 */
export function marcadoComoTeste(body: Json) {
  const keys = ["test", "is_test", "isTest", "test_mode", "testMode", "sandbox"];
  return [body, obj(body.data)].some((level) => keys.some((key) => verdade(level[key])));
}

/** HMAC em hex, comparado sem pista pelo tempo (vazio nunca confere). */
function hmacHexConfere(algoritmo: "sha1" | "sha256", segredo: string, raw: string, recebida: string | null | undefined) {
  if (!recebida || !segredo) return false;
  const esperado = createHmac(algoritmo, segredo).update(raw, "utf8").digest("hex");
  return safeEqualText(recebida.trim().toLowerCase(), esperado);
}

export function signHmacHex(algoritmo: "sha1" | "sha256", segredo: string, raw: string) {
  return createHmac(algoritmo, segredo).update(raw, "utf8").digest("hex");
}

/**
 * Formulário com nomes de colchete ("venda[codigo]=1&produto[nome]=X") → objeto aninhado. Monetizze, Braip e Digistore24
 * podem mandar assim; JSON continua sendo lido como JSON.
 */
export function formParaObjeto(params: URLSearchParams): Json {
  const out: Json = {};
  for (const [key, value] of params) {
    const parts = key.match(/^([^[\]]+)((?:\[[^\]]*\])*)$/);
    if (!parts) {
      out[key] = value;
      continue;
    }
    const path = [parts[1], ...[...parts[2].matchAll(/\[([^\]]*)\]/g)].map((m) => m[1])];
    let cursor: Json = out;
    path.forEach((segment, index) => {
      if (index === path.length - 1) {
        cursor[segment] = value;
        return;
      }
      const next = cursor[segment];
      if (!next || typeof next !== "object") cursor[segment] = {};
      cursor = cursor[segment] as Json;
    });
  }
  return out;
}

/* ---------------- Hotmart (webhook 2.0.0) ---------------- */

/**
 * Hotmart: o token «hottok» (Ferramentas → Webhook) vem no cabeçalho X-HOTMART-HOTTOK (versão 2.0.0) ou no corpo (`hottok`,
 * postback antigo). Eventos: PURCHASE_APPROVED / PURCHASE_COMPLETE (venda), PURCHASE_REFUNDED (reembolso),
 * PURCHASE_CHARGEBACK (chargeback). PURCHASE_PROTEST (pedido de reembolso ainda aberto) e os outros ficam de fora.
 */
export function verifyHotmart(headerHottok: string | null, body: Json, secret: string) {
  return safeEqualText(headerHottok || (typeof body.hottok === "string" ? body.hottok : null), secret);
}

export function parseHotmartEvent(body: Json): VendaEvento {
  const event = String(body.event ?? "").toUpperCase();
  const data = obj(body.data);
  const purchase = obj(data.purchase);
  const product = obj(data.product);
  const rawId = text(purchase.transaction);
  if (!rawId) return { tipo: "ignorar", motivo: "sem id da transação" };
  // CONFERIR: full_price (o que o comprador pagou, com juros do parcelamento) x price (preço da oferta).
  const price = obj(Object.keys(obj(purchase.full_price)).length ? purchase.full_price : purchase.price);
  const origin = obj(purchase.origin);
  const base = {
    rawId,
    produtoRef: text(product.ucode) ?? text(product.id),
    produtoId: text(product.id),
    produtoNome: text(product.name),
    valor: decimal(price.value),
    moeda: moeda(price.currency_value, "BRL"),
    criadoEm: dateFrom(purchase.approved_date ?? purchase.order_date ?? body.creation_date),
    origem: acharOrigem([origin.sck, origin.src, origin.xcod]),
    teste: marcadoComoTeste(body),
  };
  if (event === "PURCHASE_APPROVED" || event === "PURCHASE_COMPLETE") return { ...base, tipo: "venda" };
  if (event === "PURCHASE_REFUNDED") return { ...base, tipo: "reembolso", pagamentoId: rawId, valorReembolsado: base.valor, reembolsoTotal: true };
  if (event === "PURCHASE_CHARGEBACK") return { ...base, tipo: "contestacao", pagamentoId: rawId };
  return { tipo: "ignorar", motivo: `evento ${event || "sem tipo"} não usado` };
}

/* ---------------- Kiwify ---------------- */

/**
 * Kiwify: o endereço recebe `?signature=` = HMAC-SHA1 (hex) do corpo cru com o token do webhook.
 * CONFERIR: o algoritmo (SHA1) e o nome do parâmetro, e se o valor (Commissions.charge_amount) vem em centavos.
 */
export function verifyKiwify(raw: string, signature: string | null, secret: string) {
  return hmacHexConfere("sha1", secret, raw, signature);
}

export function parseKiwifyEvent(body: Json): VendaEvento {
  const tipo = String(body.webhook_event_type ?? "").toLowerCase();
  const status = String(body.order_status ?? "").toLowerCase();
  const rawId = text(body.order_id) ?? text(body.order_ref);
  if (!rawId) return { tipo: "ignorar", motivo: "sem order_id" };
  const product = obj(body.Product);
  const commissions = obj(body.Commissions);
  const tracking = obj(body.TrackingParameters);
  const currency = moeda(commissions.currency, "BRL");
  const base = {
    rawId,
    pagamentoId: text(body.order_ref),
    produtoRef: text(product.product_id),
    produtoId: text(product.product_id),
    produtoNome: text(product.product_name),
    valor: fromMinor(commissions.charge_amount ?? commissions.product_base_price, currency),
    moeda: currency,
    criadoEm: dateFrom(body.approved_date ?? body.created_at),
    origem: acharOrigem([tracking.sck, tracking.src, tracking.utm_content]),
    teste: marcadoComoTeste(body),
  };
  if (tipo === "chargeback" || status === "chargedback") return { ...base, tipo: "contestacao" };
  if (tipo === "order_refunded" || status === "refunded") return { ...base, tipo: "reembolso", valorReembolsado: base.valor, reembolsoTotal: true };
  if (tipo === "order_approved" || status === "paid" || status === "approved") return { ...base, tipo: "venda" };
  return { tipo: "ignorar", motivo: `evento ${tipo || status || "sem tipo"} não usado` };
}

/* ---------------- Eduzz (webhooks da API nova, "myeduzz.*") ---------------- */

/**
 * Eduzz: cabeçalho `x-signature` = HMAC-SHA256 (hex) do corpo cru com o segredo do webhook (Console Eduzz → Webhooks).
 * CONFERIR: o nome do cabeçalho, o algoritmo, os nomes dos eventos (myeduzz.invoice_paid / _refunded / _chargeback) e os
 * campos de `data` (id, price/paid, items, utm, tracker). O postback antigo (trans_cod, api_key) não é lido.
 */
export function verifyEduzz(raw: string, signature: string | null, secret: string) {
  return hmacHexConfere("sha256", secret, raw, signature);
}

export function parseEduzzEvent(body: Json): VendaEvento {
  const event = String(body.event ?? "").toLowerCase();
  const data = obj(body.data);
  const rawId = text(data.id);
  if (!rawId) return { tipo: "ignorar", motivo: "sem id da fatura" };
  const items = Array.isArray(data.items) ? data.items.map(obj) : [];
  const paid = obj(Object.keys(obj(data.paid)).length ? data.paid : data.price);
  const utm = obj(data.utm);
  const tracker = obj(data.tracker);
  const base = {
    rawId,
    produtoRef: text(items[0]?.productId) ?? text(items[0]?.id),
    produtoId: text(items[0]?.productId) ?? text(items[0]?.id),
    produtoNome: items.length === 1 ? text(items[0].name) : items.length ? `${items.length} produtos` : null,
    valor: decimal(paid.value),
    moeda: moeda(paid.currency, "BRL"),
    criadoEm: dateFrom(data.paidAt ?? data.createdAt),
    origem: acharOrigem([utm.content, tracker.code1, tracker.code, data.tracker]),
    teste: marcadoComoTeste(body),
  };
  if (/chargeback/.test(event)) return { ...base, tipo: "contestacao", pagamentoId: rawId };
  if (/refund/.test(event)) return { ...base, tipo: "reembolso", pagamentoId: rawId, valorReembolsado: base.valor, reembolsoTotal: true };
  if (/invoice_paid$/.test(event)) return { ...base, tipo: "venda" };
  return { tipo: "ignorar", motivo: `evento ${event || "sem tipo"} não usado` };
}

/* ---------------- Monetizze (postback 2) ---------------- */

/**
 * Monetizze: o postback traz `chave_unica` (Ferramentas → Postback), comparada com o segredo. O status pelo texto de
 * `venda.status` (Finalizada/Completa = venda, Devolvida = reembolso, Chargeback = chargeback) ou pelo código de
 * `tipoPostback` (2 finalizada, 6 completa, 4 devolvida). CONFERIR: o código do chargeback e o nome do campo de rastreio
 * (`venda.src`, `venda.utm_content`).
 */
export function verifyMonetizze(body: Json, secret: string) {
  return safeEqualText(typeof body.chave_unica === "string" ? body.chave_unica : null, secret);
}

export function parseMonetizzeEvent(body: Json): VendaEvento {
  const venda = obj(body.venda);
  const produto = obj(body.produto);
  const tipo = obj(body.tipoPostback);
  const rawId = text(venda.codigo);
  if (!rawId) return { tipo: "ignorar", motivo: "sem código da venda" };
  const status = String(venda.status ?? tipo.descricao ?? "").toLowerCase();
  const codigo = String(tipo.codigo ?? "");
  const base = {
    rawId,
    produtoRef: text(produto.codigo),
    produtoId: text(produto.codigo),
    produtoNome: text(produto.nome),
    valor: decimal(venda.valor),
    moeda: "BRL",
    criadoEm: dateFrom(venda.dataFinalizada ?? venda.dataInicio),
    origem: acharOrigem([venda.src, venda.utm_content, body.src]),
    teste: marcadoComoTeste(body),
  };
  if (/chargeback/.test(status)) return { ...base, tipo: "contestacao", pagamentoId: rawId };
  if (/devolvid|reembols/.test(status) || codigo === "4") return { ...base, tipo: "reembolso", pagamentoId: rawId, valorReembolsado: base.valor, reembolsoTotal: true };
  if (/finalizad|complet|aprovad/.test(status) || codigo === "2" || codigo === "6") return { ...base, tipo: "venda" };
  return { tipo: "ignorar", motivo: `situação ${status || codigo || "sem situação"} não usada` };
}

/* ---------------- Braip ---------------- */

/**
 * Braip: o postback traz `basic_authentication` (a chave única de autenticação da conta). Status em `trans_status`
 * ("Pagamento Aprovado", "Devolvida", "Chargeback"...). CONFERIR: se `trans_total_value` vem em centavos (lido como
 * centavos), o campo de rastreio (procurado em `src`, `utm_content` e, na reserva, em qualquer campo de rastreio).
 */
export function verifyBraip(body: Json, secret: string) {
  return safeEqualText(typeof body.basic_authentication === "string" ? body.basic_authentication : null, secret);
}

export function parseBraipEvent(body: Json): VendaEvento {
  const rawId = text(body.trans_key);
  if (!rawId) return { tipo: "ignorar", motivo: "sem trans_key" };
  const status = String(body.trans_status ?? "").toLowerCase();
  const base = {
    rawId,
    produtoRef: text(body.product_key),
    produtoId: text(body.product_key),
    produtoNome: text(body.product_name),
    valor: fromMinor(body.trans_total_value ?? body.trans_value, "BRL"),
    moeda: "BRL",
    criadoEm: dateFrom(body.trans_updatedate ?? body.trans_createdate),
    origem: acharOrigem([body.src, body.utm_content, obj(body.meta).src, obj(body.meta).utm_content]),
    teste: marcadoComoTeste(body),
  };
  if (/chargeback/.test(status)) return { ...base, tipo: "contestacao", pagamentoId: rawId };
  if (/devolvid|reembols|estornad/.test(status)) return { ...base, tipo: "reembolso", pagamentoId: rawId, valorReembolsado: base.valor, reembolsoTotal: true };
  if (/aprovad/.test(status)) return { ...base, tipo: "venda" };
  return { tipo: "ignorar", motivo: `situação ${status || "sem situação"} não usada` };
}

/* ---------------- Ticto (postback 2.0) ---------------- */

/**
 * Ticto: o postback traz `token` (o token do postback, na configuração do produto). Status em `status` ("authorized" /
 * "approved" = venda, "refunded", "chargeback"). CONFERIR: `order.paid_amount` em centavos, o id (`order.hash`) e onde
 * voltam os parâmetros da URL (`query_params` / `tracking`).
 */
export function verifyTicto(body: Json, secret: string) {
  return safeEqualText(typeof body.token === "string" ? body.token : null, secret);
}

export function parseTictoEvent(body: Json): VendaEvento {
  const order = obj(body.order);
  const item = obj(body.item);
  const rawId = text(order.hash) ?? text(order.id) ?? text(order.transaction_hash);
  if (!rawId) return { tipo: "ignorar", motivo: "sem id do pedido" };
  const status = String(body.status ?? "").toLowerCase();
  const query = obj(body.query_params);
  const tracking = obj(body.tracking);
  const base = {
    rawId,
    produtoRef: text(item.product_id),
    produtoId: text(item.product_id),
    produtoNome: text(item.product_name),
    valor: fromMinor(order.paid_amount ?? item.amount, "BRL"),
    moeda: "BRL",
    criadoEm: dateFrom(order.order_date ?? body.created_at),
    origem: acharOrigem([query.utm_content, query.src, query.sck, tracking.utm_content, tracking.src, tracking.sck]),
    teste: marcadoComoTeste(body),
  };
  if (/chargeback/.test(status)) return { ...base, tipo: "contestacao", pagamentoId: rawId };
  if (/refund/.test(status)) return { ...base, tipo: "reembolso", pagamentoId: rawId, valorReembolsado: base.valor, reembolsoTotal: true };
  if (status === "authorized" || status === "approved" || status === "paid") return { ...base, tipo: "venda" };
  return { tipo: "ignorar", motivo: `situação ${status || "sem situação"} não usada` };
}

/* ---------------- Perfect Pay ---------------- */

/**
 * Perfect Pay: o postback traz `token` (Ferramentas → Webhook). Situação em `sale_status_enum`: 2 aprovada, 10 completa
 * (venda), 7 devolvida (reembolso), 9 chargeback. CONFERIR: os números da situação, `sale_amount` em reais (decimal) e os
 * parâmetros em `metadata` (src, utm_content).
 */
export function verifyPerfectPay(body: Json, secret: string) {
  return safeEqualText(typeof body.token === "string" ? body.token : null, secret);
}

export function parsePerfectPayEvent(body: Json): VendaEvento {
  const rawId = text(body.code);
  if (!rawId) return { tipo: "ignorar", motivo: "sem código da venda" };
  const status = Number(body.sale_status_enum);
  const product = obj(body.product);
  const metadata = obj(body.metadata);
  const base = {
    rawId,
    produtoRef: text(product.code),
    produtoId: text(product.code),
    produtoNome: text(product.name),
    valor: decimal(body.sale_amount),
    moeda: "BRL",
    criadoEm: dateFrom(body.date_approved ?? body.date_created),
    origem: acharOrigem([metadata.src, metadata.utm_content, metadata.utm_perfect]),
    teste: marcadoComoTeste(body),
  };
  if (status === 9) return { ...base, tipo: "contestacao", pagamentoId: rawId };
  if (status === 7) return { ...base, tipo: "reembolso", pagamentoId: rawId, valorReembolsado: base.valor, reembolsoTotal: true };
  if (status === 2 || status === 10) return { ...base, tipo: "venda" };
  return { tipo: "ignorar", motivo: `situação ${Number.isFinite(status) ? status : "sem situação"} não usada` };
}

/* ---------------- Digistore24 (IPN) ---------------- */

/**
 * Digistore24: o IPN chega como formulário com `sha_sign` = SHA-512 (maiúsculas) de, em ordem alfabética dos campos (menos
 * sha_sign), cada campo não vazio como "campo=valor" + a senha do IPN. A Digistore24 espera a resposta "OK".
 * CONFERIR: o algoritmo do sha_sign (com o botão de teste do IPN) e o campo de teste.
 */
export function digistoreSign(params: URLSearchParams | Record<string, string>, passphrase: string) {
  const entries = (params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params))
    .filter(([key, value]) => key !== "sha_sign" && key !== "SHASIGN" && value !== "");
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const base = entries.map(([key, value]) => `${key}=${value}${passphrase}`).join("");
  return createHash("sha512").update(base, "utf8").digest("hex").toUpperCase();
}

export function verifyDigistore(params: URLSearchParams, passphrase: string) {
  const given = params.get("sha_sign") || params.get("SHASIGN");
  if (!given || !passphrase) return false;
  return safeEqualText(given.trim().toUpperCase(), digistoreSign(params, passphrase));
}

export function parseDigistoreIpn(params: URLSearchParams): VendaEvento {
  const event = (params.get("event") || "").toLowerCase();
  if (event === "connection_test") return { tipo: "ignorar", motivo: "teste de conexão" };
  const orderId = text(params.get("order_id"));
  if (!orderId) return { tipo: "ignorar", motivo: "sem order_id" };
  const currency = moeda(params.get("currency") || params.get("transaction_currency"), "EUR");
  const base = {
    pagamentoId: orderId,
    produtoRef: text(params.get("product_id")),
    produtoId: text(params.get("product_id")),
    produtoNome: text(params.get("product_name")),
    valor: decimal(params.get("amount") ?? params.get("transaction_amount")),
    moeda: currency,
    criadoEm: dateFrom(params.get("transaction_date") || params.get("order_date")),
    origem: acharOrigem([params.get("custom"), params.get("trackingkey"), params.get("campaignkey")]),
    teste: verdade(params.get("test_mode")) || verdade(params.get("is_test")),
  };
  // Venda: uma por pagamento (transaction_id); reembolso/chargeback acham a venda pelo order_id (pagamento_id).
  if (event === "on_payment") return { ...base, tipo: "venda", rawId: text(params.get("transaction_id")) ?? orderId };
  if (event === "on_refund") return { ...base, tipo: "reembolso", rawId: orderId, valorReembolsado: base.valor, reembolsoTotal: true };
  if (event === "on_chargeback") return { ...base, tipo: "contestacao", rawId: orderId };
  return { tipo: "ignorar", motivo: `evento ${event || "sem tipo"} não usado` };
}

/* ---------------- ClickBank (INS 6+, criptografado) ---------------- */

/** A chave do ClickBank: os 32 primeiros caracteres do SHA-1 (hex) da chave secreta, como bytes. */
function clickbankKey(secret: string) {
  return Buffer.from(createHash("sha1").update(secret, "utf8").digest("hex").slice(0, 32), "utf8");
}

/**
 * ClickBank: o INS chega como {"notification": base64, "iv": base64}, criptografado com AES-256-CBC e a chave secreta da conta
 * (Settings → My Site → Secret Key). Só quem tem a chave monta um aviso que abre em JSON: esse é o "segredo" conferido.
 * null = não abriu (chave errada ou corpo mexido).
 */
export function decryptClickbank(body: Json, secret: string): Json | null {
  if (typeof body.notification !== "string" || typeof body.iv !== "string" || !secret) return null;
  try {
    const iv = Buffer.from(body.iv, "base64");
    if (iv.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-cbc", clickbankKey(secret), iv);
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(Buffer.from(body.notification, "base64")), decipher.final()]).toString("utf8");
    // O preenchimento (PKCS#7 ou bytes de controle) sai do fim, como no exemplo do ClickBank (trim).
    const parsed = JSON.parse(plain.replace(/[\u0000- ]+$/g, "")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : null;
  } catch {
    return null;
  }
}

/** Monta o aviso criptografado do ClickBank (só para os testes). */
export function encryptClickbank(payload: Json, secret: string, iv = Buffer.alloc(16, 7)) {
  const cipher = createCipheriv("aes-256-cbc", clickbankKey(secret), iv);
  const notification = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]).toString("base64");
  return { notification, iv: iv.toString("base64") };
}

export function parseClickbankEvent(data: Json): VendaEvento {
  const type = String(data.transactionType ?? "").toUpperCase();
  const rawId = text(data.receipt);
  if (!rawId) return { tipo: "ignorar", motivo: "sem receipt" };
  const teste = type.startsWith("TEST_");
  const kind = type.replace(/^TEST_/, "");
  const items = Array.isArray(data.lineItems) ? data.lineItems.map(obj) : [];
  const currency = moeda(data.currency, "USD");
  const base = {
    rawId,
    pagamentoId: rawId,
    produtoRef: text(items[0]?.itemNo),
    produtoId: text(items[0]?.itemNo),
    produtoNome: items.length === 1 ? text(items[0].productTitle) : items.length ? `${items.length} produtos` : null,
    valor: decimal(data.totalOrderAmount),
    moeda: currency,
    criadoEm: dateFrom(data.transactionTime),
    // O tid do link volta em trackingCodes (lista); CONFERIR: vendorVariables.tid_ em versões antigas do INS.
    origem: acharOrigem([data.trackingCodes, obj(data.vendorVariables).tid_, obj(data.vendorVariables).tid]),
    teste,
  };
  if (kind === "SALE" || kind === "BILL") return { ...base, tipo: "venda" };
  if (kind === "RFND") return { ...base, tipo: "reembolso", valorReembolsado: Math.abs(base.valor), reembolsoTotal: true, valor: Math.abs(base.valor) };
  if (kind === "CGBK") return { ...base, tipo: "contestacao", valor: Math.abs(base.valor) };
  return { tipo: "ignorar", motivo: `evento ${type || "sem tipo"} não usado` };
}

/* ---------------- Lemon Squeezy ---------------- */

/** Lemon Squeezy: cabeçalho X-Signature = HMAC-SHA256 (hex) do corpo cru com o "signing secret" do webhook. */
export function verifyLemonSqueezy(raw: string, signature: string | null, secret: string) {
  return hmacHexConfere("sha256", secret, raw, signature);
}

/**
 * order_created (status paid) = venda; order_refunded = reembolso. A origem volta em meta.custom_data.molde_origem
 * (o checkout[custom][molde_origem] do link). CONFERIR: o Lemon Squeezy não tem (que eu saiba) um evento de chargeback.
 */
export function parseLemonSqueezyEvent(body: Json): VendaEvento {
  const meta = obj(body.meta);
  const event = String(meta.event_name ?? "");
  const data = obj(body.data);
  const attributes = obj(data.attributes);
  const rawId = text(data.id);
  if (!rawId) return { tipo: "ignorar", motivo: "sem id do pedido" };
  const item = obj(attributes.first_order_item);
  const currency = moeda(attributes.currency, "USD");
  const custom = obj(meta.custom_data);
  const base = {
    rawId,
    pagamentoId: text(attributes.identifier),
    produtoRef: text(item.product_id),
    produtoId: text(item.product_id),
    produtoNome: text(item.product_name),
    valor: fromMinor(attributes.total, currency),
    moeda: currency,
    criadoEm: dateFrom(attributes.created_at),
    origem: acharOrigem([custom.molde_origem, custom.origem, custom.utm_content]),
    teste: verdade(meta.test_mode) || verdade(attributes.test_mode),
  };
  if (event === "order_created") {
    if (String(attributes.status ?? "paid") !== "paid") return { tipo: "ignorar", motivo: "pedido ainda não pago" };
    return { ...base, tipo: "venda" };
  }
  if (event === "order_refunded") {
    const refunded = attributes.refunded_amount !== undefined ? fromMinor(attributes.refunded_amount, currency) : base.valor;
    return { ...base, tipo: "reembolso", valorReembolsado: refunded, reembolsoTotal: refunded >= base.valor };
  }
  return { tipo: "ignorar", motivo: `evento ${event || "sem tipo"} não usado` };
}
