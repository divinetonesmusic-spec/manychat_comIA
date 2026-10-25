import { createHash, randomInt } from "node:crypto";
import { query, transaction } from "@/lib/db/client";
import { lerApp, type AppPacote } from "@/lib/app/pacote";
import { acessoDepois, CARENCIA_PADRAO, diaLocal, diasSeguidos, fusoValido, taxa, type NumerosApp, type TipoPagamento } from "@/lib/app/rotina";
import type { AvisoAssinatura } from "@/lib/app/assinatura";
import type { Plataforma } from "@/lib/vendas/webhooks";

/**
 * O app por assinatura do Molde (0018): o app publicado, quem assina (casado pelo e-mail do aviso de venda), os pagamentos, a
 * entrada sem senha (link e código por e-mail; a sessão do aparelho), o uso de cada dia e o lembrete. Sem a 0018 as tabelas não
 * existem (erro 42P01): as rotas do Molde respondem MIGRATION_0018, /a/<slug> responde «não encontrada» e os avisos de venda
 * seguem como antes.
 */
export const MIGRATION_0018 = "Falta colar a atualização 0018 no Supabase (veja docs/ATUALIZACAO_0018.md): o app por assinatura ainda não funciona.";

export function isMissing0018(error: unknown) {
  return (error as { code?: string } | null)?.code === "42P01";
}

/** A 0018 foi colada? Lembra o «sim»; o «não» vale 1 min (para não perguntar ao banco a cada aviso de venda). */
let tabela: { existe: boolean; em: number } | null = null;
export async function hasAppsTable() {
  if (tabela && (tabela.existe || Date.now() - tabela.em < 60_000)) return tabela.existe;
  const { rows } = await query<{ existe: boolean }>("select to_regclass('public.app_assinantes') is not null as existe");
  tabela = { existe: Boolean(rows[0]?.existe), em: Date.now() };
  return tabela.existe;
}
/** Só os testes: esquece o que já sabe da 0018. */
export function esquecerTabelaApps() {
  tabela = null;
}

const ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789";
function codigo(n = 24) {
  let out = "";
  for (let i = 0; i < n; i += 1) out += ALFABETO[randomInt(ALFABETO.length)];
  return out;
}
export function resumo(valor: string) {
  return createHash("sha256").update(`uaiflow-app:${valor}`).digest("hex");
}

/* ---------------- o app ---------------- */

export type AppRow = {
  id: string;
  slug: string;
  molde: string;
  account_id: string | null;
  titulo: string;
  pacote: unknown;
  produto_refs: string[];
  carencia_dias: number;
  audios: Record<string, { key: string; size: number; contentType: string }>;
  pendentes: Record<string, { key: string; size: number; contentType: string }>;
  versao: number;
  ativo: boolean;
  publicado_em: string | null;
};
const COLUNAS = "id, slug, molde, account_id, titulo, pacote, produto_refs, carencia_dias, audios, pendentes, versao, ativo, publicado_em";

async function slugLivre(slug: string, molde: string) {
  for (let i = 1; i < 50; i += 1) {
    const tentativa = i === 1 ? slug : `${slug.slice(0, 56).replace(/-+$/, "")}-${i}`;
    const { rows } = await query<{ molde: string }>("select molde from public.apps where slug = $1", [tentativa]);
    if (!rows[0] || rows[0].molde === molde) return tentativa;
  }
  return `${slug.slice(0, 50).replace(/-+$/, "")}-${codigo(6)}`;
}

