import { linkValido, parseEscada, type EscadaConfig } from "@/lib/vendas/escada";

/**
 * Produto vendido pelo UaiFlow: página de uma tela (/p/<slug>), link de pagamento na plataforma, modo pré-venda, a
 * escada e a página de obrigado com o próximo passo. Leitura e conferência do que a tela manda (sem banco).
 */
export const PROXIMOS_PASSOS = ["nenhum", "upsell", "curso_email", "convite"] as const;
export type ProximoPassoTipo = (typeof PROXIMOS_PASSOS)[number];

export const PROXIMO_PASSO_NOME: Record<ProximoPassoTipo, string> = {
  nenhum: "Nenhum",
  upsell: "Próxima oferta",
  curso_email: "Curso por e-mail",
  convite: "Convite (grupo, aula, mentoria)",
};

export type ObrigadoConfig = {
  texto: string;
  proximoPasso: { tipo: ProximoPassoTipo; titulo: string; texto: string; link: string | null };
};

export type ProdutoInput = {
  slug: string;
  nome: string;
  promessa: string;
  preco: number;
  moeda: string;
  produtoRef: string | null;
  checkoutUrl: string | null;
  modo: "normal" | "prevenda";
  prevendaEntrega: string | null;
  oQueRecebe: string[];
  escada: EscadaConfig;
  obrigado: ObrigadoConfig;
  depoimentoAtivo: boolean;
  depoimentoDias: number;
  ativo: boolean;
};

export const MOEDAS = ["USD", "BRL", "EUR", "GBP"] as const;

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

/** Texto → slug do endereço (/p/<slug>): minúsculas, sem acento, hífens. */
export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export function slugValido(slug: string) {
  return /^[a-z0-9][a-z0-9-]{1,47}$/.test(slug);
}

function lista(value: unknown, maxItens = 12): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/) : [];
  return raw.map((item) => (typeof item === "string" ? item.trim().replace(/^[-•*]\s*/, "").slice(0, 200) : "")).filter(Boolean).slice(0, maxItens);
}

export function parseObrigado(raw: unknown, erros: string[] = []): ObrigadoConfig {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const passo = input.proximoPasso && typeof input.proximoPasso === "object" ? (input.proximoPasso as Record<string, unknown>) : {};
  const tipo = (PROXIMOS_PASSOS as readonly string[]).includes(String(passo.tipo)) ? (passo.tipo as ProximoPassoTipo) : "nenhum";
  const link = texto(passo.link, 1000);
  if (tipo !== "nenhum" && link && !linkValido(link)) erros.push("Próximo passo: o link precisa começar com https://.");
  if (tipo !== "nenhum" && !texto(passo.titulo, 120)) erros.push("Próximo passo: falta o título.");
  return {
    texto: texto(input.texto, 2000),
    proximoPasso: { tipo, titulo: texto(passo.titulo, 120), texto: texto(passo.texto, 600), link: link || null },
  };
}

/** Lê o produto mandado pela tela (criar e editar mandam o produto inteiro). */
export function parseProduto(body: Record<string, unknown>): { ok: true; value: ProdutoInput; avisos: string[] } | { ok: false; error: string } {
  const erros: string[] = [];
  const nome = texto(body.nome, 120);
  if (!nome) erros.push("Falta o nome do produto.");
  const slug = texto(body.slug, 48).toLowerCase() || slugify(nome);
  if (!slugValido(slug)) erros.push("Endereço (slug) inválido: use letras minúsculas, números e hífen (2 a 48).");
  const preco = numero(body.preco);
  if (preco === null || preco < 0) erros.push("Preço inválido.");
  const moeda = texto(body.moeda, 3).toUpperCase() || "USD";
  if (!(MOEDAS as readonly string[]).includes(moeda)) erros.push(`Moeda inválida: use ${MOEDAS.join(", ")}.`);
  const checkoutUrl = texto(body.checkoutUrl, 1000);
  if (checkoutUrl && !linkValido(checkoutUrl)) erros.push("O link de pagamento precisa começar com https://.");
  const modo = body.modo === "prevenda" ? "prevenda" : "normal";
  const prevendaEntrega = texto(body.prevendaEntrega, 10);
  if (modo === "prevenda" && !/^\d{4}-\d{2}-\d{2}$/.test(prevendaEntrega)) erros.push("Pré-venda: falta o prazo de entrega (data).");
  const dias = numero(body.depoimentoDias);
  if (dias !== null && (dias < 1 || dias > 90)) erros.push("Pedido de depoimento: de 1 a 90 dias depois da compra.");

  const { escada, erros: errosEscada } = parseEscada(body.escada);
  erros.push(...errosEscada);
  if (escada.bump && !checkoutUrl) erros.push("Order bump: configure antes o link de pagamento da entrada.");
  const obrigado = parseObrigado(body.obrigado, erros);

  if (erros.length) return { ok: false, error: erros.join(" ") };
  return {
    ok: true,
    avisos: [],
    value: {
      slug,
      nome,
      promessa: texto(body.promessa, 400),
      preco: preco ?? 0,
      moeda,
      produtoRef: texto(body.produtoRef, 120) || null,
      checkoutUrl: checkoutUrl || null,
      modo,
      prevendaEntrega: modo === "prevenda" ? prevendaEntrega : null,
      oQueRecebe: lista(body.oQueRecebe),
      escada,
      obrigado,
      depoimentoAtivo: body.depoimentoAtivo !== false,
      depoimentoDias: dias ? Math.round(dias) : 7,
      ativo: body.ativo !== false,
    },
  };
}

