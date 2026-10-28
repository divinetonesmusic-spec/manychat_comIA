import { randomInt } from "node:crypto";
import { query } from "@/lib/db/client";
import { lerQuiz, respostasValidas, pontuar, type QuizPacote } from "@/lib/funil/quiz";
import type { EntregaPacote } from "@/lib/funil/entrega";

/**
 * O funil do Molde (0013): quizzes e as sessões de cada pessoa, a página de entrega do material grátis e a Lista própria
 * (leads), compartilhada pelos dois. Sem a 0013 as tabelas não existem (erro 42P01): as rotas respondem MIGRATION_0013 e
 * as páginas públicas respondem "não encontrada".
 */
export const MIGRATION_0013 = "Falta colar a atualização 0013 no Supabase (veja docs/ATUALIZACAO_0013.md): o quiz, a página de entrega e a Lista própria ainda não funcionam.";

export function isMissing0013(error: unknown) {
  return (error as { code?: string } | null)?.code === "42P01";
}

const ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789";
function codigo(n = 20) {
  let out = "";
  for (let i = 0; i < n; i += 1) out += ALFABETO[randomInt(ALFABETO.length)];
  return out;
}

/** O código da URL livre: o pedido, ou com -2, -3… quando outro projeto já usa (o mesmo projeto atualiza o seu). */
async function slugLivre(tabela: "quizzes" | "entregas", slug: string, molde: string) {
  for (let i = 1; i < 50; i += 1) {
    const tentativa = i === 1 ? slug : `${slug.slice(0, 56).replace(/-+$/, "")}-${i}`;
    const { rows } = await query<{ molde: string }>(`select molde from public.${tabela} where slug = $1`, [tentativa]);
    if (!rows[0] || rows[0].molde === molde) return tentativa;
  }
  return `${slug.slice(0, 50).replace(/-+$/, "")}-${codigo(6)}`;
}

/* ---------------- quiz ---------------- */

export type QuizRow = { id: string; slug: string; molde: string; account_id: string | null; titulo: string; pacote: unknown; ativo: boolean; atualizado_em: string };

/** Cria ou atualiza o quiz do projeto (pelo id que a página guardou, ou pelo mesmo código no mesmo projeto). */
export async function salvarQuiz(input: { id?: string | null; accountId: string | null; molde: string; slug: string; quiz: QuizPacote }) {
  if (input.id) {
    const { rows } = await query<{ id: string; slug: string }>(
      `update public.quizzes set titulo = $2, pacote = $3::jsonb, account_id = coalesce($4, account_id), ativo = true, atualizado_em = now()
       where id = $1 and molde = $5 returning id, slug`,
      [input.id, input.quiz.titulo, JSON.stringify(input.quiz), input.accountId, input.molde],
    );
    if (rows[0]) return { ...rows[0], criado: false };
  }
  const slug = await slugLivre("quizzes", input.slug, input.molde);
  const { rows } = await query<{ id: string; slug: string; criado: boolean }>(
    `insert into public.quizzes (account_id, molde, slug, titulo, pacote) values ($1, $2, $3, $4, $5::jsonb)
     on conflict (slug) do update set titulo = excluded.titulo, pacote = excluded.pacote, account_id = coalesce(excluded.account_id, public.quizzes.account_id),
       ativo = true, atualizado_em = now()
     where public.quizzes.molde = excluded.molde
     returning id, slug, (xmax = 0) as criado`,
    [input.accountId, input.molde, slug, input.quiz.titulo, JSON.stringify(input.quiz)],
  );
  if (!rows[0]) throw new Error("Outro projeto já usa este endereço de quiz.");
  return rows[0];
}

export type QuizPublico = { id: string; slug: string; accountId: string | null; molde: string; quiz: QuizPacote };

/** O quiz ligado pelo código da URL (relido pelo mesmo leitor: um pacote mexido à mão não quebra a página). null = não há. */
export async function getQuizPublico(slug: string): Promise<QuizPublico | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) return null;
  try {
    const { rows } = await query<QuizRow>("select id, slug, molde, account_id, titulo, pacote, ativo, atualizado_em from public.quizzes where slug = $1 and ativo", [slug]);
    const row = rows[0];
    if (!row) return null;
    const lido = lerQuiz(row.pacote);
    if (!lido.ok) return null;
    return { id: row.id, slug: row.slug, accountId: row.account_id, molde: row.molde, quiz: lido.quiz };
  } catch (error) {
    if (isMissing0013(error)) return null;
    throw error;
  }
}

