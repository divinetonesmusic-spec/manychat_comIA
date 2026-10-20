/**
 * Escada no checkout (Money Models): produto de entrada → order bump → upsell de 1 clique → downsell → recorrência →
 * página de obrigado. O pagamento continua na plataforma (Stripe, Whop, Gumroad, Payhip, Cakto); o UaiFlow guarda a
 * configuração, mostra as páginas, conta os eventos e decide o próximo passo. Tudo aqui é puro (sem banco), para testar.
 *
 * Regras de compliance (EUA):
 * - Urgência só real (FTC): o prazo do desconto é gravado UMA vez no banco (funil_sessoes.oferta_expira_em) e vence de
 *   verdade. Recarregar a página não reinicia o relógio; depois do prazo o link com desconto deixa de ser entregue.
 * - Assinatura (ROSCA): a recorrência só aparece com o link de cancelamento e os termos na tela, e o «Sim» só passa com
 *   a caixa de concordância marcada (conferida também no servidor).
 */

export type Oferta = {
  nome: string;
  preco: number;
  texto: string;
  /** Link de pagamento na plataforma. */
  checkoutUrl: string;
  /** produtoRef que a venda desta oferta traz no webhook (para somar a receita real). */
  produtoRef?: string | null;
};

export type OfertaUpsell = Oferta & {
  /** Minutos que o desconto vale depois que a pessoa chega na oferta (0/ausente = sem prazo). */
  prazoMinutos?: number | null;
  /** Preço e link sem desconto, mostrados depois do prazo. Sem eles, a oferta encerra no prazo. */
  precoCheio?: number | null;
  checkoutUrlCheio?: string | null;
};

export type OfertaDownsell = Oferta & {
  /** Parcelas (ex.: 3x de US$ 9). Só texto: o parcelamento é configurado na plataforma. */
  parcelas?: number | null;
};

export type OfertaRecorrencia = Oferta & {
  /** Link onde a pessoa cancela sozinha (ex.: portal do cliente da Stripe). Obrigatório. */
  cancelarUrl: string;
  /** Termos mostrados antes do «Sim» (o UaiFlow monta um texto padrão quando vazio). */
  termos?: string | null;
};

export type EscadaConfig = {
  bump?: Oferta | null;
  upsell?: OfertaUpsell | null;
  downsell?: OfertaDownsell | null;
  recorrencia?: OfertaRecorrencia | null;
};

export const ETAPAS = ["upsell", "downsell", "recorrencia", "obrigado"] as const;
export type Etapa = (typeof ETAPAS)[number];
export type Acao = "aceitar" | "recusar";

/** Faixas de preço sugeridas (Hormozi). Fora delas o painel avisa, mas salva. */
export const FAIXAS: Record<"bump" | "upsell" | "downsell" | "recorrencia", { min: number; max: number; rotulo: string }> = {
  bump: { min: 9, max: 17, rotulo: "Order bump" },
  upsell: { min: 47, max: 97, rotulo: "Upsell" },
  downsell: { min: 19, max: 27, rotulo: "Downsell" },
  recorrencia: { min: 9, max: 19, rotulo: "Recorrência (por mês)" },
};

export const MAX_PRAZO_MINUTOS = 7 * 24 * 60;

/* ---------------- leitura e conferência ---------------- */

function texto(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numero(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
  }
  return null;
}

export function linkValido(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function lerOferta(raw: unknown, rotulo: string, erros: string[]): Oferta | null {
  if (raw === null || raw === undefined || raw === false) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    erros.push(`${rotulo}: formato inválido.`);
    return null;
  }
  const item = raw as Record<string, unknown>;
  const nome = texto(item.nome, 120);
  const preco = numero(item.preco);
  const checkoutUrl = texto(item.checkoutUrl ?? item.link, 1000);
  // Oferta toda vazia = desligada.
  if (!nome && preco === null && !checkoutUrl) return null;
  if (!nome) erros.push(`${rotulo}: falta o nome.`);
  if (preco === null || preco <= 0) erros.push(`${rotulo}: falta o preço.`);
  if (!linkValido(checkoutUrl)) erros.push(`${rotulo}: falta o link de pagamento (https://...).`);
  return { nome, preco: preco ?? 0, texto: texto(item.texto, 600), checkoutUrl, produtoRef: texto(item.produtoRef, 120) || null };
}

