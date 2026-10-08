import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/** Story não tem comentário nem palavra-chave: publicado, nada de 1º comentário nem automação, e nada de tentar de novo. */
const meta = installFakeMeta();

describe("stories publicados", { skip: semBanco }, () => {
  let db: TestDatabase;
  let accountId: string;
  let scheduler: typeof import("@/lib/content/scheduler");

  before(async () => {
    db = await createTestDatabase();
    scheduler = await import("@/lib/content/scheduler");
  });

  beforeEach(async () => {
    meta.reset();
    await db.sql("delete from public.content_posts");
    await db.sql("delete from public.automations");
    await db.sql("delete from public.instagram_accounts");
    accountId = await seedAccount(db);
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  for (const tipo of ["story_image", "story_video"] as const) {
    test(`${tipo}: publica e faz 0 chamadas de comentário, mesmo vindo com 1º comentário e palavra-chave`, async () => {
      const id = await insertPost(db, accountId, {
        publish_type: tipo,
        media_url: tipo === "story_image" ? "https://midia.teste.invalid/uaiflow/story.jpg" : "https://midia.teste.invalid/uaiflow/story.mp4",
        first_comment: "Comenta aqui",
        keyword: "EBOOK",
        dm_text: "Oi",
      });
      for (let i = 0; i < 6; i += 1) await scheduler.runContentCycle(8000);
      const post = await readPost(db, id);
      assert.equal(post.status, "published", String(post.last_error));
      assert.equal(meta.count("/media_publish"), 1);
      assert.equal(meta.count("/comments"), 0, "story não tem comentário");
      assert.equal(post.first_comment_id, null);
      assert.equal(post.automation_id, null);
      assert.equal((await db.sql("select 1 from public.automations")).length, 0);
    });
  }

  test("o Reel ao lado continua com 1º comentário e automação", async () => {
    const id = await insertPost(db, accountId);
    for (let i = 0; i < 4; i += 1) await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(meta.count("/comments"), 1);
    assert.ok(post.first_comment_id);
    assert.ok(post.automation_id);
  });
});
