import { randomBytes } from "node:crypto";
import { query } from "@/lib/db/client";
import {
  agendarPedidoDepoimento,
  calcularExpiracao,
  metricasFunil,
  parseEscada,
  primeiraEtapa,
  type ContagemFunil,
  type EscadaConfig,
  type Etapa,
} from "@/lib/vendas/escada";
import { parseObrigado, type ObrigadoConfig, type ProdutoInput } from "@/lib/vendas/produto";

/**
 * Escada de vendas (migração 0011): produtos, sessões da oferta pós-compra, eventos, compradores (lista própria) e
 * depoimentos. Sem a 0011 as tabelas não existem: `hasFunilTables` avisa e as telas/rotas respondem com calma.
 */
export const MIGRATION_0011_MISSING = "Falta colar a atualização 0011 no Supabase para usar produtos, escada de vendas, obrigado e depoimentos.";

let probe: { exists: boolean; checkedAt: number } | null = null;
export async function hasFunilTables() {
  if (probe && (probe.exists || Date.now() - probe.checkedAt < 60_000)) return probe.exists;
  const { rows } = await query<{ exists: boolean }>("select to_regclass('public.produtos') is not null as exists");
  probe = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
  return probe.exists;
}

/* ---------------- produtos ---------------- */

type ProdutoRow = {
  id: string;
  slug: string;
  nome: string;
  promessa: string;
  preco: string;
  moeda: string;
  produto_ref: string | null;
  checkout_url: string | null;
  modo: "normal" | "prevenda";
  prevenda_entrega: string | Date | null;
  o_que_recebe: string[];
  escada: unknown;
  obrigado: unknown;
  depoimento_ativo: boolean;
  depoimento_dias: number;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
};

export type Produto = Omit<ProdutoInput, "escada" | "obrigado"> & {
  id: string;
  escada: EscadaConfig;
  obrigado: ObrigadoConfig;
  criadoEm: string;
  atualizadoEm: string;
};

function dataIso(value: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return String(value).slice(0, 10);
}

function toProduto(row: ProdutoRow): Produto {
  return {
    id: row.id,
    slug: row.slug,
    nome: row.nome,
    promessa: row.promessa,
    preco: Number(row.preco),
    moeda: row.moeda,
    produtoRef: row.produto_ref,
    checkoutUrl: row.checkout_url,
    modo: row.modo,
    prevendaEntrega: dataIso(row.prevenda_entrega),
    oQueRecebe: row.o_que_recebe ?? [],
    // relida pelo mesmo leitor da tela: um JSON velho ou mexido à mão no banco não quebra a página
    escada: parseEscada(row.escada).escada,
    obrigado: parseObrigado(row.obrigado),
    depoimentoAtivo: row.depoimento_ativo,
    depoimentoDias: row.depoimento_dias,
    ativo: row.ativo,
    criadoEm: new Date(row.criado_em).toISOString(),
    atualizadoEm: new Date(row.atualizado_em).toISOString(),
  };
}

export class SlugEmUsoError extends Error {
  constructor() {
    super("Esse endereço (slug) já é de outro produto. Escolha outro.");
  }
}

function valores(input: ProdutoInput) {
  return [
    input.slug, input.nome, input.promessa, input.preco, input.moeda, input.produtoRef, input.checkoutUrl, input.modo,
    input.prevendaEntrega, input.oQueRecebe, JSON.stringify(input.escada), JSON.stringify(input.obrigado),
    input.depoimentoAtivo, input.depoimentoDias, input.ativo,
  ];
}