/** Lê a escada mandada pela tela (ou guardada no banco). Devolve a escada limpa e a lista de erros. */
export function parseEscada(raw: unknown): { escada: EscadaConfig; erros: string[] } {
  const erros: string[] = [];
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const escada: EscadaConfig = {};

  const bump = lerOferta(input.bump, "Order bump", erros);
  if (bump) escada.bump = bump;

  const upsellRaw = input.upsell as Record<string, unknown> | undefined;
  const upsell = lerOferta(upsellRaw, "Upsell", erros);
  if (upsell && upsellRaw) {
    const prazo = numero(upsellRaw.prazoMinutos);
    const precoCheio = numero(upsellRaw.precoCheio);
    const checkoutUrlCheio = texto(upsellRaw.checkoutUrlCheio, 1000);
    if (prazo !== null && (prazo < 0 || prazo > MAX_PRAZO_MINUTOS)) erros.push(`Upsell: o prazo do desconto vai de 0 a ${MAX_PRAZO_MINUTOS} minutos (7 dias).`);
    if (checkoutUrlCheio && !linkValido(checkoutUrlCheio)) erros.push("Upsell: o link do preço cheio precisa começar com https://.");
    if ((precoCheio !== null) !== Boolean(checkoutUrlCheio)) erros.push("Upsell: preço cheio e link do preço cheio vão juntos.");
    if (precoCheio !== null && precoCheio <= upsell.preco) erros.push("Upsell: o preço cheio precisa ser maior que o preço com desconto.");
    escada.upsell = {
      ...upsell,
      prazoMinutos: prazo && prazo > 0 ? Math.round(prazo) : null,
      precoCheio: precoCheio ?? null,
      checkoutUrlCheio: checkoutUrlCheio || null,
    };
    if (escada.upsell.precoCheio !== null && !escada.upsell.prazoMinutos) erros.push("Upsell: preço com desconto e preço cheio só fazem sentido com um prazo real.");
  }

  const downsellRaw = input.downsell as Record<string, unknown> | undefined;
  const downsell = lerOferta(downsellRaw, "Downsell", erros);
  if (downsell && downsellRaw) {
    const parcelas = numero(downsellRaw.parcelas);
    if (parcelas !== null && (parcelas < 1 || parcelas > 24 || !Number.isInteger(parcelas))) erros.push("Downsell: parcelas de 1 a 24.");
    escada.downsell = { ...downsell, parcelas: parcelas && parcelas > 1 ? parcelas : null };
    if (!escada.upsell) erros.push("Downsell: só aparece quando a pessoa recusa o upsell. Configure o upsell antes.");
  }

  const recRaw = input.recorrencia as Record<string, unknown> | undefined;
  const recorrencia = lerOferta(recRaw, "Recorrência", erros);
  if (recorrencia && recRaw) {
    const cancelarUrl = texto(recRaw.cancelarUrl, 1000);
    if (!linkValido(cancelarUrl)) erros.push("Recorrência: falta o link de cancelamento (onde a pessoa cancela sozinha). É exigência da lei dos EUA (ROSCA).");
    escada.recorrencia = { ...recorrencia, cancelarUrl, termos: texto(recRaw.termos, 1200) || null };
  }

  return { escada, erros };
}

/** Avisos de preço fora das faixas sugeridas (não impedem salvar). */
export function avisosEscada(escada: EscadaConfig): string[] {
  const avisos: string[] = [];
  for (const chave of ["bump", "upsell", "downsell", "recorrencia"] as const) {
    const oferta = escada[chave];
    if (!oferta) continue;
    const faixa = FAIXAS[chave];
    if (oferta.preco < faixa.min || oferta.preco > faixa.max) {
      avisos.push(`${faixa.rotulo}: US$ ${oferta.preco} está fora da faixa sugerida (US$ ${faixa.min}–${faixa.max}).`);
    }
  }
  return avisos;
}