export async function criarSessaoQuiz(quizId: string, input: { perfilDm: string | null; origem: string | null; de: string | null }) {
  const { rows } = await query<{ id: string }>(
    "insert into public.quiz_sessoes (quiz_id, perfil_dm, origem, de) values ($1, $2, $3, $4) returning id",
    [quizId, input.perfilDm, input.origem, input.de],
  );
  return rows[0].id;
}

type SessaoRow = { id: string; quiz_id: string; perfil_dm: string | null; origem: string | null; de: string | null; respostas: unknown; perfil: string | null; terminou_em: string | null; email_em: string | null; lead_id: string | null };

export async function getSessaoQuiz(id: string, quizId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await query<SessaoRow>(
    "select id, quiz_id, perfil_dm, origem, de, respostas, perfil, terminou_em, email_em, lead_id from public.quiz_sessoes where id = $1 and quiz_id = $2",
    [id, quizId],
  );
  return rows[0] ?? null;
}

/** Guarda as respostas (cada toque); com `fim`, calcula o perfil aqui no servidor e marca o fim (uma vez). */
export async function gravarRespostas(q: QuizPublico, sessaoId: string, respostas: unknown, fim: boolean) {
  const sessao = await getSessaoQuiz(sessaoId, q.id);
  if (!sessao) return null;
  const R = respostasValidas(q.quiz, respostas);
  const perfil = fim ? pontuar(q.quiz, R, sessao.perfil_dm) : null;
  await query(
    `update public.quiz_sessoes set respostas = $2::jsonb, atualizado_em = now(),
       perfil = coalesce($3, perfil), terminou_em = case when $3::text is not null then coalesce(terminou_em, now()) else terminou_em end
     where id = $1`,
    [sessaoId, JSON.stringify(R), perfil],
  );
  return { perfil: perfil ?? sessao.perfil, respostas: R };
}

export async function marcarEmailQuiz(sessaoId: string, leadId: string) {
  await query("update public.quiz_sessoes set email_em = coalesce(email_em, now()), lead_id = $2, atualizado_em = now() where id = $1", [sessaoId, leadId]);
}

export async function marcarCheckoutQuiz(sessaoId: string) {
  await query("update public.quiz_sessoes set checkout_em = coalesce(checkout_em, now()), atualizado_em = now() where id = $1", [sessaoId]);
}

/** Guarda o código da compra do perfil (o mesmo código sempre aponta para o mesmo quiz, perfil e post). */
export async function registrarOrigemQuiz(codigoCompra: string, quizId: string, perfil: string, origemPost: string | null) {
  await query(
    "insert into public.quiz_origens (chave, quiz_id, perfil, origem_post) values ($1, $2, $3, $4) on conflict (chave) do nothing",
    [codigoCompra, quizId, perfil, origemPost],
  );
}

export type NumerosPerfil = { fins: number; emails: number; checkouts: number; compras: number };
export type QuizComNumeros = { id: string; slug: string; titulo: string; ativo: boolean; atualizadoEm: string; numeros: { inicios: number; fins: number; emails: number; checkouts: number; compras: number; porPerfil: Record<string, NumerosPerfil> } };

/** As vendas pagas casadas pelo código do quiz (precisa da 0012: vendas.origem). Sem ela, 0. */
async function comprasPorPerfil(quizIds: string[]) {
  const out = new Map<string, Map<string, number>>();
  if (!quizIds.length) return out;
  const { rows: tem } = await query<{ ok: boolean }>(
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vendas' and column_name = 'origem') as ok",
  );
  if (!tem[0]?.ok) return out;
  const { rows } = await query<{ quiz_id: string; perfil: string; n: string }>(
    `select o.quiz_id, o.perfil, count(*) as n from public.vendas v join public.quiz_origens o on o.chave = v.origem
     where o.quiz_id = any($1::uuid[]) and v.status = 'paga' and not v.teste group by o.quiz_id, o.perfil`,
    [quizIds],
  );
  for (const r of rows) {
    if (!out.has(r.quiz_id)) out.set(r.quiz_id, new Map());
    out.get(r.quiz_id)!.set(r.perfil, Number(r.n));
  }
  return out;
}

