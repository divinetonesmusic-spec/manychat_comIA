import { query } from "@/lib/db/client";

/**
 * Registro dos itens do Molde já mandados para o Instagram (public.content_refs_publicadas, migração 0015).
 * Chave única no banco: (perfil, externalRef). O relógio reserva a referência ANTES do media_publish; se ela já é de
 * outro post (por exemplo, o post foi apagado do UaiFlow e o Molde mandou o mesmo item de novo), não publica.
 * Sem a 0015 tudo aqui responde "pode seguir" (as travas antigas, da 0003, continuam valendo).
 */
export const MIGRATION_0015_MISSING = "Falta colar a atualização 0015 no Supabase (veja docs/ATUALIZACAO_0015.md).";

/** Frase do post bloqueado por já ter saído antes (sem palavras que o tradutor de erros da Meta reconheça). */
export const REF_JA_PUBLICADA_MESSAGE =
  "Este item do Molde já foi publicado neste perfil por outro post. Não publiquei de novo para não duplicar o Reel. Para postar de novo, mande como um item novo.";

let cached: { exists: boolean; checkedAt: number } | null = null;

export async function hasRefsPublicadasTable() {
  if (cached && (cached.exists || Date.now() - cached.checkedAt < 60_000)) return cached.exists;
  const { rows } = await query<{ exists: boolean }>("select to_regclass('public.content_refs_publicadas') is not null as exists");
  cached = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
  return cached.exists;
}

/** Só para os testes: esquece se a tabela existe. */
export function resetRefsPublicadasProbe() {
  cached = null;
}

type PostRef = { id: string; account_id: string | null; external_ref?: string | null };

export type RefPublicada = { postId: string | null; estado: "pedido" | "publicado"; mediaId: string | null; permalink: string | null };

function refOf(post: PostRef) {
  const ref = post.external_ref?.trim();
  return post.account_id && ref ? { accountId: post.account_id, ref } : null;
}

/** A referência já foi mandada para o Instagram por OUTRO post deste perfil? (null = não, ou sem a 0015.) */
export async function findRefPublicada(accountId: string | null | undefined, externalRef: string | null | undefined, exceptPostId?: string | null): Promise<RefPublicada | null> {
  const ref = externalRef?.trim();
  if (!accountId || !ref || !(await hasRefsPublicadasTable())) return null;
  const { rows } = await query<{ post_id: string | null; estado: "pedido" | "publicado"; media_id: string | null; permalink: string | null }>(
    `select post_id, estado, media_id, permalink from public.content_refs_publicadas
      where account_id = $1 and external_ref = $2 and post_id is distinct from $3`,
    [accountId, ref, exceptPostId ?? null],
  );
  const row = rows[0];
  return row ? { postId: row.post_id, estado: row.estado, mediaId: row.media_id, permalink: row.permalink } : null;
}

/**
 * Reserva a referência para ESTE post, logo antes de pedir a publicação. Atômico (chave única + on conflict):
 * - livre, ou já reservada por este mesmo post: { ok: true };
 * - de outro post: { ok: false, outro } (não publicar).
 * Post sem referência do Molde ou sem a 0015: { ok: true }.
 */
export async function reservarRefParaPublicar(post: PostRef): Promise<{ ok: true } | { ok: false; outro: RefPublicada }> {
  const key = refOf(post);
  if (!key || !(await hasRefsPublicadasTable())) return { ok: true };
  const { rows } = await query<{ post_id: string }>(
    `insert into public.content_refs_publicadas (account_id, external_ref, post_id)
     values ($1, $2, $3)
     on conflict (account_id, external_ref) do update set atualizado_em = now()
       where public.content_refs_publicadas.post_id = excluded.post_id
     returning post_id`,
    [key.accountId, key.ref, post.id],
  );
  if (rows.length) return { ok: true };
  const outro = await findRefPublicada(key.accountId, key.ref, post.id);
  // Corrida rara: a linha sumiu entre o insert e a leitura (perfil apagado). Na dúvida, não publica.
  return { ok: false, outro: outro ?? { postId: null, estado: "pedido", mediaId: null, permalink: null } };
}

/** Depois que o post saiu: marca a referência como publicada (com o id e o link do Instagram). Nunca lança erro. */
export async function marcarRefPublicada(post: PostRef, media: { id?: string | null; permalink?: string | null } | null) {
  const key = refOf(post);
  if (!key) return;
  try {
    if (!(await hasRefsPublicadasTable())) return;
    await query(
      `insert into public.content_refs_publicadas (account_id, external_ref, post_id, estado, media_id, permalink)
       values ($1, $2, $3, 'publicado', $4, $5)
       on conflict (account_id, external_ref) do update set
         estado = 'publicado',
         media_id = coalesce(excluded.media_id, public.content_refs_publicadas.media_id),
         permalink = coalesce(excluded.permalink, public.content_refs_publicadas.permalink),
         atualizado_em = now()
       where public.content_refs_publicadas.post_id = excluded.post_id`,
      [key.accountId, key.ref, post.id, media?.id ?? null, media?.permalink ?? null],
    );
  } catch (error) {
    console.warn("[refs] não consegui marcar a referência como publicada:", error instanceof Error ? error.message.slice(0, 200) : error);
  }
}