/** Cria ou atualiza o app do projeto (pelo id que a página guardou). Os códigos de produto e a carência só mudam quando vêm. */
export async function salvarApp(input: { id?: string | null; accountId: string | null; molde: string; slug: string; app: AppPacote; produtoRefs: string[] | null; carenciaDias: number | null }) {
  const refs = input.produtoRefs;
  if (input.id) {
    const { rows } = await query<{ id: string; slug: string; ativo: boolean; versao: number }>(
      `update public.apps set titulo = $2, pacote = $3::jsonb, account_id = coalesce($4, account_id),
         produto_refs = coalesce($6::text[], produto_refs), carencia_dias = coalesce($7, carencia_dias), atualizado_em = now()
       where id = $1 and molde = $5 returning id, slug, ativo, versao`,
      [input.id, input.app.titulo, JSON.stringify(input.app), input.accountId, input.molde, refs, input.carenciaDias],
    );
    if (rows[0]) return rows[0];
  }
  const slug = await slugLivre(input.slug || "app", input.molde);
  const { rows } = await query<{ id: string; slug: string; ativo: boolean; versao: number }>(
    `insert into public.apps (account_id, molde, slug, titulo, pacote, produto_refs, carencia_dias)
     values ($1, $2, $3, $4, $5::jsonb, coalesce($6::text[], '{}'), coalesce($7, ${CARENCIA_PADRAO}))
     on conflict (slug) do update set titulo = excluded.titulo, pacote = excluded.pacote, account_id = coalesce(excluded.account_id, public.apps.account_id),
       produto_refs = coalesce($6::text[], public.apps.produto_refs), carencia_dias = coalesce($7, public.apps.carencia_dias), atualizado_em = now()
     where public.apps.molde = excluded.molde
     returning id, slug, ativo, versao`,
    [input.accountId, input.molde, slug, input.app.titulo, JSON.stringify(input.app), refs, input.carenciaDias],
  );
  if (!rows[0]) throw new Error("Outro projeto já usa este endereço de app.");
  return rows[0];
}

export async function guardarPendentesApp(id: string, pendentes: AppRow["pendentes"]) {
  await query("update public.apps set pendentes = $2::jsonb, atualizado_em = now() where id = $1", [id, JSON.stringify(pendentes)]);
}

export async function getAppMolde(id: string, molde: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await query<AppRow>(`select ${COLUNAS} from public.apps where id = $1 and molde = $2`, [id, molde]);
  return rows[0] ?? null;
}

/** Abre o app (os áudios conferidos entram no lugar dos de antes) e sobe a versão (o celular troca os áudios guardados). */
export async function publicarApp(id: string, audios: AppRow["audios"]) {
  const { rows } = await query<AppRow>(
    `update public.apps set audios = $2::jsonb, pendentes = '{}'::jsonb, ativo = true, versao = versao + 1,
       publicado_em = coalesce(publicado_em, now()), atualizado_em = now()
     where id = $1 returning ${COLUNAS}`,
    [id, JSON.stringify(audios)],
  );
  return rows[0] ?? null;
}

export type AppPublico = { id: string; slug: string; molde: string; accountId: string | null; app: AppPacote; audios: AppRow["audios"]; versao: number; carenciaDias: number };

/** O app ligado pelo código da URL (relido pelo mesmo leitor: um pacote mexido à mão não quebra a página). null = não há. */
export async function getAppPublico(slug: string): Promise<AppPublico | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) return null;
  try {
    const { rows } = await query<AppRow>(`select ${COLUNAS} from public.apps where slug = $1 and ativo`, [slug]);
    const row = rows[0];
    if (!row) return null;
    const lido = lerApp({ app: row.pacote as Record<string, unknown> });
    if (!lido.ok) {
      console.error(`[app] o pacote do app ${row.slug} não abre: ${lido.erro}`);
      return null;
    }
    return { id: row.id, slug: row.slug, molde: row.molde, accountId: row.account_id, app: lido.app, audios: row.audios ?? {}, versao: row.versao, carenciaDias: row.carencia_dias };
  } catch (error) {
    if (isMissing0018(error)) return null;
    throw error;
  }
}

/* ---------------- quem assina: o aviso da plataforma ---------------- */

export type ResultadoAssinatura = "sem_app" | "sem_pessoa" | "repetido" | "aplicado";

/**
 * Aplica o aviso da plataforma às assinaturas do app cujo produto bate (apps.produto_refs). Sem produto que bata, procura a
 * assinatura pelo código dela (o aviso de cancelamento da Stripe vem sem e-mail). O 1º pagamento de alguém é «aprovada»; os
 * seguintes, «renovada» (vale para as plataformas que não avisam a renovação à parte). O mesmo aviso de novo não muda nada.
 */