export async function listarQuizzes(molde: string): Promise<QuizComNumeros[]> {
  const { rows } = await query<QuizRow>("select id, slug, molde, account_id, titulo, pacote, ativo, atualizado_em from public.quizzes where molde = $1 order by atualizado_em desc limit 20", [molde]);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { rows: s } = await query<{ quiz_id: string; perfil: string | null; inicios: string; fins: string; emails: string; checkouts: string }>(
    `select quiz_id, perfil, count(*) as inicios, count(terminou_em) as fins, count(email_em) as emails, count(checkout_em) as checkouts
     from public.quiz_sessoes where quiz_id = any($1::uuid[]) group by quiz_id, perfil`,
    [ids],
  );
  const compras = await comprasPorPerfil(ids);
  return rows.map((r) => {
    const n = { inicios: 0, fins: 0, emails: 0, checkouts: 0, compras: 0, porPerfil: {} as Record<string, NumerosPerfil> };
    for (const x of s.filter((y) => y.quiz_id === r.id)) {
      n.inicios += Number(x.inicios);
      n.fins += Number(x.fins);
      n.emails += Number(x.emails);
      n.checkouts += Number(x.checkouts);
      if (x.perfil) n.porPerfil[x.perfil] = { fins: Number(x.fins), emails: Number(x.emails), checkouts: Number(x.checkouts), compras: 0 };
    }
    for (const [perfil, c] of compras.get(r.id) ?? []) {
      n.compras += c;
      n.porPerfil[perfil] = { ...(n.porPerfil[perfil] ?? { fins: 0, emails: 0, checkouts: 0, compras: 0 }), compras: c };
    }
    return { id: r.id, slug: r.slug, titulo: r.titulo, ativo: r.ativo, atualizadoEm: r.atualizado_em, numeros: n };
  });
}

/* ---------------- Lista própria (leads) ---------------- */

export type LeadInput = {
  accountId: string | null;
  molde: string;
  email: string;
  nome: string | null;
  fonte: "quiz" | "entrega";
  origem: string | null;
  de: string | null;
  quizId?: string | null;
  perfil?: string | null;
  entregaId?: string | null;
  consentimento: boolean;
  consentimentoTexto: string;
};

export function emailValido(email: string) {
  return email.length <= 254 && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i.test(email);
}

/**
 * Põe (ou atualiza) a pessoa na Lista própria da conta. O consentimento só liga (nunca desliga sem ela pedir); quem tinha
 * saído da lista e marca a caixa de novo volta para a lista. Devolve o id e o código (sair da lista / acesso à entrega).
 */
export async function salvarLead(input: LeadInput) {
  const lista = input.accountId || `molde:${input.molde}`;
  const { rows } = await query<{ id: string; codigoLead: string; email: string; consentimento: boolean; confirmadoEm: string | null }>(
    `insert into public.leads (account_id, molde, lista, email, nome, fonte, origem, de, quiz_id, perfil, entrega_id, consentimento, consentimento_texto, consentimento_em, chave)
     values ($1, $2, $3, lower($4), nullif($5, ''), $6, $7, $8, $9, $10, $11, $12, $13, case when $12 then now() end, $14)
     on conflict (lista, email) do update set
       nome = coalesce(excluded.nome, public.leads.nome),
       quiz_id = coalesce(excluded.quiz_id, public.leads.quiz_id),
       perfil = coalesce(excluded.perfil, public.leads.perfil),
       entrega_id = coalesce(excluded.entrega_id, public.leads.entrega_id),
       origem = coalesce(public.leads.origem, excluded.origem),
       consentimento = public.leads.consentimento or excluded.consentimento,
       consentimento_texto = case when excluded.consentimento then excluded.consentimento_texto else public.leads.consentimento_texto end,
       consentimento_em = case when excluded.consentimento then now() else public.leads.consentimento_em end,
       descadastrado_em = case when excluded.consentimento then null else public.leads.descadastrado_em end,
       atualizado_em = now()
     returning id, chave as "codigoLead", email, consentimento, confirmado_em as "confirmadoEm"`,
    [input.accountId, input.molde, lista, input.email, input.nome ?? "", input.fonte, input.origem, input.de, input.quizId ?? null, input.perfil ?? null, input.entregaId ?? null, input.consentimento, input.consentimento ? input.consentimentoTexto : null, codigo()],
  );
  return rows[0];
}

export async function getLeadPorCodigo(codigoLead: string) {
  if (!/^[a-z0-9]{12,40}$/.test(codigoLead)) return null;
  const { rows } = await query<{ id: string; email: string; descadastrado_em: string | null; entrega_id: string | null }>(
    "select id, email, descadastrado_em, entrega_id from public.leads where chave = $1",
    [codigoLead],
  );
  return rows[0] ?? null;
}