export async function criarProduto(input: ProdutoInput): Promise<Produto> {
  try {
    const { rows } = await query<ProdutoRow>(
      `insert into public.produtos (slug, nome, promessa, preco, moeda, produto_ref, checkout_url, modo, prevenda_entrega, o_que_recebe,
         escada, obrigado, depoimento_ativo, depoimento_dias, ativo)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15)
       returning *`,
      valores(input),
    );
    return toProduto(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new SlugEmUsoError();
    throw error;
  }
}

export async function atualizarProduto(id: string, input: ProdutoInput): Promise<Produto | null> {
  try {
    const { rows } = await query<ProdutoRow>(
      `update public.produtos set slug = $1, nome = $2, promessa = $3, preco = $4, moeda = $5, produto_ref = $6, checkout_url = $7,
         modo = $8, prevenda_entrega = $9, o_que_recebe = $10, escada = $11::jsonb, obrigado = $12::jsonb, depoimento_ativo = $13,
         depoimento_dias = $14, ativo = $15, atualizado_em = now()
       where id = $16
       returning *`,
      [...valores(input), id],
    );
    return rows[0] ? toProduto(rows[0]) : null;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new SlugEmUsoError();
    throw error;
  }
}

export async function apagarProduto(id: string) {
  const { rowCount } = await query("delete from public.produtos where id = $1", [id]);
  return Boolean(rowCount);
}

export async function listarProdutos(): Promise<Produto[]> {
  const { rows } = await query<ProdutoRow>("select * from public.produtos order by criado_em desc limit 200");
  return rows.map(toProduto);
}

export async function getProduto(id: string): Promise<Produto | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await query<ProdutoRow>("select * from public.produtos where id = $1", [id]);
  return rows[0] ? toProduto(rows[0]) : null;
}

/** Produto ativo pelo endereço público. Sem a 0011 (ou slug inválido): null. */
export async function getProdutoPublico(slug: string): Promise<Produto | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(slug)) return null;
  if (!(await hasFunilTables())) return null;
  const { rows } = await query<ProdutoRow>("select * from public.produtos where slug = $1 and ativo", [slug]);
  return rows[0] ? toProduto(rows[0]) : null;
}

/* ---------------- sessões da oferta pós-compra ---------------- */

export type Sessao = {
  id: string;
  produtoId: string;
  compraRef: string | null;
  etapa: Etapa;
  ofertaExpiraEm: string | null;
  aceitouRecorrencia: boolean;
  criadoEm: string;
};

type SessaoRow = { id: string; produto_id: string; compra_ref: string | null; etapa: Etapa; oferta_expira_em: string | null; aceitou_recorrencia: boolean; criado_em: string };

function toSessao(row: SessaoRow): Sessao {
  return {
    id: row.id,
    produtoId: row.produto_id,
    compraRef: row.compra_ref,
    etapa: row.etapa,
    ofertaExpiraEm: row.oferta_expira_em ? new Date(row.oferta_expira_em).toISOString() : null,
    aceitouRecorrencia: row.aceitou_recorrencia,
    criadoEm: new Date(row.criado_em).toISOString(),
  };
}

export async function getSessao(id: string | null | undefined, produtoId?: string): Promise<Sessao | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await query<SessaoRow>(
    `select * from public.funil_sessoes where id = $1 ${produtoId ? "and produto_id = $2" : ""}`,
    produtoId ? [id, produtoId] : [id],
  );
  return rows[0] ? toSessao(rows[0]) : null;
}

/**
 * A sessão desta compra: a mesma compra (compra_ref) ou o mesmo navegador (cookie) sempre voltam para a MESMA sessão,
 * com o MESMO prazo. O prazo do desconto é calculado na criação e nunca é regravado (urgência real, sem relógio que
 * reinicia). Devolve também se a sessão é nova.
 */
