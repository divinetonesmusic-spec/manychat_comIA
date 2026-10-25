import type { PoolClient } from "pg";
import { query, transaction } from "@/lib/db/client";

/**
 * Fila única do Molde (migração 0016, tabelas public.molde_fila e public.molde_avatares). Molde v134, etapa N1.
 *
 * A página do Molde continua dona de cada pedido (o banco do Artifact é a fonte do conteúdo). Aqui fica o ESPELHO de cada
 * pedido pago ou demorado (Fábrica, Estúdio de fotos, Estúdio de vídeo, Flow, Só Flow, storyboard, HeyGen, voz), com o estado,
 * o custo estimado, o projeto e o avatar, a prévia e a chave do núcleo da página. O espelho serve para:
 *  - o Telegram: «Aprovar» / «Refazer» (com o motivo em texto) quando um pedido fica «para aprovar»;
 *  - o Telegram para PEDIR: «/reel», «/fotos» (rascunho → 2º toque «Confirmar · US$ X» → «na_fila»); a página pega os
 *    confirmados e cria o pedido dela;
 *  - o painel «Fila» da página e, depois, o orquestrador.
 * Sem a 0016 a tabela não existe (42P01): as rotas respondem «Falta colar a atualização 0016» (codigo falta_0016).
 * Contrato completo: docs/API_MOLDE_FILA.md.
 */

export const FILA_STATES = ["rascunho", "na_fila", "produzindo", "para_aprovar", "aprovado", "refazer", "pronto", "erro", "cancelado"] as const;
export type FilaState = (typeof FILA_STATES)[number];
/** Os estados que a página manda no espelho (o rascunho é só do Telegram). */
export const PAGE_STATES: FilaState[] = ["na_fila", "produzindo", "para_aprovar", "aprovado", "refazer", "pronto", "erro", "cancelado"];
export const FINISHED: FilaState[] = ["pronto", "erro", "cancelado"];
/** A origem (e o «confirmado por») do espelho que a página manda. */
const ORIGEM_PAGINA: FilaRow["origem"] = "pagina";

export const MISSING_0016 = "Falta colar a atualização 0016 no Supabase (veja docs/ATUALIZACAO_0016.md).";
/** Quanto tempo um rascunho do Telegram espera o 2º toque. */
export const RASCUNHO_MINUTOS = 30;
/** Quanto tempo depois de tocar em «Refazer» o próximo texto da conversa vira o motivo. */
export const MOTIVO_MINUTOS = 15;
/** Preço padrão de uma foto quando a página ainda não mandou o dela (estimativa). */
export const FOTO_USD_PADRAO = 0.05;
export const FOTOS_MAX = 4;

/** A 0016 ainda não foi colada (tabela ou coluna inexistente). */
export function isMissing0016(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

export type FilaPreview = { texto?: string; imagem?: string; video?: string; audio?: string; link?: string };
export type FilaDecision = { decisao: "aprovar" | "refazer"; nota: string | null; via: "pagina" | "telegram"; por: string | null; em: string; rodada: number };
export type FilaPedido = { comando?: "reel" | "fotos"; texto?: string; n?: number; opcoes?: string[] };

export type FilaRow = {
  id: string;
  ref: string;
  origem: "pagina" | "telegram";
  pedido_id: string | null;
  chave: string | null;
  projeto: string;
  avatar: string;
  tipo: string;
  titulo: string;
  estado: FilaState;
  etapa: string | null;
  nota: string | null;
  custo_estimado_usd: string | number;
  previa: FilaPreview | null;
  pedido: FilaPedido;
  rodada: number;
  decisao: FilaDecision | null;
  decisoes: FilaDecision[];
  decisao_aplicada_em: Date | null;
  espera_motivo_em: Date | null;
  confirmado_em: Date | null;
  confirmado_via: string | null;
  telegram_msg_id: string | number | null;
  telegram_aviso_em: Date | null;
  expira_em: Date | null;
  criado_em: Date;
  atualizado_em: Date;
};

export type AvatarRow = { projeto: string; nome: string; conta: string; precos: { foto?: number; reel?: number }; ordem: number; atualizado_em: Date };

const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);