export async function registrarAvisoAssinatura(plataforma: Plataforma, aviso: AvisoAssinatura): Promise<ResultadoAssinatura> {
  if (!(await hasAppsTable())) return "sem_app";
  const apps = aviso.produtos.length
    ? (await query<{ id: string; carencia_dias: number }>("select id, carencia_dias from public.apps where produto_refs && $1::text[]", [aviso.produtos])).rows
    : [];
  let alvos: Array<{ appId: string; carencia: number; assinanteId: string | null }> = apps.map((a) => ({ appId: a.id, carencia: a.carencia_dias, assinanteId: null }));
  if (!alvos.length && aviso.assinaturaRef) {
    const { rows } = await query<{ id: string; app_id: string; carencia_dias: number }>(
      "select s.id, s.app_id, a.carencia_dias from public.app_assinantes s join public.apps a on a.id = s.app_id where s.assinatura_ref = $1 and s.plataforma = $2",
      [aviso.assinaturaRef, plataforma],
    );
    alvos = rows.map((r) => ({ appId: r.app_id, carencia: r.carencia_dias, assinanteId: r.id }));
  }
  if (!alvos.length) return "sem_app";
  let resultado: ResultadoAssinatura = "sem_pessoa";
  for (const alvo of alvos) {
    const r = await transaction(async (client) => {
      let assinante: { id: string; acesso_ate: string; status: string } | undefined;
      if (alvo.assinanteId) {
        assinante = (await client.query("select id, acesso_ate, status from public.app_assinantes where id = $1 for update", [alvo.assinanteId])).rows[0];
      } else if (aviso.email) {
        assinante = (await client.query("select id, acesso_ate, status from public.app_assinantes where app_id = $1 and email = $2 for update", [alvo.appId, aviso.email])).rows[0];
      } else if (aviso.assinaturaRef) {
        assinante = (await client.query("select id, acesso_ate, status from public.app_assinantes where app_id = $1 and assinatura_ref = $2 and plataforma = $3 for update", [alvo.appId, aviso.assinaturaRef, plataforma])).rows[0];
      }
      const pagou = aviso.tipo === "aprovada" || aviso.tipo === "renovada";
      if (!assinante) {
        // só um pagamento cria a pessoa (um cancelamento de quem nunca pagou aqui não tem o que tirar)
        if (!pagou || !aviso.email) return "sem_pessoa" as const;
        assinante = (await client.query(
          `insert into public.app_assinantes (app_id, email, status, plataforma, assinatura_ref, inicio_em, sair_codigo, acesso_ate)
           values ($1, $2, 'ativo', $3, $4, coalesce($5, now()), $6, now())
           on conflict (app_id, email) do update set atualizado_em = now()
           returning id, acesso_ate, status`,
          [alvo.appId, aviso.email, plataforma, aviso.assinaturaRef, aviso.em, codigo(24)],
        )).rows[0];
      }
      if (!assinante) return "sem_pessoa" as const;
      let tipo: TipoPagamento = aviso.tipo;
      if (tipo === "aprovada") {
        const ja = await client.query("select 1 from public.app_pagamentos where assinante_id = $1 and tipo in ('aprovada', 'renovada') and not (plataforma = $2 and raw_id = $3) limit 1", [assinante.id, plataforma, aviso.rawId]);
        if (ja.rowCount) tipo = "renovada";
      }
      const em = aviso.em && aviso.em.getTime() <= Date.now() + 3_600_000 ? aviso.em : new Date();
      const novo = await client.query(
        `insert into public.app_pagamentos (app_id, assinante_id, plataforma, raw_id, tipo, valor, moeda, teste, em)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (plataforma, raw_id, tipo) do nothing returning id`,
        [alvo.appId, assinante.id, plataforma, aviso.rawId, tipo, aviso.valor, aviso.moeda, aviso.teste, em],
      );
      // o mesmo aviso de novo (ou a mesma compra contada como «aprovada» e depois «renovada»): nada muda
      if (!novo.rowCount) return "repetido" as const;
      if (tipo === "renovada" && (await client.query("select 1 from public.app_pagamentos where assinante_id = $1 and plataforma = $2 and raw_id = $3 and tipo = 'aprovada'", [assinante.id, plataforma, aviso.rawId])).rowCount) {
        await client.query("delete from public.app_pagamentos where id = $1", [novo.rows[0].id]);
        return "repetido" as const;
      }
      const depois = acessoDepois({ tipo, em, acessoAte: new Date(assinante.acesso_ate), carenciaDias: alvo.carencia });
      await client.query(
        `update public.app_assinantes set status = $2, acesso_ate = $3, status_em = now(), atualizado_em = now(),
           ultimo_pagamento_em = case when $4 then greatest(coalesce(ultimo_pagamento_em, $5), $5) else ultimo_pagamento_em end,
           plataforma = coalesce(plataforma, $6), assinatura_ref = coalesce($7, assinatura_ref)
         where id = $1`,
        [assinante.id, depois.status, depois.acessoAte, pagou, em, plataforma, aviso.assinaturaRef],
      );
      return "aplicado" as const;
    });
    if (r === "aplicado" || (r === "repetido" && resultado !== "aplicado")) resultado = r;
  }
  return resultado;
}