export async function abrirSessao(produto: Produto, input: { compraRef?: string | null; cookieSessaoId?: string | null }, agora = new Date()): Promise<{ sessao: Sessao; nova: boolean }> {
  const compraRef = input.compraRef && /^[A-Za-z0-9_.:-]{3,200}$/.test(input.compraRef) ? input.compraRef : null;
  if (compraRef) {
    const { rows } = await query<SessaoRow>("select * from public.funil_sessoes where produto_id = $1 and compra_ref = $2", [produto.id, compraRef]);
    if (rows[0]) return { sessao: toSessao(rows[0]), nova: false };
  }
  const daCookie = await getSessao(input.cookieSessaoId, produto.id);
  if (daCookie && (!compraRef || !daCookie.compraRef || daCookie.compraRef === compraRef)) {
    if (compraRef && !daCookie.compraRef) {
      await query("update public.funil_sessoes set compra_ref = $2, atualizado_em = now() where id = $1 and compra_ref is null", [daCookie.id, compraRef]).catch(() => undefined);
    }
    return { sessao: daCookie, nova: false };
  }
  const expira = calcularExpiracao(agora, produto.escada.upsell?.prazoMinutos);
  const { rows } = await query<SessaoRow>(
    `insert into public.funil_sessoes (produto_id, compra_ref, etapa, oferta_expira_em, criado_em)
     values ($1, $2, $3, $4, $5)
     on conflict (produto_id, compra_ref) do update set atualizado_em = public.funil_sessoes.atualizado_em
     returning *, (xmax = 0) as nova`,
    [produto.id, compraRef, primeiraEtapa(produto.escada), expira, agora],
  );
  const row = rows[0] as SessaoRow & { nova: boolean };
  return { sessao: toSessao(row), nova: row.nova };
}

/** Muda o passo só se a sessão ainda estiver no passo esperado (dois cliques seguidos não pulam dois passos). */
export async function avancarSessao(id: string, de: Etapa, para: Etapa, extra: { aceitouRecorrencia?: boolean } = {}) {
  const { rows } = await query<SessaoRow>(
    `update public.funil_sessoes set etapa = $3, aceitou_recorrencia = aceitou_recorrencia or $4, atualizado_em = now()
     where id = $1 and etapa = $2 returning *`,
    [id, de, para, Boolean(extra.aceitouRecorrencia)],
  );
  return rows[0] ? toSessao(rows[0]) : null;
}

/* ---------------- eventos ---------------- */

export type TipoEvento = keyof ContagemFunil;

/** Grava o evento (uma vez por tipo e sessão). Nunca joga erro: medir não pode derrubar a venda. */
export async function registrarEventoFunil(produtoId: string, tipo: TipoEvento, input: { sessaoId?: string | null; valor?: number } = {}) {
  try {
    await query(
      `insert into public.funil_eventos (sessao_id, produto_id, tipo, valor) values ($1, $2, $3, $4)
       on conflict (sessao_id, tipo) where sessao_id is not null do nothing`,
      [input.sessaoId ?? null, produtoId, tipo, input.valor ?? 0],
    );
  } catch (error) {
    console.error("[funil] não consegui gravar o evento:", error instanceof Error ? error.message : error);
  }
}

/* ---------------- métricas ---------------- */

export type MetricasProduto = ReturnType<typeof metricasFunil> & { receitaReal: number | null; comprasEntrada: number | null };

