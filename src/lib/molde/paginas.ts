import { randomInt, randomUUID } from "node:crypto";
import { query } from "@/lib/db/client";
import { getR2Config, getR2Object, PASTA_PAGINAS_R2, putR2Object } from "@/lib/content/r2";

/**
 * As páginas de venda do Molde no ar pelo UaiFlow (0020, Molde v137, etapa K12). A Fábrica do Molde gera a página como um
 * arquivo HTML só (pagina-para-subir.html, com as imagens embutidas); a página do Molde manda esse HTML para
 * POST /api/molde/paginas e ele abre em /v/<slug>, isolado (CSP sandbox, sem a origem do UaiFlow).
 * O HTML fica PRIVADO no R2 (uaiflow/paginas/<id>.html); sem o R2 configurado, fica no banco (coluna html).
 * Contrato: docs/API_MOLDE_PAGINAS.md.
 */

export const MIGRATION_0020 = "Falta colar a atualização 0020 no Supabase (veja docs/ATUALIZACAO_0020.md): a página de venda pelo UaiFlow ainda não funciona.";
/** O maior HTML aceito (5 MB). O Netlify recusa pedidos acima de ~6 MB, e o JSON do pedido é um pouco maior que o HTML. */
export const PAGINA_MAX_BYTES = 5 * 1024 * 1024;
export const SLUG = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

/** A 0020 ainda não foi colada (a tabela não existe). */
export function isMissing0020(error: unknown) {
  return (error as { code?: string } | null)?.code === "42P01";
}

/**
 * A página de venda do Molde (/v/<slug>, 0020). O HTML é do Molde (gerado pela Fábrica), então roda ISOLADO:
 *  - CSP `sandbox` SEM allow-same-origin: o navegador trata a página como de uma origem própria e vazia; ela não lê os
 *    cookies, o armazenamento nem as rotas do UaiFlow com o login do painel (mesmo estando no mesmo domínio);
 *  - allow-scripts e allow-forms: a página funciona (contagem, perguntas, formulários de checkout);
 *  - allow-popups + allow-popups-to-escape-sandbox: o checkout aberto em nova aba abre normal (fora do isolamento);
 *  - allow-top-navigation-by-user-activation: um toque num link leva a página inteira ao checkout (ou ao /l/<código>);
 *  - frame-ancestors 'none': ninguém põe a página dentro de outro site (clique enganado).
 */
export const CSP_PAGINA = [
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation",
  "frame-ancestors 'none'",
].join("; ");

export type PaginaRow = {
  id: string;
  molde: string;
  account_id: string | null;
  slug: string;
  titulo: string;
  armazenamento: "r2" | "banco";
  html_key: string | null;
  tamanho: number;
  publicada: boolean;
  publicada_em: Date | null;
  criado_em: Date;
  atualizado_em: Date;
};

const COLUNAS = "id, molde, account_id, slug, titulo, armazenamento, html_key, tamanho, publicada, publicada_em, criado_em, atualizado_em";
const ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789";

/** «Oração da Manhã — 7 dias!» → «oracao-da-manha-7-dias». Vazio quando não sobra nada. */
export function slugDe(texto: string) {
  const base = String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  if (base.length >= 3) return base;
  return base ? `${base}-pagina`.replace(/^-+/, "") : "";
}

function sufixo(n = 5) {
  let out = "";
  for (let i = 0; i < n; i += 1) out += ALFABETO[randomInt(ALFABETO.length)];
  return out;
}

/** O endereço livre: o pedido, ou com -2, -3… quando outro projeto (ou outra página) já usa. */
async function slugLivre(slug: string, molde: string, id: string | null) {
  for (let i = 1; i < 30; i += 1) {
    const tentativa = i === 1 ? slug : `${slug.slice(0, 56).replace(/-+$/, "")}-${i}`;
    const { rows } = await query<{ id: string; molde: string }>("select id, molde from public.molde_paginas where slug = $1", [tentativa]);
    if (!rows[0] || rows[0].id === id || (!id && rows[0].molde === molde)) return tentativa;
  }
  return `${slug.slice(0, 50).replace(/-+$/, "")}-${sufixo(6)}`;
}

export type SalvarPagina = { id: string | null; slug: string | null; titulo: string; html: string; molde: string; accountId: string | null; publicada: boolean };
export type SalvarResultado = { ok: true; pagina: PaginaRow; criada: boolean } | { ok: false; motivo: "nao-achou" | "conta" };

/**
 * Cria ou atualiza a página. Pelo `id` (a mesma página do projeto; outro projeto = não achou) ou pelo `slug` (o mesmo
 * endereço no mesmo projeto = atualiza; de outro projeto = ganha -2). Sem slug, ele sai do título (e o mesmo título no mesmo
 * projeto atualiza a mesma página).
 * Grava o HTML no R2 (privado) ou, sem o R2, no banco; só depois marca «publicada».
 */