/* ---------------- a entrada: link e código por e-mail, a sessão do aparelho ---------------- */

export const LINK_MINUTOS = 30;
export const SESSAO_DIAS = 180;
export const CODIGO_TENTATIVAS = 5;

export type Assinante = { id: string; appId: string; email: string; status: string; acessoAte: string; fuso: string; lembrete: boolean; lembreteHora: number; sairCodigo: string };
const ASSINANTE = `s.id, s.app_id as "appId", s.email, s.status, s.acesso_ate as "acessoAte", s.fuso, s.lembrete, s.lembrete_hora as "lembreteHora", s.sair_codigo as "sairCodigo"`;

export async function getAssinantePorEmail(appId: string, email: string) {
  const { rows } = await query<Assinante>(`select ${ASSINANTE} from public.app_assinantes s where s.app_id = $1 and s.email = lower($2)`, [appId, email]);
  return rows[0] ?? null;
}

/** Um link (e o código de 6 números) para entrar, valendo 30 min e uma vez. */
export async function criarLinkAcesso(assinanteId: string) {
  const token = codigo(32);
  const numero = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await query(
    `insert into public.app_acessos (assinante_id, tipo, hash, codigo_hash, expira_em) values ($1, 'link', $2, $3, now() + make_interval(mins => $4))`,
    [assinanteId, resumo(token), resumo(`${assinanteId}:${numero}`), LINK_MINUTOS],
  );
  return { token, codigo: numero };
}

async function novaSessao(assinanteId: string) {
  const token = codigo(40);
  await query(`insert into public.app_acessos (assinante_id, tipo, hash, expira_em) values ($1, 'sessao', $2, now() + make_interval(days => $3))`, [assinanteId, resumo(token), SESSAO_DIAS]);
  return token;
}

/** Usa o link do e-mail (uma vez). Devolve a sessão nova, ou null (vencido, já usado, de outro app). */
export async function usarLink(appId: string, token: string) {
  if (!/^[a-z0-9]{32}$/.test(token)) return null;
  const { rows } = await query<{ assinante_id: string }>(
    `update public.app_acessos x set usado_em = now()
     from public.app_assinantes s
     where x.hash = $1 and x.tipo = 'link' and x.usado_em is null and x.expira_em > now() and s.id = x.assinante_id and s.app_id = $2
     returning x.assinante_id`,
    [resumo(token), appId],
  );
  return rows[0] ? novaSessao(rows[0].assinante_id) : null;
}