/** O que a página (e o orquestrador) veem de cada item da fila. */
export function filaView(row: FilaRow) {
  return {
    id: row.id,
    ref: row.ref,
    origem: row.origem,
    pedidoId: row.pedido_id,
    chave: row.chave,
    projeto: row.projeto,
    avatar: row.avatar,
    tipo: row.tipo,
    titulo: row.titulo,
    estado: row.estado,
    etapa: row.etapa,
    nota: row.nota,
    custoEstimadoUsd: Number(row.custo_estimado_usd),
    previa: row.previa,
    pedido: row.pedido ?? {},
    rodada: row.rodada,
    decisao: row.decisao,
    decisoes: row.decisoes ?? [],
    /** true = a última decisão ainda não foi aplicada pela página no pedido dela. */
    decisaoPendente: Boolean(row.decisao && !row.decisao_aplicada_em),
    esperaMotivo: Boolean(row.espera_motivo_em),
    confirmadoEm: iso(row.confirmado_em),
    confirmadoVia: row.confirmado_via,
    criadoEm: iso(row.criado_em),
    atualizadoEm: iso(row.atualizado_em),
  };
}
export type FilaView = ReturnType<typeof filaView>;

type Run = (text: string, params?: unknown[]) => Promise<{ rows: FilaRow[] }>;
const runner = (client?: PoolClient): Run => (client ? (client.query.bind(client) as unknown as Run) : (query as unknown as Run));

export async function getFila(id: string, client?: PoolClient): Promise<FilaRow | null> {
  const { rows } = await runner(client)("select * from public.molde_fila where id = $1", [id]);
  return rows[0] ?? null;
}

// ---------- o espelho que a página manda ----------

export type FilaInput = {
  id?: string | null;
  ref: string;
  pedidoId?: string | null;
  chave?: string | null;
  projeto: string;
  avatar: string;
  tipo: string;
  titulo: string;
  estado: FilaState;
  etapa?: string | null;
  nota?: string | null;
  custoEstimadoUsd: number;
  previa?: FilaPreview | null;
};

export type FilaRegistro = { id: string; ref: string; estado: FilaState; rodada: number; criado: boolean; mudou: boolean; avisar: boolean; decisaoPendente: boolean };