export async function salvarPagina(input: SalvarPagina): Promise<SalvarResultado> {
  let atual: PaginaRow | null = null;
  if (input.id) {
    const { rows } = await query<PaginaRow>(`select ${COLUNAS} from public.molde_paginas where id = $1 and molde = $2`, [input.id, input.molde]);
    atual = rows[0] ?? null;
    if (!atual) return { ok: false, motivo: "nao-achou" };
  } else {
    // sem id: o mesmo endereço (o mandado, ou o que sai do título) no mesmo projeto é a mesma página
    const procurado = input.slug || slugDe(input.titulo);
    if (procurado) {
      const { rows } = await query<PaginaRow>(`select ${COLUNAS} from public.molde_paginas where slug = $1 and molde = $2`, [procurado, input.molde]);
      atual = rows[0] ?? null;
    }
  }
  const pedido = input.slug || (atual ? atual.slug : slugDe(input.titulo) || `pagina-${sufixo(6)}`);
  const slug = atual && pedido === atual.slug ? atual.slug : await slugLivre(pedido, input.molde, atual?.id ?? null);
  const id = atual?.id ?? randomUUID();
  const r2 = getR2Config();
  const tamanho = Buffer.byteLength(input.html, "utf8");
  const key = r2 ? `${PASTA_PAGINAS_R2}/${id}.html` : null;

  try {
    if (atual) {
      await query(
        `update public.molde_paginas set slug = $2, titulo = $3, account_id = coalesce($4, account_id), armazenamento = $5,
           html_key = $6, html = $7, tamanho = $8, atualizado_em = now() where id = $1`,
        [id, slug, input.titulo, input.accountId, r2 ? "r2" : "banco", key, r2 ? null : input.html, tamanho],
      );
    } else {
      await query(
        `insert into public.molde_paginas (id, molde, account_id, slug, titulo, armazenamento, html_key, html, tamanho, publicada)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
        [id, input.molde, input.accountId, slug, input.titulo, r2 ? "r2" : "banco", key, r2 ? null : input.html, tamanho],
      );
    }
  } catch (error) {
    if ((error as { code?: string }).code === "23503") return { ok: false, motivo: "conta" };
    if ((error as { code?: string }).code === "23505" && !atual) {
      // outro pedido criou o mesmo endereço no mesmo instante: tenta com o próximo livre
      return salvarPagina({ ...input, slug: `${slug.slice(0, 52).replace(/-+$/, "")}-${sufixo(4)}` });
    }
    throw error;
  }
  if (r2 && key) await putR2Object(key, Buffer.from(input.html, "utf8"), "text/html; charset=utf-8", { timeoutMs: 20_000 });
  const { rows } = await query<PaginaRow>(
    `update public.molde_paginas set publicada = $2, publicada_em = case when $2 then coalesce(publicada_em, now()) else publicada_em end, atualizado_em = now()
     where id = $1 returning ${COLUNAS}`,
    [id, input.publicada],
  );
  return { ok: true, pagina: rows[0], criada: !atual };
}

export async function listarPaginas(molde: string) {
  const { rows } = await query<PaginaRow>(`select ${COLUNAS} from public.molde_paginas where molde = $1 order by atualizado_em desc limit 100`, [molde]);
  return rows;
}

/** Tira do ar (o conteúdo fica: um POST com o mesmo id põe de volta). null = não achou. */
export async function tirarDoAr(id: string, molde: string | null) {
  const { rows } = await query<PaginaRow>(
    `update public.molde_paginas set publicada = false, atualizado_em = now() where id = $1 and ($2::text is null or molde = $2) returning ${COLUNAS}`,
    [id, molde],
  );
  return rows[0] ?? null;
}

/** O HTML da página publicada pelo endereço (/v/<slug>). null = não existe, não está no ar, ou falta a 0020. */
export async function htmlPublicado(slug: string): Promise<{ pagina: PaginaRow; html: Buffer } | null> {
  if (!SLUG.test(slug)) return null;
  let row: (PaginaRow & { html: string | null }) | undefined;
  try {
    ({ rows: [row] } = await query<PaginaRow & { html: string | null }>(`select ${COLUNAS}, html from public.molde_paginas where slug = $1 and publicada`, [slug]));
  } catch (error) {
    if (isMissing0020(error)) return null;
    throw error;
  }
  if (!row) return null;
  if (row.armazenamento === "banco") return row.html ? { pagina: row, html: Buffer.from(row.html, "utf8") } : null;
  if (!row.html_key) return null;
  const html = await getR2Object(row.html_key, { timeoutMs: 8_000 });
  return html ? { pagina: row, html } : null;
}

/**
 * O começo do endereço das páginas: PAGINAS_BASE_URL (opcional, o domínio próprio, ex.: https://oracaodamanha.com.br, ligado
 * no mesmo site do Netlify) ou o endereço do UaiFlow.
 */
export function baseDasPaginas(padrao: string) {
  const v = process.env.PAGINAS_BASE_URL?.trim().replace(/\/+$/, "");
  if (!v) return padrao;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" ? url.origin : padrao;
  } catch {
    return padrao;
  }
}

export function paginaView(p: PaginaRow, base: string) {
  return {
    id: p.id,
    slug: p.slug,
    url: `${base}/v/${p.slug}`,
    titulo: p.titulo,
    molde: p.molde,
    accountId: p.account_id,
    tamanho: p.tamanho,
    armazenamento: p.armazenamento,
    publicada: p.publicada,
    publicadaEm: p.publicada_em ? new Date(p.publicada_em).toISOString() : null,
    criadoEm: new Date(p.criado_em).toISOString(),
    atualizadoEm: new Date(p.atualizado_em).toISOString(),
  };
}
