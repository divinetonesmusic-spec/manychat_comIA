import { randomInt } from "node:crypto";
import { query } from "@/lib/db/client";

/**
 * Links rastreados (0006, seção 3): um link curto /l/<código> por (perfil, Reel) que leva ao destino e conta os cliques.
 * Sem a 0006 as tabelas não existem (erro 42P01): `isMissingTables` reconhece isso para as rotas responderem com calma.
 */

export type ClickOrigin = "bio" | "dm" | "comentario" | "outro";

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

export type TrackedLink = { id: string; slug: string; accountId: string | null; externalRef: string; destino: string; criado: boolean };

/**
 * Cria o link do Reel ou devolve o que já existe (mesmo código; se o destino mudou, atualiza o destino e os cliques continuam).
 * Se o código sorteado já existir em outro link, sorteia de novo.
 */
export async function upsertTrackedLink(
  input: { accountId: string | null; externalRef: string; destino: string; rotulo?: string },
  sortear: () => string = newSlug, // só os testes trocam, para forçar um código repetido
): Promise<TrackedLink> {
  for (let attempt = 0; attempt < SLUG_TRIES; attempt += 1) {
    try {
      const { rows } = await query<{ id: string; slug: string; account_id: string | null; external_ref: string; destination_url: string; criado: boolean }>(
        `insert into public.tracked_links (slug, account_id, external_ref, destination_url, label)
         values ($1, $2, $3, $4, coalesce($5::text, ''))
         on conflict (coalesce(account_id::text, ''), external_ref) do update
           set destination_url = excluded.destination_url,
               label = coalesce($5::text, public.tracked_links.label),
               updated_at = case when public.tracked_links.destination_url is distinct from excluded.destination_url
                                   or ($5::text is not null and public.tracked_links.label is distinct from $5)
                                 then now() else public.tracked_links.updated_at end
         returning id, slug, account_id, external_ref, destination_url, (xmax = 0) as criado`,
        [sortear(), input.accountId, input.externalRef, input.destino, input.rotulo ?? null],
      );
      const row = rows[0];
      return { id: row.id, slug: row.slug, accountId: row.account_id, externalRef: row.external_ref, destino: row.destination_url, criado: row.criado };
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
        cliques: { total: 0, d7: 0, d30: 0, porOrigem: { bio: 0, dm: 0, comentario: 0, outro: 0 } },
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

export async function findLinkBySlug(slug: string) {
  const { rows } = await query<{ id: string; destination_url: string }>(
    "select id, destination_url from public.tracked_links where slug = $1",
    [slug],
  );
  return rows[0] ? { id: rows[0].id, destino: rows[0].destination_url } : null;
}

/** Grava um clique. Não guarda IP nem navegador. */
export async function recordClick(linkId: string, origin: ClickOrigin) {
  await query("insert into public.link_clicks (link_id, origin) values ($1, $2)", [linkId, origin]);
}
