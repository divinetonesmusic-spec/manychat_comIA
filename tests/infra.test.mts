import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, listMigrations, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";

describe("infraestrutura de testes", () => {
  test("o fetch falso recusa qualquer endereço de verdade", async () => {
    const meta = installFakeMeta();
    try {
      await assert.rejects(() => fetch("https://example.com/"), /Rede real bloqueada/);
      const response = await fetch("https://graph.instagram.com/v25.0/123/media", { method: "POST", body: JSON.stringify({ caption: "oi" }) });
      assert.equal(response.status, 200);
      assert.equal(meta.count("/media", "POST"), 1);
    } finally {
      meta.restore();
    }
  });
});

describe("migrações num banco limpo", { skip: semBanco }, () => {
  let db: TestDatabase;
  before(async () => {
    db = await createTestDatabase();
  });
  after(async () => {
    await db?.close();
  });

  test("todas as migrações aplicam em ordem e criam as tabelas principais", async () => {
    assert.ok(listMigrations().length >= 2);
    const rows = await db.sql<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('content_posts', 'instagram_accounts', 'queue') order by 1",
    );
    assert.deepEqual(rows.map((row) => row.table_name), ["content_posts", "instagram_accounts", "queue"]);
  });

  test("o app usa o banco de teste", async () => {
    const { query } = await import("@/lib/db/client");
    const { rows } = await query<{ db: string }>("select current_database() as db");
    assert.equal(rows[0].db, db.name);
  });
});