/** O código de 6 números (para quem abriu o app instalado: no iPhone o link do e-mail abre no Safari, fora do app). */
export async function usarCodigo(appId: string, email: string, numero: string): Promise<{ sessao: string } | { erro: "codigo" | "vencido" }> {
  if (!/^\d{6}$/.test(numero)) return { erro: "codigo" };
  const assinante = await getAssinantePorEmail(appId, email);
  if (!assinante) return { erro: "codigo" };
  const { rows } = await query<{ id: string; codigo_hash: string; tentativas: number }>(
    `select id, codigo_hash, tentativas from public.app_acessos where assinante_id = $1 and tipo = 'link' and usado_em is null and expira_em > now() and tentativas < $2
     order by criado_em desc limit 1`,
    [assinante.id, CODIGO_TENTATIVAS],
  );
  const link = rows[0];
  if (!link) return { erro: "vencido" };
  if (link.codigo_hash !== resumo(`${assinante.id}:${numero}`)) {
    await query("update public.app_acessos set tentativas = tentativas + 1 where id = $1", [link.id]);
    return { erro: "codigo" };
  }
  const usado = await query("update public.app_acessos set usado_em = now() where id = $1 and usado_em is null", [link.id]);
  if (!usado.rowCount) return { erro: "vencido" };
  return { sessao: await novaSessao(assinante.id) };
}

/** A pessoa da sessão deste aparelho (ou null). */
export async function getSessao(appId: string, token: string) {
  if (!/^[a-z0-9]{40}$/.test(token)) return null;
  try {
    const { rows } = await query<Assinante>(
      `select ${ASSINANTE} from public.app_acessos x join public.app_assinantes s on s.id = x.assinante_id
       where x.hash = $1 and x.tipo = 'sessao' and x.expira_em > now() and s.app_id = $2`,
      [resumo(token), appId],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isMissing0018(error)) return null;
    throw error;
  }
}

export async function sairDaSessao(token: string) {
  if (!/^[a-z0-9]{40}$/.test(token)) return;
  await query("delete from public.app_acessos where hash = $1 and tipo = 'sessao'", [resumo(token)]);
}

/* ---------------- o uso de cada dia ---------------- */

/** Os dias em que a pessoa tocou (AAAA-MM-DD), os mais novos primeiro (até 400). */
export async function diasDeUso(assinanteId: string) {
  const { rows } = await query<{ dia: string }>("select to_char(dia, 'YYYY-MM-DD') as dia from public.app_uso where assinante_id = $1 order by dia desc limit 400", [assinanteId]);
  return rows.map((r) => r.dia);
}

/** Conta o dia de hoje (no fuso da pessoa; o fuso do aparelho fica guardado para o lembrete). true = dia novo. */
export async function registrarUso(assinanteId: string, input: { fuso: string | null; noite: number | null; agora?: Date }) {
  const fuso = input.fuso && fusoValido(input.fuso) ? input.fuso : null;
  if (fuso) await query("update public.app_assinantes set fuso = $2 where id = $1 and fuso <> $2", [assinanteId, fuso]);
  const { rows } = await query<{ fuso: string }>("select fuso from public.app_assinantes where id = $1", [assinanteId]);
  const dia = diaLocal(input.agora ?? new Date(), rows[0]?.fuso ?? "America/Sao_Paulo");
  const r = await query("insert into public.app_uso (assinante_id, dia, noite) values ($1, $2::date, $3) on conflict (assinante_id, dia) do nothing", [assinanteId, dia, input.noite]);
  return (r.rowCount ?? 0) > 0;
}

/* ---------------- o lembrete ---------------- */

export async function salvarLembrete(assinanteId: string, input: { ativo: boolean; hora: number; fuso: string | null }) {
  await query(
    `update public.app_assinantes set lembrete = $2, lembrete_hora = $3, fuso = coalesce($4, fuso), atualizado_em = now() where id = $1`,
    [assinanteId, input.ativo, Math.max(0, Math.min(23, Math.round(input.hora) || 0)), input.fuso && fusoValido(input.fuso) ? input.fuso : null],
  );
}

