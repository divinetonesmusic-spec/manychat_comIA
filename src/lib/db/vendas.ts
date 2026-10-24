import { query } from "@/lib/db/client";
import type { Plataforma, VendaEvento } from "@/lib/vendas/webhooks";

/** Vendas e reembolsos que chegam por webhook (0010). Nenhum dado pessoal do cliente. */
type Evento = Exclude<VendaEvento, { tipo: "ignorar" }>;

export const MIGRATION_0012_MISSING = "Falta colar a atualização 0012 no Supabase (veja docs/ATUALIZACAO_0012.md).";

/** A 0012 foi colada? (a coluna vendas.origem chega junto com as plataformas novas). Lembra o "sim"; o "não" vale 1 min. */
let origemColumn: { exists: boolean; checkedAt: number } | null = null;
export async function hasVendasOrigemColumn() {
  if (origemColumn && (origemColumn.exists || Date.now() - origemColumn.checkedAt < 60_000)) return origemColumn.exists;
  const { rows } = await query<{ exists: boolean }>(
    `select exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'vendas' and column_name = 'origem') as exists`,
  );
  origemColumn = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
  return origemColumn.exists;
}

export type VendaRow = {
  id: string;
  plataforma: Plataforma;
  raw_id: string;
  pagamento_id: string | null;
  produto_ref: string | null;
  produto_id: string | null;
  produto_nome: string | null;
  valor: string;
  moeda: string;
  status: "paga" | "reembolsada" | "reembolso_parcial" | "contestada";
  valor_reembolsado: string;
  teste: boolean;
  criado_em: string;
  recebido_em: string;
  atualizado_em: string;
};

/**
 * Grava o aviso. Venda: insere uma vez por (plataforma, raw_id) — o mesmo aviso de novo não duplica nem muda nada.
 * Reembolso e contestação: mudam a venda achada (pelo raw_id ou pelo pagamento_id); sem venda achada, grava uma linha
 * só com o reembolso (o aviso da venda pode chegar depois, ou nunca ter chegado).
 * Devolve "nova", "repetida" ou "atualizada".
 */
export async function registrarEvento(plataforma: Plataforma, evento: Evento): Promise<"nova" | "repetida" | "atualizada"> {
  // A origem do post (0012): sem a coluna, a venda é gravada como antes (sem saber de qual post veio).
  const comOrigem = await hasVendasOrigemColumn();
  const origem = comOrigem ? evento.origem ?? null : null;
  if (evento.tipo === "venda") {
    const { rows } = await query<{ id: string }>(
      `insert into public.vendas (plataforma, raw_id, pagamento_id, produto_ref, produto_id, produto_nome, valor, moeda, teste, criado_em${comOrigem ? ", origem" : ""})
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, now())${comOrigem ? ", $11" : ""})
       on conflict (plataforma, raw_id) do nothing
       returning id`,
      [plataforma, evento.rawId, evento.pagamentoId ?? null, evento.produtoRef ?? null, evento.produtoId ?? null, evento.produtoNome ?? null, evento.valor ?? 0, evento.moeda ?? "USD", Boolean(evento.teste), evento.criadoEm ?? null, ...(comOrigem ? [origem] : [])],
    );
    return rows.length ? "nova" : "repetida";
  }

  const status = evento.tipo === "contestacao" ? "contestada" : evento.reembolsoTotal === false ? "reembolso_parcial" : "reembolsada";
  const ids = [evento.rawId, evento.pagamentoId].filter(Boolean) as string[];
  const { rows } = await query<{ id: string; status: string; valor_reembolsado: string }>(
    `update public.vendas
     set status = $3,
         valor_reembolsado = case when $3 = 'contestada' then valor_reembolsado else greatest(valor_reembolsado, coalesce($4, valor)) end,
         atualizado_em = now()${comOrigem ? ", origem = coalesce(origem, $5)" : ""}
     where plataforma = $1 and (raw_id = any($2::text[]) or pagamento_id = any($2::text[]))
     returning id, status, valor_reembolsado`,
    [plataforma, ids, status, evento.valorReembolsado ?? null, ...(comOrigem ? [origem] : [])],
  );
  if (rows.length) return "atualizada";
  const inserted = await query<{ id: string }>(
    `insert into public.vendas (plataforma, raw_id, pagamento_id, produto_ref, produto_id, produto_nome, valor, moeda, status, valor_reembolsado, teste, criado_em${comOrigem ? ", origem" : ""})
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, now())${comOrigem ? ", $13" : ""})
     on conflict (plataforma, raw_id) do update set status = excluded.status, valor_reembolsado = excluded.valor_reembolsado, atualizado_em = now()
     returning id`,
    [
      plataforma, evento.rawId, evento.pagamentoId ?? null, evento.produtoRef ?? null, evento.produtoId ?? null, evento.produtoNome ?? null,
      evento.valor ?? evento.valorReembolsado ?? 0, evento.moeda ?? "USD", status, status === "contestada" ? 0 : evento.valorReembolsado ?? evento.valor ?? 0,
      Boolean(evento.teste), evento.criadoEm ?? null, ...(comOrigem ? [origem] : []),
    ],
  );
  return inserted.rows.length ? "atualizada" : "repetida";
}

type Totais = { vendas: number; reembolsos: number; contestacoes: number; bruto: number; reembolsado: number; liquido: number };

