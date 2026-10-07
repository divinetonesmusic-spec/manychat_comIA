import type { TestDatabase } from "./db.mjs";

export const LEGENDA = "Legenda do Reel #teste\nComente EBOOK";

/** Conta do Instagram falsa (o token tem o padrão IGAA-TESTE para ser fácil de procurar). */
export async function seedAccount(db: TestDatabase, input: { username?: string; userId?: string; token?: string; isDefault?: boolean; expiresInDays?: number } = {}) {
  const [account] = await db.sql<{ id: string }>(
    `insert into public.instagram_accounts (instagram_access_token, instagram_user_id, instagram_username, instagram_name, is_default, token_expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
     returning id`,
    [
      input.token ?? "IGAA-TESTE-CONTA-A",
      input.userId ?? "17840000000000010",
      input.username ?? "conta_a",
      `Nome de ${input.username ?? "conta_a"}`,
      input.isDefault ?? true,
      input.expiresInDays ?? 50,
    ],
  );
  return account.id;
}

/** Post do planner direto no banco, já no estado que o teste precisa. */
export async function insertPost(db: TestDatabase, accountId: string, fields: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    account_id: accountId,
    publish_type: "reel_video",
    caption: LEGENDA,
    media_url: "https://midia.teste.invalid/uaiflow/reel.mp4",
    status: "scheduled",
    scheduled_at: new Date(Date.now() - 60_000),
    first_comment: "Primeiro comentário",
    keyword: "EBOOK",
    dm_text: "Aqui está o seu e-book",
    link_url: "https://loja.teste.invalid/ebook",
    ...fields,
  };
  const columns = Object.keys(row);
  const [post] = await db.sql<{ id: string }>(
    `insert into public.content_posts (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning id`,
    Object.values(row),
  );
  return post.id;
}

export async function readPost(db: TestDatabase, id: string) {
  const [post] = await db.sql<Record<string, unknown>>("select * from public.content_posts where id = $1", [id]);
  return post;
}