/** Valor médio por comprador e taxas de aceite de cada produto nos últimos `dias`. */
export async function metricasProdutos(produtos: Produto[], dias = 30): Promise<Map<string, MetricasProduto>> {
  if (!produtos.length) return new Map();
  const { rows } = await query<{ produto_id: string; tipo: TipoEvento; quantidade: string; valor: string }>(
    `select produto_id, tipo, count(*) as quantidade, coalesce(sum(valor), 0) as valor
     from public.funil_eventos
     where criado_em >= now() - make_interval(days => $1::int)
     group by produto_id, tipo`,
    [dias],
  );
  const contagens = new Map<string, ContagemFunil>();
  for (const row of rows) {
    const atual = contagens.get(row.produto_id) ?? {};
    atual[row.tipo] = { quantidade: Number(row.quantidade), valor: Number(row.valor) };
    contagens.set(row.produto_id, atual);
  }

  // Receita real: vendas por webhook (0010) com o produtoRef de cada degrau da escada.
  const receitas = new Map<string, { receita: number; compras: number }>();
  const temVendas = (await query<{ exists: boolean }>("select to_regclass('public.vendas') is not null as exists")).rows[0]?.exists;
  if (temVendas) {
    for (const produto of produtos) {
      const refs = refsDaEscada(produto);
      if (!produto.produtoRef || !refs.length) continue;
      const { rows: vendas } = await query<{ produto_ref: string; vendas: string; liquido: string }>(
        `select produto_ref, count(*) as vendas,
                coalesce(sum(valor - case when status = 'contestada' then valor else least(valor, valor_reembolsado) end), 0) as liquido
         from public.vendas
         where teste = false and produto_ref = any($1::text[]) and criado_em >= now() - make_interval(days => $2::int)
         group by produto_ref`,
        [refs, dias],
      );
      const compras = Number(vendas.find((venda) => venda.produto_ref === produto.produtoRef)?.vendas ?? 0);
      const receita = vendas.reduce((soma, venda) => soma + Number(venda.liquido), 0);
      if (compras > 0) receitas.set(produto.id, { receita: Math.round(receita * 100) / 100, compras });
    }
  }

  const out = new Map<string, MetricasProduto>();
  for (const produto of produtos) {
    const receita = receitas.get(produto.id);
    out.set(produto.id, {
      ...metricasFunil({ precoEntrada: produto.preco, contagem: contagens.get(produto.id) ?? {}, receitaReal: receita?.receita ?? null, comprasEntrada: receita?.compras ?? null }),
      receitaReal: receita?.receita ?? null,
      comprasEntrada: receita?.compras ?? null,
    });
  }
  return out;
}

/** produtoRef da entrada e de cada degrau (bump, upsell, preço cheio, downsell, recorrência). */
export function refsDaEscada(produto: Pick<Produto, "produtoRef" | "escada">) {
  const refs = [produto.produtoRef, produto.escada.bump?.produtoRef, produto.escada.upsell?.produtoRef, produto.escada.downsell?.produtoRef, produto.escada.recorrencia?.produtoRef];
  return [...new Set(refs.filter((ref): ref is string => Boolean(ref)))];
}

/* ---------------- compradores (lista própria) ---------------- */

export type Comprador = {
  id: string;
  produtoId: string | null;
  produtoNome: string | null;
  email: string;
  nome: string | null;
  aceitaNovidades: boolean;
  prevenda: boolean;
  avisadoEntregaEm: string | null;
  depoimentoToken: string | null;
  depoimentoPedirEm: string | null;
  depoimentoPedidoEm: string | null;
  depoimentoCanal: string | null;
  depoimentoErro: string | null;
  descadastradoEm: string | null;
  criadoEm: string;
};

type CompradorRow = {
  id: string; produto_id: string | null; produto_nome?: string | null; email: string; nome: string | null; aceita_novidades: boolean; prevenda: boolean;
  avisado_entrega_em: string | null; depoimento_token: string | null; depoimento_pedir_em: string | null; depoimento_pedido_em: string | null;
  depoimento_canal: string | null; depoimento_erro: string | null; descadastrado_em: string | null; criado_em: string;
};

const iso = (value: string | null) => (value ? new Date(value).toISOString() : null);

function toComprador(row: CompradorRow): Comprador {
  return {
    id: row.id,
    produtoId: row.produto_id,
    produtoNome: row.produto_nome ?? null,
    email: row.email,
    nome: row.nome,
    aceitaNovidades: row.aceita_novidades,
    prevenda: row.prevenda,
    avisadoEntregaEm: iso(row.avisado_entrega_em),
    depoimentoToken: row.depoimento_token,
    depoimentoPedirEm: iso(row.depoimento_pedir_em),
    depoimentoPedidoEm: iso(row.depoimento_pedido_em),
    depoimentoCanal: row.depoimento_canal,
    depoimentoErro: row.depoimento_erro,
    descadastradoEm: iso(row.descadastrado_em),
    criadoEm: new Date(row.criado_em).toISOString(),
  };
}

export function emailValido(email: string) {
  return email.length <= 200 && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i.test(email);
}