function totais(rows: Array<{ status: string; valor: string; valor_reembolsado: string }>): Totais {
  const out: Totais = { vendas: 0, reembolsos: 0, contestacoes: 0, bruto: 0, reembolsado: 0, liquido: 0 };
  for (const row of rows) {
    const valor = Number(row.valor) || 0;
    const reembolsado = row.status === "contestada" ? valor : Number(row.valor_reembolsado) || 0;
    out.vendas += 1;
    out.bruto += valor;
    if (row.status === "reembolsada" || row.status === "reembolso_parcial") out.reembolsos += 1;
    if (row.status === "contestada") out.contestacoes += 1;
    out.reembolsado += Math.min(valor, reembolsado);
  }
  out.bruto = Math.round(out.bruto * 100) / 100;
  out.reembolsado = Math.round(out.reembolsado * 100) / 100;
  out.liquido = Math.round((out.bruto - out.reembolsado) * 100) / 100;
  return out;
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
  return map;
}

/**
 * Resumo para o Molde: totais por moeda, por produto e por plataforma nos últimos `dias` (vendas de teste ficam de
 * fora) e as últimas 50 vendas. Nenhum dado pessoal.
 */
export async function resumoVendas(dias: number) {
  const { rows } = await query<VendaRow>(
    `select * from public.vendas
     where criado_em >= now() - make_interval(days => $1::int) and teste = false
     order by criado_em desc
     limit 5000`,
    [dias],
  );
  const porMoeda = [...groupBy(rows, (row) => row.moeda)].map(([moeda, list]) => ({ moeda, ...totais(list) }));
  const porProduto = [...groupBy(rows, (row) => `${row.plataforma}\u0000${row.produto_ref ?? ""}\u0000${row.moeda}`)].map(([, list]) => ({
    produtoRef: list[0].produto_ref,
    produtoId: list[0].produto_id,
    produtoNome: list.find((row) => row.produto_nome)?.produto_nome ?? null,
    plataforma: list[0].plataforma,
    moeda: list[0].moeda,
    ...totais(list),
  })).sort((a, b) => b.liquido - a.liquido);
  const porPlataforma = [...groupBy(rows, (row) => `${row.plataforma}\u0000${row.moeda}`)].map(([, list]) => ({ plataforma: list[0].plataforma, moeda: list[0].moeda, ...totais(list) }))
    .sort((a, b) => b.liquido - a.liquido);
  const ultimas = rows.slice(0, 50).map((row) => ({
    id: row.id,
    plataforma: row.plataforma,
    produtoRef: row.produto_ref,
    produtoId: row.produto_id,
    produtoNome: row.produto_nome,
    valor: Number(row.valor),
    moeda: row.moeda,
    status: row.status,
    valorReembolsado: Number(row.valor_reembolsado),
    criadoEm: new Date(row.criado_em).toISOString(),
  }));
  return { dias, desde: new Date(Date.now() - dias * 86_400_000).toISOString(), totais: porMoeda, porProduto, porPlataforma, ultimas };
}

/** Situação da venda no formato do contrato v131 do Molde. */
function statusContrato(status: VendaRow["status"]) {
  if (status === "contestada") return "chargeback" as const;
  if (status === "reembolsada" || status === "reembolso_parcial") return "reembolsada" as const;
  return "aprovada" as const;
}

export type VendaContrato = { ref: string; plataforma: string; produto: string; valor: number; moeda: string; status: "aprovada" | "reembolsada" | "chargeback"; em: string; origem: string };

/**
 * Vendas por post para o Molde (contrato v131): as vendas desde `desde` (sem as de teste), cada uma com o `ref` do link
 * cuja origem voltou no aviso. `refs` vazio = todas as vendas com origem conhecida. As vendas sem origem conhecida (ou de
 * outro post) vêm com ref "" (contam no total do Painel, não num post). Sem a 0012: todas com ref "" e origem "".
 * Nenhum dado pessoal. No máximo 1000 vendas, as mais novas primeiro.
 */
export async function vendasPorRefs(input: { refs: string[]; desde: Date }): Promise<{ vendas: VendaContrato[]; totais: { aprovadas: number; reembolsadas: number; chargebacks: number; receita: Record<string, number> }; semOrigem: boolean }> {
  const comOrigem = await hasVendasOrigemColumn();
  const { rows } = await query<VendaRow & { origem: string | null; ref: string | null }>(
    comOrigem
      ? `select v.*, l.external_ref as ref
         from public.vendas v
         left join lateral (
           select t.external_ref from public.tracked_links t
           where v.origem is not null and t.origem = v.origem
             and ($3::text[] is null or t.external_ref = any($3))
           order by t.created_at desc
           limit 1
         ) l on true
         where v.teste = false and v.criado_em >= $1
         order by v.criado_em desc
         limit $2`
      : `select v.*, null::text as origem, null::text as ref
         from public.vendas v
         where v.teste = false and v.criado_em >= $1
         order by v.criado_em desc
         limit $2`,
    comOrigem ? [input.desde, 1000, input.refs.length ? input.refs : null] : [input.desde, 1000],
  );
  const totais = { aprovadas: 0, reembolsadas: 0, chargebacks: 0, receita: {} as Record<string, number> };
  const vendas = rows.map((row): VendaContrato => {
    const status = statusContrato(row.status);
    const valor = Number(row.valor) || 0;
    if (status === "aprovada") {
      totais.aprovadas += 1;
      totais.receita[row.moeda] = Math.round(((totais.receita[row.moeda] ?? 0) + valor) * 100) / 100;
    } else if (status === "reembolsada") totais.reembolsadas += 1;
    else totais.chargebacks += 1;
    return {
      ref: row.ref ?? "",
      plataforma: row.plataforma,
      produto: row.produto_nome ?? row.produto_ref ?? row.produto_id ?? "",
      valor,
      moeda: row.moeda,
      status,
      em: new Date(row.criado_em).toISOString(),
      origem: row.origem ?? "",
    };
  });
  return { vendas, totais, semOrigem: !comOrigem };
}