const samePreview = (a: FilaPreview | null | undefined, b: FilaPreview | null | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Grava um item do espelho (cria ou atualiza). Acha a linha pelo `id` (o do Telegram, que a página guardou no pedido), pelo
 * pedido da página ou pela `ref`. Regras:
 *  - entrar em «para_aprovar» (vindo de outro estado, ou com outra prévia) abre uma rodada nova: a mensagem do Telegram sai
 *    de novo (avisar);
 *  - a decisão da rodada (aprovar ou refazer, aplicada ou não pela página) não é desfeita por um espelho que ainda diz
 *    «para_aprovar» com a mesma prévia (atrasado, ou de uma aba com outro projeto aberto, que não vê a decisão);
 *  - um pedido do Telegram que ainda é rascunho (sem o 2º toque) nunca é mudado pela página.
 */
export async function registrarItem(input: FilaInput, client: PoolClient): Promise<FilaRegistro | { erro: string; ref: string }> {
  const run = runner(client);
  let row: FilaRow | null = null;
  if (input.id) row = (await run("select * from public.molde_fila where id = $1 for update", [input.id])).rows[0] ?? null;
  if (input.id && !row) return { erro: "Item da fila não encontrado.", ref: input.ref };
  if (!row && input.pedidoId) row = (await run("select * from public.molde_fila where pedido_id = $1 for update", [input.pedidoId])).rows[0] ?? null;
  if (!row) row = (await run("select * from public.molde_fila where ref = $1 for update", [input.ref])).rows[0] ?? null;

  if (!row) {
    const rodada = input.estado === "para_aprovar" ? 1 : 0;
    const { rows } = await run(
      `insert into public.molde_fila (ref, origem, pedido_id, chave, projeto, avatar, tipo, titulo, estado, etapa, nota, custo_estimado_usd, previa, rodada, confirmado_em, confirmado_via)
       values ($1, $14, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, now(), $14)
       on conflict (ref) do nothing
       returning *`,
      [input.ref, input.pedidoId ?? null, input.chave ?? null, input.projeto, input.avatar, input.tipo, input.titulo, input.estado,
        input.etapa ?? null, input.nota ?? null, input.custoEstimadoUsd, input.previa ? JSON.stringify(input.previa) : null, rodada, ORIGEM_PAGINA],
    );
    const novo = rows[0];
    if (!novo) return registrarItem(input, client); // outra chamada criou a mesma ref ao mesmo tempo: atualiza a dela
    return { id: novo.id, ref: novo.ref, estado: novo.estado, rodada: novo.rodada, criado: true, mudou: true, avisar: novo.estado === "para_aprovar", decisaoPendente: false };
  }

  if (row.estado === "rascunho") return { erro: "Este pedido do Telegram ainda não foi confirmado.", ref: input.ref };

  const decisaoPendente = Boolean(row.decisao && !row.decisao_aplicada_em && Number(row.decisao.rodada) === row.rodada);
  let estado = input.estado;
  let rodada = row.rodada;
  let avisar = false;
  const previa = input.previa === undefined ? row.previa : input.previa;
  // a decisão desta rodada fica: um espelho atrasado (ou de uma aba com outro projeto aberto, que não vê a decisão) da mesma
  // prévia ainda diz «para_aprovar», e isso não reabre a aprovação nem manda a mensagem de novo
  const decididaNaRodada = Boolean(row.decisao && Number(row.decisao.rodada) === row.rodada && (row.estado === "aprovado" || row.estado === "refazer"));
  if (decididaNaRodada && estado === "para_aprovar" && samePreview(previa, row.previa)) estado = row.estado;
  // entrar em «para_aprovar» (ou trocar a prévia nele) abre uma rodada nova, com a mensagem do Telegram de novo
  if (estado === "para_aprovar" && (row.estado !== "para_aprovar" || !samePreview(previa, row.previa))) {
    rodada = row.rodada + 1;
    avisar = true;
  }
  const mudou = estado !== row.estado || rodada !== row.rodada || !samePreview(previa, row.previa) || (input.etapa ?? null) !== row.etapa
    || (input.nota ?? null) !== row.nota || Number(row.custo_estimado_usd) !== input.custoEstimadoUsd || (input.pedidoId ?? row.pedido_id) !== row.pedido_id
    || input.titulo !== row.titulo || input.avatar !== row.avatar;
  if (!mudou) return { id: row.id, ref: row.ref, estado: row.estado, rodada: row.rodada, criado: false, mudou: false, avisar: false, decisaoPendente };

  const { rows } = await run(
    `update public.molde_fila
     set estado = $2, rodada = $3, previa = $4::jsonb, etapa = $5, nota = $6, custo_estimado_usd = $7,
         pedido_id = coalesce($8, pedido_id), chave = coalesce($9, chave), projeto = $10, avatar = $11, tipo = $12, titulo = $13,
         telegram_msg_id = case when $14 then null else telegram_msg_id end,
         telegram_aviso_em = case when $14 then null else telegram_aviso_em end,
         espera_motivo_em = case when $14 then null else espera_motivo_em end,
         atualizado_em = now()
     where id = $1
     returning *`,
    [row.id, estado, rodada, previa ? JSON.stringify(previa) : null, input.etapa ?? null, input.nota ?? null, input.custoEstimadoUsd,
      input.pedidoId ?? null, input.chave ?? null, input.projeto || row.projeto, input.avatar || row.avatar, input.tipo, input.titulo || row.titulo, avisar],
  );
  const novo = rows[0];
  return { id: novo.id, ref: novo.ref, estado: novo.estado, rodada: novo.rodada, criado: false, mudou: true, avisar, decisaoPendente };
}

/** Grava vários itens numa transação só (o robô do Mac manda em lote). */
export async function registrarItens(itens: FilaInput[]) {
  return transaction(async (client) => {
    const out: Array<FilaRegistro | { erro: string; ref: string }> = [];
    for (const item of itens) out.push(await registrarItem(item, client));
    return out;
  });
}

/** Os avatares que o Telegram oferece, com os preços (a página manda a lista inteira; os que saíram da lista saem daqui). */
export async function salvarAvatares(avatares: Array<{ projeto: string; nome: string; conta: string }>, precos: { foto?: number; reel?: number }) {
  await transaction(async (client) => {
    for (const [ordem, a] of avatares.entries()) {
      await client.query(
        `insert into public.molde_avatares (projeto, nome, conta, precos, ordem, atualizado_em) values ($1, $2, $3, $4::jsonb, $5, now())
         on conflict (projeto) do update set nome = excluded.nome, conta = excluded.conta, precos = excluded.precos, ordem = excluded.ordem, atualizado_em = now()`,
        [a.projeto, a.nome, a.conta, JSON.stringify(precos), ordem],
      );
    }
    if (avatares.length) await client.query("delete from public.molde_avatares where not (projeto = any($1::text[]))", [avatares.map((a) => a.projeto)]);
  });
}

export async function listarAvatares(): Promise<AvatarRow[]> {
  const { rows } = await query<AvatarRow>("select * from public.molde_avatares order by ordem, nome, projeto limit 20");
  return rows;
}

export type FilaFiltro = { projeto?: string | null; estados?: FilaState[] | null; origem?: "pagina" | "telegram" | null; semPedido?: boolean; decisoesPendentes?: boolean; limite?: number };

export async function listarFila(filtro: FilaFiltro) {
  const { rows } = await query<FilaRow>(
    `select * from public.molde_fila
     where ($1::text is null or projeto = $1)
       and ($2::text[] is null or estado = any($2))
       and ($3::text is null or origem = $3)
       and (not $4 or pedido_id is null)
       and (not $5 or (decisao is not null and decisao_aplicada_em is null))
       and estado <> 'rascunho'
     order by atualizado_em desc, id
     limit $6`,
    [filtro.projeto ?? null, filtro.estados?.length ? filtro.estados : null, filtro.origem ?? null, filtro.semPedido === true, filtro.decisoesPendentes === true, filtro.limite ?? 100],
  );
  return rows;
}

/** Quantos itens há em cada estado, por projeto (o painel «Fila» e o «/status»). Só os últimos 30 dias. */
export async function contarFila() {
  const { rows } = await query<{ projeto: string; avatar: string; estado: FilaState; n: string }>(
    `select projeto, max(avatar) as avatar, estado, count(*) as n from public.molde_fila
     where estado <> 'rascunho' and atualizado_em > now() - interval '30 days'
     group by projeto, estado order by projeto, estado`,
  );
  const out: Record<string, { avatar: string; estados: Partial<Record<FilaState, number>> }> = {};
  for (const r of rows) {
    const p = (out[r.projeto] ??= { avatar: r.avatar, estados: {} });
    p.estados[r.estado] = Number(r.n);
    if (!p.avatar && r.avatar) p.avatar = r.avatar;
  }
  return out;
}

// ---------- decisões (aprovar / refazer) ----------

export type FilaDecideOutcome =
  | { ok: true; item: FilaRow }
  | { ok: false; motivo: "not-found" }
  | { ok: false; motivo: "already" | "old-round" | "not-waiting" | "sem-motivo"; item: FilaRow };

/** «Aprovar» ou «Refazer» (com o motivo) de um item «para aprovar», pela página ou pelo Telegram. */
export async function decidirFila(id: string, input: { decisao: "aprovar" | "refazer"; nota?: string | null; via: "pagina" | "telegram"; por?: string | null; rodada?: number | null }): Promise<FilaDecideOutcome> {
  return transaction(async (client) => {
    const item = (await runner(client)("select * from public.molde_fila where id = $1 for update", [id])).rows[0];
    if (!item) return { ok: false, motivo: "not-found" };
    if (input.rodada != null && input.rodada !== item.rodada) return { ok: false, motivo: "old-round", item };
    if (item.decisao && Number(item.decisao.rodada) === item.rodada && (item.estado === "aprovado" || item.estado === "refazer")) return { ok: false, motivo: "already", item };
    if (item.estado !== "para_aprovar") return { ok: false, motivo: "not-waiting", item };
    if (input.decisao === "refazer" && !input.nota?.trim()) return { ok: false, motivo: "sem-motivo", item };
    const decisao: FilaDecision = { decisao: input.decisao, nota: input.nota?.trim() || null, via: input.via, por: input.por ?? null, em: new Date().toISOString(), rodada: item.rodada };
    const { rows } = await client.query<FilaRow>(
      `update public.molde_fila
       set estado = $2, decisao = $3::jsonb, decisoes = decisoes || jsonb_build_array($3::jsonb), decisao_aplicada_em = null,
           espera_motivo_em = null, atualizado_em = now()
       where id = $1 returning *`,
      [id, input.decisao === "aprovar" ? "aprovado" : "refazer", JSON.stringify(decisao)],
    );
    return { ok: true, item: rows[0] };
  });
}

/** A página aplicou a decisão da rodada no pedido dela (a mesma regra da Caixa de aprovações). */
export async function marcarAplicada(id: string, rodada: number) {
  const { rows } = await query<FilaRow>(
    `update public.molde_fila set decisao_aplicada_em = now(), atualizado_em = now()
     where id = $1 and decisao is not null and (decisao->>'rodada')::int = $2 returning *`,
    [id, rodada],
  );
  return rows[0] ?? null;
}

/** Cancelar pela página (um pedido do Telegram que ela não vai fazer, ex.: passou do limite e o dono disse «Cancelar»). */
export async function cancelarFila(id: string, nota: string | null) {
  const { rows } = await query<FilaRow>(
    `update public.molde_fila set estado = 'cancelado', nota = coalesce($2, nota), expira_em = null, atualizado_em = now()
     where id = $1 and estado not in ('pronto', 'erro', 'cancelado') returning *`,
    [id, nota],
  );
  return rows[0] ?? (await getFila(id));
}

/** Marca que o próximo texto da conversa é o motivo do «Refazer» deste item (só um item espera por vez). */
export async function esperarMotivo(id: string) {
  return transaction(async (client) => {
    await client.query("update public.molde_fila set espera_motivo_em = null where espera_motivo_em is not null and id <> $1", [id]);
    const { rows } = await client.query<FilaRow>(
      "update public.molde_fila set espera_motivo_em = now() where id = $1 and estado = 'para_aprovar' returning *",
      [id],
    );
    return rows[0] ?? null;
  });
}

/** O item que espera o motivo do «Refazer» (tocou há menos de 15 min), ou null. */
export async function itemEsperandoMotivo() {
  const { rows } = await query<FilaRow>(
    `select * from public.molde_fila where espera_motivo_em > now() - make_interval(mins => $1) and estado = 'para_aprovar'
     order by espera_motivo_em desc limit 1`,
    [MOTIVO_MINUTOS],
  );
  return rows[0] ?? null;
}

export async function largarMotivo() {
  await query("update public.molde_fila set espera_motivo_em = null where espera_motivo_em is not null");
}

// ---------- pedir pelo Telegram ----------

/** O custo estimado de um pedido do Telegram para um avatar (os preços que a página mandou; sem eles, a estimativa padrão). */
export function custoDoPedido(pedido: FilaPedido, avatar: Pick<AvatarRow, "precos"> | null) {
  if (pedido.comando === "fotos") {
    const porFoto = Number(avatar?.precos?.foto);
    const preco = Number.isFinite(porFoto) && porFoto >= 0 ? porFoto : FOTO_USD_PADRAO;
    return { usd: Math.round(preco * Math.max(1, pedido.n ?? 1) * 10_000) / 10_000, padrao: !(Number.isFinite(porFoto) && porFoto >= 0) };
  }
  return { usd: 0, padrao: false }; // o Reel no calendário: o roteiro usa o plano do Claude
}

export async function criarRascunho(pedido: FilaPedido, opcoes: AvatarRow[]) {
  const unico = opcoes.length === 1 ? opcoes[0] : null;
  const custo = custoDoPedido(pedido, unico);
  const titulo = pedido.comando === "fotos" ? `${pedido.n ?? 1} foto${(pedido.n ?? 1) > 1 ? "s" : ""}: ${pedido.texto}` : `Reel: ${pedido.texto}`;
  const { rows } = await query<FilaRow>(
    `insert into public.molde_fila (ref, origem, projeto, avatar, tipo, titulo, estado, custo_estimado_usd, pedido, expira_em)
     values ('telegram:' || gen_random_uuid(), 'telegram', $1, $2, $3, $4, 'rascunho', $5, $6::jsonb, now() + make_interval(mins => $7))
     returning *`,
    [unico?.projeto ?? "", unico?.nome ?? "", pedido.comando === "fotos" ? "fotos" : "reel", titulo.slice(0, 200), custo.usd,
      JSON.stringify({ ...pedido, opcoes: opcoes.map((a) => a.projeto) }), RASCUNHO_MINUTOS],
  );
  return rows[0];
}

export type RascunhoOutcome = { ok: true; item: FilaRow } | { ok: false; motivo: "not-found" | "expirado" | "ja" | "sem-avatar"; item?: FilaRow };

async function rascunhoVivo(client: PoolClient, id: string): Promise<RascunhoOutcome> {
  const item = (await runner(client)("select * from public.molde_fila where id = $1 for update", [id])).rows[0];
  if (!item || item.origem !== "telegram") return { ok: false, motivo: "not-found" };
  if (item.estado !== "rascunho") return { ok: false, motivo: "ja", item };
  if (item.expira_em && new Date(item.expira_em).getTime() < Date.now()) return { ok: false, motivo: "expirado", item };
  return { ok: true, item };
}

/** O botão do avatar (o índice na lista guardada no rascunho): grava o projeto, o nome e o custo daquele avatar. */
export async function escolherAvatar(id: string, indice: number): Promise<RascunhoOutcome> {
  return transaction(async (client) => {
    const vivo = await rascunhoVivo(client, id);
    if (!vivo.ok) return vivo;
    const projeto = vivo.item.pedido?.opcoes?.[indice];
    if (!projeto) return { ok: false, motivo: "sem-avatar", item: vivo.item };
    const avatar = (await client.query<AvatarRow>("select * from public.molde_avatares where projeto = $1", [projeto])).rows[0] ?? null;
    if (!avatar) return { ok: false, motivo: "sem-avatar", item: vivo.item };
    const custo = custoDoPedido(vivo.item.pedido, avatar);
    const { rows } = await client.query<FilaRow>(
      "update public.molde_fila set projeto = $2, avatar = $3, custo_estimado_usd = $4, atualizado_em = now() where id = $1 returning *",
      [id, avatar.projeto, avatar.nome, custo.usd],
    );
    return { ok: true, item: rows[0] };
  });
}

/** O 2º toque «Confirmar · US$ X»: o pedido entra na fila (a página faz quando abrir). */
export async function confirmarRascunho(id: string, por: string | null): Promise<RascunhoOutcome> {
  return transaction(async (client) => {
    const vivo = await rascunhoVivo(client, id);
    if (!vivo.ok) return vivo;
    if (!vivo.item.projeto) return { ok: false, motivo: "sem-avatar", item: vivo.item };
    const { rows } = await client.query<FilaRow>(
      `update public.molde_fila set estado = 'na_fila', confirmado_em = now(), confirmado_via = 'telegram', expira_em = null,
         etapa = 'Esperando a página do Molde', nota = $2, atualizado_em = now()
       where id = $1 returning *`,
      [id, por ? `Pedido no Telegram por ${por}.` : "Pedido no Telegram."],
    );
    return { ok: true, item: rows[0] };
  });
}

export async function cancelarRascunho(id: string): Promise<RascunhoOutcome> {
  return transaction(async (client) => {
    const vivo = await rascunhoVivo(client, id);
    if (!vivo.ok) return vivo;
    const { rows } = await client.query<FilaRow>("update public.molde_fila set estado = 'cancelado', expira_em = null, nota = 'Cancelado no Telegram.', atualizado_em = now() where id = $1 returning *", [id]);
    return { ok: true, item: rows[0] };
  });
}

/** O relógio: apaga os rascunhos do Telegram que passaram de 1 dia sem confirmação. */
export async function limparRascunhos() {
  const { rowCount } = await query("delete from public.molde_fila where estado = 'rascunho' and criado_em < now() - interval '1 day'");
  return rowCount ?? 0;
}
