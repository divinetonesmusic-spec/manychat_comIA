import { randomInt } from "node:crypto";
import { query } from "@/lib/db/client";

/**
 * Links rastreados (0006, seção 3): um link curto /l/<código> por (perfil, Reel) que leva ao destino e conta os cliques.
 * Sem a 0006 as tabelas não existem (erro 42P01): `isMissingTables` reconhece isso para as rotas responderem com calma.
 */

export type ClickOrigin = "bio" | "dm" | "comentario" | "story" | "outro";

export const MIGRATION_0012_LINKS = "Falta colar a atualização 0012 no Supabase: o link continua levando ao destino de sempre (sem a origem do post no checkout).";

/** A 0012 foi colada? (tracked_links.origem / destino_origem). Lembra o "sim"; o "não" vale 1 min. */
let origemColumns: { exists: boolean; checkedAt: number } | null = null;
export async function hasLinkOrigemColumns() {
  if (origemColumns && (origemColumns.exists || Date.now() - origemColumns.checkedAt < 60_000)) return origemColumns.exists;
  const { rows } = await query<{ exists: boolean }>(
    `select exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tracked_links' and column_name = 'destino_origem') as exists`,
  );
  origemColumns = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
  return origemColumns.exists;
}

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 7;
const SLUG_TRIES = 8;

export class AccountNotFoundError extends Error {}

/** A 0006 ainda não foi colada no Supabase (tabela inexistente). */
export function isMissingTables(error: unknown) {
  return (error as { code?: string } | null)?.code === "42P01";
}

export function newSlug() {
  let slug = "";
  for (let i = 0; i < SLUG_LENGTH; i += 1) slug += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  return slug;
}

export type TrackedLink = { id: string; slug: string; accountId: string | null; externalRef: string; destino: string; criado: boolean; origem?: string | null; destinoComOrigem?: string | null; semOrigem?: boolean };

/**
 * Cria o link do Reel ou devolve o que já existe (mesmo código; se o destino mudou, atualiza o destino e os cliques continuam).
 * Se o código sorteado já existir em outro link, sorteia de novo.
 */
export async function upsertTrackedLink(
  input: { accountId: string | null; externalRef: string; destino: string; rotulo?: string; origem?: string | null; destinoComOrigem?: string | null },
  sortear: () => string = newSlug, // só os testes trocam, para forçar um código repetido
): Promise<TrackedLink> {
  // Origem do post no checkout (0012): sem as colunas, o link é gravado como antes (e leva ao destino de sempre).
  // Com as colunas, todo pedido grava o destino_origem (null quando não veio): trocar o destino sem a origem nunca deixa o
  // link levando ao checkout antigo.
  const pedeOrigem = Boolean(input.origem || input.destinoComOrigem);
  const comOrigem = await hasLinkOrigemColumns();
  const origemSet = comOrigem
    ? `, origem = coalesce(excluded.origem, public.tracked_links.origem), destino_origem = excluded.destino_origem`
    : "";
  for (let attempt = 0; attempt < SLUG_TRIES; attempt += 1) {
    try {
      const { rows } = await query<{ id: string; slug: string; account_id: string | null; external_ref: string; destination_url: string; criado: boolean; origem?: string | null; destino_origem?: string | null }>(
        `insert into public.tracked_links (slug, account_id, external_ref, destination_url, label${comOrigem ? ", origem, destino_origem" : ""})
         values ($1, $2, $3, $4, coalesce($5::text, '')${comOrigem ? ", $6, $7" : ""})
         on conflict (coalesce(account_id::text, ''), external_ref) do update
           set destination_url = excluded.destination_url,
               label = coalesce($5::text, public.tracked_links.label)${origemSet},
               updated_at = case when public.tracked_links.destination_url is distinct from excluded.destination_url
                                   or ($5::text is not null and public.tracked_links.label is distinct from $5)
                                 then now() else public.tracked_links.updated_at end
         returning id, slug, account_id, external_ref, destination_url, (xmax = 0) as criado${comOrigem ? ", origem, destino_origem" : ""}`,
        [sortear(), input.accountId, input.externalRef, input.destino, input.rotulo ?? null, ...(comOrigem ? [input.origem ?? null, input.destinoComOrigem ?? null] : [])],
      );
      const row = rows[0];
      return {
        id: row.id,
        slug: row.slug,
        accountId: row.account_id,
        externalRef: row.external_ref,
        destino: row.destination_url,
        criado: row.criado,
        ...(comOrigem && pedeOrigem ? { origem: row.origem ?? null, destinoComOrigem: row.destino_origem ?? null } : {}),
        ...(pedeOrigem && !comOrigem ? { semOrigem: true } : {}),
      };
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === "23505" && pgError.constraint === "tracked_links_slug_key") continue; // código repetido: sorteia outro
      if (pgError.code === "23503") throw new AccountNotFoundError("Perfil não encontrado.");
      throw error;
    }
  }
  throw new Error("Não foi possível sortear um código de link livre.");
}