/**
 * K7 · a pessoa do link do e-mail do material (/e/<slug>/m/<código>): o código tem de ser de alguém da MESMA lista da entrega
 * (a conta do Instagram ou, sem conta, o projeto do Molde). Quem saiu da lista continua podendo baixar o que pediu.
 */
export async function getLeadDaEntrega(codigoLead: string, entrega: Pick<EntregaRow, "account_id" | "molde">) {
  if (!/^[a-z0-9]{12,40}$/.test(codigoLead)) return null;
  const lista = entrega.account_id || `molde:${entrega.molde}`;
  const { rows } = await query<{ id: string; chave: string }>("select id, chave from public.leads where chave = $1 and lista = $2", [codigoLead, lista]);
  return rows[0] ?? null;
}

/** Sai da lista (o link de cada e-mail). true = achou. */
export async function descadastrarLead(codigoLead: string) {
  if (!/^[a-z0-9]{12,40}$/.test(codigoLead)) return false;
  const { rowCount } = await query("update public.leads set descadastrado_em = coalesce(descadastrado_em, now()), consentimento = false, atualizado_em = now() where chave = $1", [codigoLead]);
  return (rowCount ?? 0) > 0;
}

export type LeadLinha = { email: string; nome: string | null; fonte: string; origem: string | null; de: string | null; perfil: string | null; quiz: string | null; entrega: string | null; consentimento: boolean; consentimentoEm: string | null; criadoEm: string; descadastradoEm: string | null; sequencia: string | null; confirmadoEm: string | null };

/** A lista do projeto (ou de todas), as mais novas primeiro (até 5.000). */
export async function listarLeads(molde: string | null): Promise<LeadLinha[]> {
  const { rows } = await query<{ email: string; nome: string | null; fonte: string; origem: string | null; de: string | null; perfil: string | null; quiz: string | null; entrega: string | null; consentimento: boolean; consentimento_em: string | null; criado_em: string; descadastrado_em: string | null; sequencia: string | null; confirmado_em: string | null }>(
    `select l.email, l.nome, l.fonte, l.origem, l.de, l.perfil, q.slug as quiz, e.slug as entrega, l.consentimento, l.consentimento_em, l.criado_em, l.descadastrado_em, l.sequencia, l.confirmado_em
     from public.leads l left join public.quizzes q on q.id = l.quiz_id left join public.entregas e on e.id = l.entrega_id
     where ($1::text is null or l.molde = $1) order by l.criado_em desc limit 5000`,
    [molde],
  );
  return rows.map((r) => ({ email: r.email, nome: r.nome, fonte: r.fonte, origem: r.origem, de: r.de, perfil: r.perfil, quiz: r.quiz, entrega: r.entrega, consentimento: r.consentimento, consentimentoEm: r.consentimento_em, criadoEm: r.criado_em, descadastradoEm: r.descadastrado_em, sequencia: r.sequencia, confirmadoEm: r.confirmado_em }));
}

/* ---------------- página de entrega ---------------- */

export type EntregaRow = { id: string; slug: string; molde: string; account_id: string | null; titulo: string; pacote: EntregaPacote; capa_key: string | null; pdf_key: string | null; pdf_nome: string | null; html_key: string | null; pendentes: Record<string, { key: string; nome: string; contentType: string; size: number }>; ativo: boolean; publicada_em: string | null };

const COLUNAS_ENTREGA = "id, slug, molde, account_id, titulo, pacote, capa_key, pdf_key, pdf_nome, html_key, pendentes, ativo, publicada_em";

/** Cria ou atualiza a entrega do projeto (a mesma do id guardado na página, ou o mesmo código no mesmo projeto). */
export async function salvarEntrega(input: { id?: string | null; accountId: string | null; molde: string; slug: string; entrega: EntregaPacote }): Promise<EntregaRow> {
  if (input.id) {
    const { rows } = await query<EntregaRow>(
      `update public.entregas set titulo = $2, pacote = $3::jsonb, account_id = coalesce($4, account_id), atualizado_em = now()
       where id = $1 and molde = $5 returning ${COLUNAS_ENTREGA}`,
      [input.id, input.entrega.titulo, JSON.stringify(input.entrega), input.accountId, input.molde],
    );
    if (rows[0]) return rows[0];
  }
  const slug = await slugLivre("entregas", input.slug, input.molde);
  const { rows } = await query<EntregaRow>(
    `insert into public.entregas (account_id, molde, slug, titulo, pacote) values ($1, $2, $3, $4, $5::jsonb)
     on conflict (slug) do update set titulo = excluded.titulo, pacote = excluded.pacote,
       account_id = coalesce(excluded.account_id, public.entregas.account_id), atualizado_em = now()
     where public.entregas.molde = excluded.molde
     returning ${COLUNAS_ENTREGA}`,
    [input.accountId, input.molde, slug, input.entrega.titulo, JSON.stringify(input.entrega)],
  );
  if (!rows[0]) throw new Error("Outro projeto já usa este endereço de entrega.");
  return rows[0];
}