/* ---------------- escada vinda da página do Molde ---------------- */

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function primeiro(item: Json, chaves: string[], max = 600) {
  for (const chave of chaves) {
    const valor = texto(item[chave], max);
    if (valor) return valor;
  }
  return "";
}

function ofertaMolde(item: Json | null) {
  if (!item) return null;
  return {
    nome: primeiro(item, ["nome", "titulo", "name"], 120),
    preco: numero(item.preco ?? item.price) ?? 0,
    texto: primeiro(item, ["texto", "promessa", "descricao", "description"]),
    checkoutUrl: primeiro(item, ["checkoutUrl", "link", "url"], 1000),
    produtoRef: primeiro(item, ["produtoRef", "ref"], 120) || null,
  };
}

/**
 * Importa a escada colada da página do Molde: { entrada: {nome, preco, ...}, meio: {...}, topo: {...}, obrigado: {texto} }.
 * Mapeamento: entrada = o produto (nome, preço, promessa, link, o que recebe); meio = upsell depois da compra;
 * topo = próximo passo da página de obrigado (convite); obrigado.texto = texto da página de obrigado. Se o JSON também
 * trouxer bump, downsell ou recorrencia, eles entram como estão. Não salva: devolve o rascunho para a tela conferir.
 */
export function parseEscadaMolde(raw: unknown): { ok: true; produto: Partial<ProdutoInput>; avisos: string[] } | { ok: false; error: string } {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: "JSON inválido: confira se colou o texto inteiro, começando por { e terminando por }." };
    }
  }
  const root = obj(data);
  if (!root) return { ok: false, error: "JSON inválido: esperado um objeto com entrada, meio, topo e obrigado." };
  const entrada = obj(root.entrada);
  if (!entrada) return { ok: false, error: "Falta a parte «entrada» (o produto de entrada)." };

  const avisos: string[] = [];
  const nome = primeiro(entrada, ["nome", "titulo", "name"], 120);
  const checkoutUrl = primeiro(entrada, ["checkoutUrl", "link", "url"], 1000);
  if (!checkoutUrl) avisos.push("A entrada veio sem link de pagamento: cole o link da plataforma antes de salvar.");

  const escada: EscadaConfig = {};
  const meio = ofertaMolde(obj(root.meio));
  if (meio?.nome) {
    escada.upsell = { ...meio, prazoMinutos: numero(obj(root.meio)?.prazoMinutos) ?? null, precoCheio: null, checkoutUrlCheio: null };
    if (!meio.checkoutUrl) avisos.push("O meio (upsell) veio sem link de pagamento.");
  }
  const bump = ofertaMolde(obj(root.bump));
  if (bump?.nome) escada.bump = bump;
  const downsell = ofertaMolde(obj(root.downsell));
  if (downsell?.nome) escada.downsell = { ...downsell, parcelas: numero(obj(root.downsell)?.parcelas) ?? null };
  const rec = obj(root.recorrencia);
  const recorrencia = ofertaMolde(rec);
  if (recorrencia?.nome && rec) {
    escada.recorrencia = { ...recorrencia, cancelarUrl: primeiro(rec, ["cancelarUrl", "cancelar"], 1000), termos: primeiro(rec, ["termos"], 1200) || null };
    if (!escada.recorrencia.cancelarUrl) avisos.push("A recorrência veio sem link de cancelamento: ele é obrigatório.");
  }

  const topo = obj(root.topo);
  const obrigadoRaw = obj(root.obrigado);
  const proximoPasso: ObrigadoConfig["proximoPasso"] = topo && primeiro(topo, ["nome", "titulo", "name"], 120)
    ? {
        tipo: "convite",
        titulo: primeiro(topo, ["nome", "titulo", "name"], 120),
        texto: [primeiro(topo, ["texto", "promessa", "descricao", "description"]), numero(topo.preco) ? `A partir de US$ ${numero(topo.preco)}.` : ""].filter(Boolean).join(" "),
        link: primeiro(topo, ["link", "url", "checkoutUrl"], 1000) || null,
      }
    : { tipo: "nenhum", titulo: "", texto: "", link: null };

  return {
    ok: true,
    avisos,
    produto: {
      nome,
      slug: slugify(nome),
      promessa: primeiro(entrada, ["promessa", "texto", "descricao", "description"], 400),
      preco: numero(entrada.preco ?? entrada.price) ?? 0,
      checkoutUrl: checkoutUrl || null,
      produtoRef: primeiro(entrada, ["produtoRef", "ref"], 120) || null,
      oQueRecebe: lista(entrada.oQueRecebe ?? entrada.itens ?? entrada.entregaveis),
      escada,
      obrigado: { texto: obrigadoRaw ? primeiro(obrigadoRaw, ["texto", "mensagem"], 2000) : "", proximoPasso },
    },
  };
}