export function novoToken() {
  return randomBytes(18).toString("base64url");
}

/**
 * Grava o e-mail que a pessoa deixou na página de obrigado (lista própria). O mesmo e-mail no mesmo produto não
 * duplica: atualiza o nome/caixa de novidades e mantém o agendamento já feito. O pedido de depoimento fica agendado
 * para `depoimento_dias` depois (se o produto pede depoimento).
 */
export async function salvarComprador(produto: Produto, input: { email: string; nome?: string | null; aceitaNovidades: boolean; sessaoId?: string | null; compraRef?: string | null }, agora = new Date()) {
  const email = input.email.trim().toLowerCase();
  const pedirEm = produto.depoimentoAtivo ? agendarPedidoDepoimento(agora, produto.depoimentoDias) : null;
  const { rows } = await query<CompradorRow>(
    `insert into public.compradores (produto_id, email, nome, aceita_novidades, sessao_id, compra_ref, prevenda, depoimento_token, depoimento_pedir_em, criado_em)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (coalesce(produto_id::text, ''), lower(email)) do update set
       nome = coalesce(excluded.nome, public.compradores.nome),
       aceita_novidades = public.compradores.aceita_novidades or excluded.aceita_novidades,
       sessao_id = coalesce(public.compradores.sessao_id, excluded.sessao_id),
       compra_ref = coalesce(public.compradores.compra_ref, excluded.compra_ref),
       descadastrado_em = null,
       atualizado_em = now()
     returning *`,
    [produto.id, email, input.nome?.trim().slice(0, 120) || null, input.aceitaNovidades, input.sessaoId ?? null, input.compraRef ?? null, produto.modo === "prevenda", novoToken(), pedirEm, agora],
  );
  return toComprador(rows[0]);
}

export async function listarCompradores(filtro: { produtoId?: string | null; prevenda?: boolean } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filtro.produtoId) { params.push(filtro.produtoId); where.push(`c.produto_id = $${params.length}`); }
  if (filtro.prevenda) where.push("c.prevenda");
  const { rows } = await query<CompradorRow>(
    `select c.*, p.nome as produto_nome from public.compradores c left join public.produtos p on p.id = c.produto_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by c.criado_em desc limit 5000`,
    params,
  );
  return rows.map(toComprador);
}

/** Marca quem comprou na pré-venda deste produto como avisado da entrega. */
export async function marcarAvisadosEntrega(produtoId: string) {
  const { rowCount } = await query(
    "update public.compradores set avisado_entrega_em = now(), atualizado_em = now() where produto_id = $1 and prevenda and avisado_entrega_em is null",
    [produtoId],
  );
  return rowCount ?? 0;
}

export async function getCompradorPorToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  if (!(await hasFunilTables())) return null;
  const { rows } = await query<CompradorRow>(
    "select c.*, p.nome as produto_nome from public.compradores c left join public.produtos p on p.id = c.produto_id where c.depoimento_token = $1",
    [token],
  );
  return rows[0] ? toComprador(rows[0]) : null;
}

export async function descadastrar(token: string) {
  const { rowCount } = await query(
    "update public.compradores set descadastrado_em = coalesce(descadastrado_em, now()), aceita_novidades = false, atualizado_em = now() where depoimento_token = $1",
    [token],
  );
  return Boolean(rowCount);
}

/* ---------------- pedido de depoimento (relógio) ---------------- */

export type PedidoDepoimento = Comprador & { tentativas: number };

/**
 * Pega até `limite` pedidos vencidos e ainda não mandados, travando por 10 min (adiando o próximo horário): dois
 * relógios ao mesmo tempo nunca mandam o mesmo e-mail duas vezes.
 */