/** O «não quero mais o lembrete» do e-mail. true = achou. */
export async function sairDoLembrete(codigoSair: string) {
  if (!/^[a-z0-9]{24}$/.test(codigoSair)) return false;
  const { rowCount } = await query("update public.app_assinantes set lembrete = false, atualizado_em = now() where sair_codigo = $1", [codigoSair]);
  return (rowCount ?? 0) > 0;
}

export type LembreteDaVez = { assinanteId: string; email: string; sairCodigo: string; fuso: string; slug: string; pacote: unknown; feitos: number };

/**
 * Os lembretes da hora (no fuso de cada pessoa): quem ligou, tem acesso, ainda não recebeu hoje, já passou da hora dela e ainda
 * não tocou hoje. Marca o dia ANTES de mandar (dois relógios nunca mandam o mesmo lembrete; um envio que falha não repete no dia).
 */
export async function pegarLembretes(limite: number) {
  const { rows } = await query<LembreteDaVez>(
    `with alvo as (
       select s.id from public.app_assinantes s join public.apps a on a.id = s.app_id
       where a.ativo and s.lembrete and s.acesso_ate > now()
         and (s.lembrete_ultimo is null or s.lembrete_ultimo < (now() at time zone s.fuso)::date)
         and extract(hour from (now() at time zone s.fuso)) >= s.lembrete_hora
         and not exists (select 1 from public.app_uso u where u.assinante_id = s.id and u.dia = (now() at time zone s.fuso)::date)
       order by s.lembrete_ultimo nulls first
       limit $1
       for update of s skip locked
     )
     update public.app_assinantes s set lembrete_ultimo = (now() at time zone s.fuso)::date
     from alvo, public.apps a
     where s.id = alvo.id and a.id = s.app_id
     returning s.id as "assinanteId", s.email, s.sair_codigo as "sairCodigo", s.fuso, a.slug, a.pacote,
       (select count(*)::int from public.app_uso u where u.assinante_id = s.id) as feitos`,
    [limite],
  );
  return rows;
}

/* ---------------- os números do teste (para a página do Molde) ---------------- */