export type LinkWithClicks = {
  externalRef: string;
  accountId: string | null;
  slug: string;
  destino: string;
  cliques: { total: number; d7: number; d30: number; porOrigem: Record<ClickOrigin, number> };
};

/** Links (e a contagem de cliques, numa consulta só) dos Reels pedidos. Sem `refs`, os mais recentes. */
export async function listLinksWithClicks(input: { accountId?: string | null; refs?: string[]; limite?: number }): Promise<LinkWithClicks[]> {
  const { rows } = await query<{
    id: string;
    external_ref: string;
    account_id: string | null;
    slug: string;
    destination_url: string;
    origin: ClickOrigin | null;
    total: string;
    d7: string;
    d30: string;
  }>(
    `select l.id, l.external_ref, l.account_id, l.slug, l.destination_url, c.origin,
            count(c.id) as total,
            count(c.id) filter (where c.clicked_at > now() - interval '7 days') as d7,
            count(c.id) filter (where c.clicked_at > now() - interval '30 days') as d30
     from (
       select * from public.tracked_links
       where ($1::uuid is null or account_id = $1)
         and ($2::text[] is null or external_ref = any($2))
       order by created_at desc, id
       limit $3
     ) l
     left join public.link_clicks c on c.link_id = l.id
     group by l.id, l.external_ref, l.account_id, l.slug, l.destination_url, l.created_at, c.origin
     order by l.created_at desc, l.id`,
    [input.accountId ?? null, input.refs?.length ? input.refs : null, input.limite ?? 200],
  );
  const byId = new Map<string, LinkWithClicks>();
  for (const row of rows) {
    let link = byId.get(row.id);
    if (!link) {
      link = {
        externalRef: row.external_ref,
        accountId: row.account_id,
        slug: row.slug,
        destino: row.destination_url,
        cliques: { total: 0, d7: 0, d30: 0, porOrigem: { bio: 0, dm: 0, comentario: 0, story: 0, outro: 0 } },
      };
      byId.set(row.id, link);
    }
    if (row.origin) {
      link.cliques.total += Number(row.total);
      link.cliques.d7 += Number(row.d7);
      link.cliques.d30 += Number(row.d30);
      link.cliques.porOrigem[row.origin] += Number(row.total);
    }
  }
  return [...byId.values()];
}

/**
 * O link pelo código. `destino` = para onde o /l/ leva: o checkout com a origem do post (0012), quando houver; senão o destino
 * de sempre. (to_jsonb lê as colunas da 0012 sem quebrar quando elas ainda não existem.)
 */
export async function findLinkBySlug(slug: string): Promise<{ id: string; destino: string; origem: string | null } | null> {
  const { rows } = await query<{ id: string; destination_url: string; destino_origem: string | null; origem: string | null }>(
    `select l.id, l.destination_url, to_jsonb(l) ->> 'destino_origem' as destino_origem, to_jsonb(l) ->> 'origem' as origem
     from public.tracked_links l where l.slug = $1`,
    [slug],
  );
  const row = rows[0];
  return row ? { id: row.id, destino: row.destino_origem || row.destination_url, origem: row.origem || null } : null;
}

/** Grava um clique. Não guarda IP nem navegador. Sem a 0012 o banco ainda não aceita "story": conta como "outro". */
export async function recordClick(linkId: string, origin: ClickOrigin) {
  try {
    await query("insert into public.link_clicks (link_id, origin) values ($1, $2)", [linkId, origin]);
  } catch (error) {
    if (origin !== "story" || (error as { code?: string } | null)?.code !== "23514") throw error;
    await query("insert into public.link_clicks (link_id, origin) values ($1, 'outro')", [linkId]);
  }
}