export async function pegarPedidosVencidos(limite = 5, agora = new Date()): Promise<PedidoDepoimento[]> {
  const { rows } = await query<CompradorRow & { depoimento_tentativas: number }>(
    `with alvo as (
       select id from public.compradores
       where depoimento_pedido_em is null and descadastrado_em is null and depoimento_pedir_em is not null
         and depoimento_pedir_em <= $2 and depoimento_token is not null
       order by depoimento_pedir_em
       limit $1
       for update skip locked
     )
     update public.compradores c set depoimento_pedir_em = $2::timestamptz + interval '10 minutes', atualizado_em = now()
     from alvo where c.id = alvo.id
     returning c.*, (select nome from public.produtos p where p.id = c.produto_id) as produto_nome`,
    [limite, agora],
  );
  return rows.map((row) => ({ ...toComprador(row), tentativas: row.depoimento_tentativas }));
}

export async function marcarPedidoEnviado(id: string, canal: "email" | "manual") {
  await query(
    "update public.compradores set depoimento_pedido_em = now(), depoimento_canal = $2, depoimento_erro = null, atualizado_em = now() where id = $1",
    [id, canal],
  );
}

/** Erro no envio: tenta de novo em `proxima` (ou desiste com null e deixa para mandar à mão pelo painel). */
export async function marcarPedidoErro(id: string, erro: string, proxima: Date | null) {
  await query(
    `update public.compradores set depoimento_tentativas = depoimento_tentativas + 1, depoimento_erro = $2,
       depoimento_pedir_em = $3, atualizado_em = now() where id = $1`,
    [id, erro.slice(0, 300), proxima],
  );
}

/** Devolve o pedido travado para o próximo minuto, sem contar tentativa. */
export async function soltarPedido(id: string) {
  await query("update public.compradores set depoimento_pedir_em = now(), atualizado_em = now() where id = $1 and depoimento_pedido_em is null", [id]);
}

/* ---------------- depoimentos ---------------- */

export type Depoimento = {
  id: string;
  produtoId: string | null;
  produtoNome: string | null;
  nomeExibicao: string | null;
  oQueFuncionou: string;
  depoimento: string | null;
  printKey: string | null;
  autorizaUso: boolean;
  autorizadoEm: string | null;
  criadoEm: string;
};

type DepoimentoRow = {
  id: string; produto_id: string | null; produto_nome: string | null; nome_exibicao: string | null; o_que_funcionou: string; depoimento: string | null;
  print_key: string | null; autoriza_uso: boolean; autorizado_em: string | null; criado_em: string;
};

export async function salvarDepoimento(comprador: Comprador, input: { nomeExibicao: string | null; oQueFuncionou: string; depoimento: string | null; printKey: string | null; autorizaUso: boolean }) {
  const { rows } = await query<{ id: string }>(
    `insert into public.depoimentos (comprador_id, produto_id, nome_exibicao, o_que_funcionou, depoimento, print_key, autoriza_uso, autorizado_em)
     values ($1, $2, $3, $4, $5, $6, $7, case when $7 then now() else null end) returning id`,
    [comprador.id, comprador.produtoId, input.nomeExibicao, input.oQueFuncionou, input.depoimento, input.printKey, input.autorizaUso],
  );
  return rows[0].id;
}

export async function listarDepoimentos(filtro: { produtoId?: string | null; soAutorizados?: boolean } = {}): Promise<Depoimento[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filtro.produtoId) { params.push(filtro.produtoId); where.push(`d.produto_id = $${params.length}`); }
  if (filtro.soAutorizados) where.push("d.autoriza_uso");
  const { rows } = await query<DepoimentoRow>(
    `select d.*, p.nome as produto_nome from public.depoimentos d left join public.produtos p on p.id = d.produto_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by d.criado_em desc limit 1000`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    produtoId: row.produto_id,
    produtoNome: row.produto_nome,
    nomeExibicao: row.nome_exibicao,
    oQueFuncionou: row.o_que_funcionou,
    depoimento: row.depoimento,
    printKey: row.print_key,
    autorizaUso: row.autoriza_uso,
    autorizadoEm: iso(row.autorizado_em),
    criadoEm: new Date(row.criado_em).toISOString(),
  }));
}