export async function numerosDoApp(appId: string, publicadoEm: string | null, agora = new Date()): Promise<NumerosApp> {
  const [contas, pagamentos, mrr, usos] = await Promise.all([
    query<{ ativos: number; carencia: number; novos: number; elegiveis: number; retidos: number }>(
      `select
         count(*) filter (where status = 'ativo' and acesso_ate > $2::timestamptz)::int as ativos,
         count(*) filter (where status <> 'ativo' and acesso_ate > $2::timestamptz)::int as carencia,
         count(*) filter (where inicio_em > $2::timestamptz - interval '30 days')::int as novos,
         count(*) filter (where inicio_em <= $2::timestamptz - interval '35 days')::int as elegiveis,
         count(*) filter (where inicio_em <= $2::timestamptz - interval '35 days' and exists (
           select 1 from public.app_pagamentos p where p.assinante_id = s.id and p.tipo = 'renovada' and not p.teste))::int as retidos
       from public.app_assinantes s where s.app_id = $1`,
      [appId, agora],
    ),
    query<{ tipo: string; moeda: string; valor: string; pessoas: number }>(
      `select tipo, moeda, sum(valor)::text as valor, count(distinct assinante_id)::int as pessoas from public.app_pagamentos
       where app_id = $1 and not teste and em > $2::timestamptz - interval '30 days' group by tipo, moeda`,
      [appId, agora],
    ),
    query<{ moeda: string; valor: string }>(
      `select p.moeda, sum(p.valor)::text as valor from public.app_assinantes s
       join lateral (select moeda, valor from public.app_pagamentos x where x.assinante_id = s.id and x.tipo in ('aprovada', 'renovada') and not x.teste order by x.em desc limit 1) p on true
       where s.app_id = $1 and s.status = 'ativo' and s.acesso_ate > $2::timestamptz group by p.moeda`,
      [appId, agora],
    ),
    query<{ id: string; fuso: string; dia: string }>(
      `select s.id, s.fuso, to_char(u.dia, 'YYYY-MM-DD') as dia from public.app_assinantes s
       left join public.app_uso u on u.assinante_id = s.id and u.dia > ($2::timestamptz - interval '62 days')::date
       where s.app_id = $1 and s.acesso_ate > $2::timestamptz`,
      [appId, agora],
    ),
  ]);
  const c = contas.rows[0] ?? { ativos: 0, carencia: 0, novos: 0, elegiveis: 0, retidos: 0 };
  const receita30: Record<string, number> = {};
  let cancelamentos = 0;
  for (const p of pagamentos.rows) {
    const v = Number(p.valor) || 0;
    if (p.tipo === "aprovada" || p.tipo === "renovada") receita30[p.moeda] = (receita30[p.moeda] ?? 0) + v;
    if (p.tipo === "reembolsada" || p.tipo === "chargeback") receita30[p.moeda] = (receita30[p.moeda] ?? 0) - v;
    if (p.tipo === "cancelada" || p.tipo === "reembolsada" || p.tipo === "chargeback") cancelamentos += p.pessoas;
  }
  for (const k of Object.keys(receita30)) receita30[k] = Math.round(receita30[k] * 100) / 100;
  const mrrOut: Record<string, number> = {};
  for (const r of mrr.rows) mrrOut[r.moeda] = Math.round((Number(r.valor) || 0) * 100) / 100;
  // o uso: por pessoa com acesso, os dias dos últimos 62 dias (no fuso dela)
  const porPessoa = new Map<string, { fuso: string; dias: string[] }>();
  for (const u of usos.rows) {
    const p = porPessoa.get(u.id) ?? { fuso: u.fuso, dias: [] };
    if (u.dia) p.dias.push(u.dia);
    porPessoa.set(u.id, p);
  }
  let tocaramHoje = 0, diasSemana = 0, quatro = 0, somaSeguidos = 0;
  for (const p of porPessoa.values()) {
    const hoje = diaLocal(agora, p.fuso);
    const semana = new Set(Array.from({ length: 7 }, (_, i) => new Date(new Date(`${hoje}T12:00:00Z`).getTime() - i * 86_400_000).toISOString().slice(0, 10)));
    const naSemana = p.dias.filter((d) => semana.has(d)).length;
    if (p.dias.includes(hoje)) tocaramHoje += 1;
    diasSemana += naSemana;
    if (naSemana >= 4) quatro += 1;
    somaSeguidos += diasSeguidos(p.dias, hoje);
  }
  const n = porPessoa.size;
  return {
    ativos: c.ativos,
    emCarencia: c.carencia,
    novos30: c.novos,
    cancelamentos30: cancelamentos,
    retencao2: { elegiveis: c.elegiveis, retidos: c.retidos, taxa: taxa(c.retidos, c.elegiveis) },
    uso: { tocaramHoje, semana: taxa(diasSemana, n * 7), seguidosMedia: n ? Math.round((somaSeguidos / n) * 10) / 10 : null, quatroDias: taxa(quatro, n) },
    receita30,
    mrr: mrrOut,
    diasDeTeste: publicadoEm ? Math.floor((agora.getTime() - new Date(publicadoEm).getTime()) / 86_400_000) : null,
  };
}

/** Os apps do projeto, com os números. */
export async function listarAppsMolde(molde: string) {
  const { rows } = await query<AppRow & { atualizado_em: string }>(`select ${COLUNAS}, atualizado_em from public.apps where molde = $1 order by atualizado_em desc limit 20`, [molde]);
  const out = [];
  for (const r of rows) {
    out.push({ id: r.id, slug: r.slug, titulo: r.titulo, ativo: r.ativo, versao: r.versao, publicadoEm: r.publicado_em, produtoRefs: r.produto_refs, carenciaDias: r.carencia_dias, audios: Object.keys(r.audios ?? {}).length, numeros: await numerosDoApp(r.id, r.publicado_em) });
  }
  return out;
}

/** O código curto aleatório (os testes usam para semear). */
export function novoCodigoApp(n = 24) {
  return codigo(n);
}