/* ---------------- sequência ---------------- */

/** Primeiro passo depois da compra da entrada. */
export function primeiraEtapa(escada: EscadaConfig): Etapa {
  if (escada.upsell) return "upsell";
  if (escada.recorrencia) return "recorrencia";
  return "obrigado";
}

/**
 * Próximo passo: upsell → (recusou) downsell → recorrência → obrigado. Aceitar o upsell pula o downsell.
 * O downsell só aparece para quem recusou o upsell.
 */
export function proximaEtapa(escada: EscadaConfig, etapa: Etapa, acao: Acao): Etapa {
  const depois = (): Etapa => (escada.recorrencia ? "recorrencia" : "obrigado");
  if (etapa === "upsell") {
    if (acao === "recusar" && escada.downsell) return "downsell";
    return depois();
  }
  if (etapa === "downsell") return depois();
  return "obrigado";
}

/** A oferta de cada passo (null no obrigado ou se o passo não está configurado). */
export function ofertaDaEtapa(escada: EscadaConfig, etapa: Etapa): Oferta | null {
  if (etapa === "obrigado") return null;
  return escada[etapa] ?? null;
}

/* ---------------- prazo real ---------------- */

/** Quando o desconto do upsell vence para uma sessão criada em `criadoEm` (null = sem prazo). */
export function calcularExpiracao(criadoEm: Date, prazoMinutos: number | null | undefined): Date | null {
  if (!prazoMinutos || prazoMinutos <= 0) return null;
  return new Date(criadoEm.getTime() + Math.min(prazoMinutos, MAX_PRAZO_MINUTOS) * 60_000);
}

/** Segundos que faltam (0 = venceu; null = sem prazo). */
export function segundosRestantes(expiraEm: Date | string | null | undefined, agora = new Date()): number | null {
  if (!expiraEm) return null;
  const fim = new Date(expiraEm).getTime();
  if (!Number.isFinite(fim)) return null;
  return Math.max(0, Math.floor((fim - agora.getTime()) / 1000));
}

export type PrecoAtual =
  | { situacao: "desconto" | "sem_prazo" | "cheio"; preco: number; checkoutUrl: string; segundos: number | null }
  | { situacao: "encerrada" };

/**
 * Preço e link que valem AGORA para o passo. Upsell com prazo: desconto até vencer; depois o preço cheio (se houver)
 * ou a oferta encerra. O link com desconto nunca é entregue depois do prazo (o servidor confere na hora do clique).
 */
export function precoAtual(escada: EscadaConfig, etapa: Etapa, expiraEm: Date | string | null | undefined, agora = new Date()): PrecoAtual {
  const oferta = ofertaDaEtapa(escada, etapa);
  if (!oferta) return { situacao: "encerrada" };
  if (etapa !== "upsell" || !escada.upsell?.prazoMinutos) {
    return { situacao: "sem_prazo", preco: oferta.preco, checkoutUrl: oferta.checkoutUrl, segundos: null };
  }
  const segundos = segundosRestantes(expiraEm, agora);
  if (segundos !== null && segundos > 0) return { situacao: "desconto", preco: oferta.preco, checkoutUrl: oferta.checkoutUrl, segundos };
  const upsell = escada.upsell;
  if (upsell.precoCheio && upsell.checkoutUrlCheio) return { situacao: "cheio", preco: upsell.precoCheio, checkoutUrl: upsell.checkoutUrlCheio, segundos: 0 };
  return { situacao: "encerrada" };
}

/** Termos da recorrência (padrão quando a pessoa não escreveu). */
export function termosRecorrencia(oferta: OfertaRecorrencia, moeda = "USD") {
  if (oferta.termos) return oferta.termos;
  return `Você será cobrado ${formatarPreco(oferta.preco, moeda)} por mês, a partir de hoje, até cancelar. Cancele quando quiser, sozinho, pelo link de cancelamento; a cobrança para no fim do mês já pago.`;
}