export async function guardarPendentes(id: string, pendentes: EntregaRow["pendentes"]) {
  await query("update public.entregas set pendentes = $2::jsonb, atualizado_em = now() where id = $1", [id, JSON.stringify(pendentes)]);
}

export async function getEntregaMolde(id: string, molde: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await query<EntregaRow>(`select ${COLUNAS_ENTREGA} from public.entregas where id = $1 and molde = $2`, [id, molde]);
  return rows[0] ?? null;
}

/** Os arquivos conferidos no R2 passam a valer e a página abre. */
export async function publicarEntrega(id: string, campos: { capa_key?: string | null; pdf_key?: string | null; pdf_nome?: string | null; html_key?: string | null }) {
  const { rows } = await query<EntregaRow>(
    `update public.entregas set
       capa_key = case when $2::boolean then $3 else capa_key end,
       pdf_key = case when $4::boolean then $5 else pdf_key end,
       pdf_nome = case when $4::boolean then $6 else pdf_nome end,
       html_key = case when $7::boolean then $8 else html_key end,
       pendentes = '{}'::jsonb, ativo = true, publicada_em = coalesce(publicada_em, now()), atualizado_em = now()
     where id = $1 returning ${COLUNAS_ENTREGA}`,
    [id, "capa_key" in campos, campos.capa_key ?? null, "pdf_key" in campos, campos.pdf_key ?? null, campos.pdf_nome ?? null, "html_key" in campos, campos.html_key ?? null],
  );
  return rows[0] ?? null;
}

export async function getEntregaPublica(slug: string): Promise<EntregaRow | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) return null;
  try {
    const { rows } = await query<EntregaRow>(`select ${COLUNAS_ENTREGA} from public.entregas where slug = $1 and ativo`, [slug]);
    return rows[0] ?? null;
  } catch (error) {
    if (isMissing0013(error)) return null;
    throw error;
  }
}

export async function registrarEventoEntrega(entregaId: string, tipo: "visita" | "email" | "pdf" | "html" | "proximo", origem: string | null, de: string | null) {
  await query("insert into public.entrega_eventos (entrega_id, tipo, origem, de) values ($1, $2, $3, $4)", [entregaId, tipo, origem, de]);
}

export type EntregaComNumeros = { id: string; slug: string; titulo: string; ativo: boolean; temPdf: boolean; temHtml: boolean; temCapa: boolean; numeros: Record<"visitas" | "emails" | "pdf" | "html" | "proximo", number> };

export async function listarEntregas(molde: string): Promise<EntregaComNumeros[]> {
  const { rows } = await query<EntregaRow>(`select ${COLUNAS_ENTREGA} from public.entregas where molde = $1 order by atualizado_em desc limit 20`, [molde]);
  if (!rows.length) return [];
  const { rows: ev } = await query<{ entrega_id: string; tipo: string; n: string }>(
    "select entrega_id, tipo, count(*) as n from public.entrega_eventos where entrega_id = any($1::uuid[]) group by entrega_id, tipo",
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => {
    const n = { visitas: 0, emails: 0, pdf: 0, html: 0, proximo: 0 };
    for (const e of ev.filter((x) => x.entrega_id === r.id)) {
      if (e.tipo === "visita") n.visitas = Number(e.n);
      else if (e.tipo === "email") n.emails = Number(e.n);
      else if (e.tipo === "pdf" || e.tipo === "html" || e.tipo === "proximo") n[e.tipo] = Number(e.n);
    }
    return { id: r.id, slug: r.slug, titulo: r.titulo, ativo: r.ativo, temPdf: Boolean(r.pdf_key), temHtml: Boolean(r.html_key), temCapa: Boolean(r.capa_key), numeros: n };
  });
}

export { codigo as novoCodigo };
