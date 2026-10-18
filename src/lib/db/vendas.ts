import { query } from "@/lib/db/client";
import type { Plataforma, VendaEvento } from "@/lib/vendas/webhooks";

/** Vendas e reembolsos que chegam por webhook (0010). Nenhum dado pessoal do cliente. */
type Evento = Exclude<VendaEvento, { tipo: "ignorar" }>;

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
  if (evento.tipo === "venda") {
    const { rows } = await query<{ id: string }>(
      `insert into public.vendas (plataforma, raw_id, pagamento_id, produto_ref, produto_id, produto_nome, valor, moeda, teste, criado_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, now()))
       on conflict (plataforma, raw_id) do nothing
       returning id`,
      [plataforma, evento.rawId, evento.pagamentoId ?? null, evento.produtoRef ?? null, evento.produtoId ?? null, evento.produtoNome ?? null, evento.valor ?? 0, evento.moeda ?? "USD", Boolean(evento.teste), evento.criadoEm ?? null],
    );
    return rows.length ? "nova" : "repetida";
  }

  const status = evento.tipo === "contestacao" ? "contestada" : evento.reembolsoTotal === false ? "reembolso_parcial" : "reembolsada";
  const ids = [evento.rawId, evento.pagamentoId].filter(Boolean) as string[];
  const { rows } = await query<{ id: string; status: string; valor_reembolsado: string }>(
    `update public.vendas
     set status = $3,
         valor_reembolsado = case when $3 = 'contestada' then valor_reembolsado else greatest(valor_reembolsado, coalesce($4, valor)) end,
         atualizado_em = now()
     where plataforma = $1 and (raw_id = any($2::text[]) or pagamento_id = any($2::text[]))
     returning id, status, valor_reembolsado`,
    [plataforma, ids, status, evento.valorReembolsado ?? null],
  );
  if (rows.length) return "atualizada";
  const inserted = await query<{ id: string }>(
    `insert into public.vendas (plataforma, raw_id, pagamento_id, produto_ref, produto_id, produto_nome, valor, moeda, status, valor_reembolsado, teste, criado_em)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, now()))
     on conflict (plataforma, raw_id) do update set status = excluded.status, valor_reembolsado = excluded.valor_reembolsado, atualizado_em = now()
     returning id`,
    [
      plataforma, evento.rawId, evento.pagamentoId ?? null, evento.produtoRef ?? null, evento.produtoId ?? null, evento.produtoNome ?? null,
      evento.valor ?? evento.valorReembolsado ?? 0, evento.moeda ?? "USD", status, status === "contestada" ? 0 : evento.valorReembolsado ?? evento.valor ?? 0,
      Boolean(evento.teste), evento.criadoEm ?? null,
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