export function formatarPreco(valor: number, moeda = "USD") {
  try {
    return new Intl.NumberFormat(moeda === "BRL" ? "pt-BR" : "en-US", { style: "currency", currency: moeda }).format(valor);
  } catch {
    return `${moeda} ${valor.toFixed(2)}`;
  }
}

/* ---------------- valor médio por comprador ---------------- */

export type ContagemFunil = Partial<Record<
  | "clique_comprar" | "clique_comprar_bump" | "entrada"
  | "viu_upsell" | "aceitou_upsell" | "recusou_upsell"
  | "viu_downsell" | "aceitou_downsell" | "recusou_downsell"
  | "viu_recorrencia" | "aceitou_recorrencia" | "recusou_recorrencia"
  | "viu_obrigado" | "email_capturado",
  { quantidade: number; valor: number }
>>;

function taxa(parte: number, todo: number) {
  return todo > 0 ? Math.round((parte / todo) * 1000) / 10 : null;
}

/**
 * Métricas do funil. `receitaReal`: soma líquida das vendas (webhook) de todos os produtoRef da escada, e
 * `comprasEntrada`: vendas da entrada no período. O valor médio real = receitaReal / comprasEntrada. Sem vendas por
 * webhook, sobra a estimativa pelos cliques de aceite (preço da entrada × compradores + aceites) / compradores.
 */
export function metricasFunil(input: { precoEntrada: number; contagem: ContagemFunil; receitaReal?: number | null; comprasEntrada?: number | null }) {
  const c = (tipo: keyof ContagemFunil) => input.contagem[tipo]?.quantidade ?? 0;
  const v = (tipo: keyof ContagemFunil) => input.contagem[tipo]?.valor ?? 0;
  const compradores = c("entrada");
  const aceites = v("aceitou_upsell") + v("aceitou_downsell") + v("aceitou_recorrencia");
  const estimado = compradores > 0 ? Math.round(((input.precoEntrada * compradores + aceites) / compradores) * 100) / 100 : null;
  const real = input.receitaReal !== null && input.receitaReal !== undefined && input.comprasEntrada
    ? Math.round((input.receitaReal / input.comprasEntrada) * 100) / 100
    : null;
  return {
    compradores,
    upsell: { viram: c("viu_upsell"), aceitaram: c("aceitou_upsell"), recusaram: c("recusou_upsell"), taxa: taxa(c("aceitou_upsell"), c("viu_upsell")) },
    downsell: { viram: c("viu_downsell"), aceitaram: c("aceitou_downsell"), recusaram: c("recusou_downsell"), taxa: taxa(c("aceitou_downsell"), c("viu_downsell")) },
    recorrencia: { viram: c("viu_recorrencia"), aceitaram: c("aceitou_recorrencia"), taxa: taxa(c("aceitou_recorrencia"), c("viu_recorrencia")) },
    bump: { cliques: c("clique_comprar_bump"), taxa: taxa(c("clique_comprar_bump"), c("clique_comprar") + c("clique_comprar_bump")) },
    emails: c("email_capturado"),
    valorMedioEstimado: estimado,
    valorMedioReal: real,
  };
}

/* ---------------- pedido de depoimento ---------------- */

export const DEPOIMENTO_DIAS_PADRAO = 7;

/** Quando mandar o pedido de depoimento: `dias` depois da compra (1 a 90; padrão 7). */
export function agendarPedidoDepoimento(compradoEm: Date, dias: number | null | undefined = DEPOIMENTO_DIAS_PADRAO): Date {
  const d = Number.isFinite(dias) && dias ? Math.min(90, Math.max(1, Math.round(dias))) : DEPOIMENTO_DIAS_PADRAO;
  return new Date(compradoEm.getTime() + d * 86_400_000);
}

/** Espera entre tentativas de envio do pedido (e-mail com erro): 1 h, 6 h; depois desiste. */
export const DEPOIMENTO_MAX_TENTATIVAS = 3;
export function proximaTentativaDepoimento(tentativas: number, agora = new Date()): Date | null {
  if (tentativas >= DEPOIMENTO_MAX_TENTATIVAS) return null;
  const horas = tentativas <= 1 ? 1 : 6;
  return new Date(agora.getTime() + horas * 3600_000);
}
