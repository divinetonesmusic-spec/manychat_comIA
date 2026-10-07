import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta, metaTimestamp } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { insertPost, LEGENDA, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Supabase em que a 0003 ainda não foi colada: o código novo não pode quebrar.
 * Cai no comportamento antigo, mas já reconhece o container PUBLISHED.
 */
const meta = installFakeMeta();

describe("publicação sem a migração 0003 aplicada", { skip: semBanco }, () => {
  let db: TestDatabase;
  let accountId: string;
  let scheduler: typeof import("@/lib/content/scheduler");
  let contentRoute: typeof import("@/app/api/content/route");
  let contentIdRoute: typeof import("@/app/api/content/[id]/route");

  before(async () => {
    db = await createTestDatabase({ ate: "0002" });
    scheduler = await import("@/lib/content/scheduler");
    contentRoute = await import("@/app/api/content/route");
    contentIdRoute = await import("@/app/api/content/[id]/route");
  });

  beforeEach(async () => {
    meta.reset();
    await db.sql("delete from public.instagram_accounts");
    accountId = await seedAccount(db);
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  test("o banco de teste está mesmo sem a coluna nova", async () => {
    const rows = await db.sql("select 1 from information_schema.columns where table_name = 'content_posts' and column_name = 'publish_requested_at'");
    assert.equal(rows.length, 0);
  });

  test("caminho normal publica 1 vez, sem erro de coluna", async () => {
    const id = await insertPost(db, accountId);
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(post.status, "published", String(post.last_error));
    assert.equal(meta.count("/media_publish"), 1);
    assert.ok(post.first_comment_id);
  });

  test("container PUBLISHED depois de um corte vira publicado, sem publicar de novo", async () => {
    const id = await insertPost(db, accountId);
    meta.cutAfterPublish = true;
    await scheduler.runContentCycle(8000);
    meta.cutAfterPublish = false;
    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(meta.count("/media_publish"), 1);
    assert.equal(post.status, "published");
    assert.equal(post.published_media_id, meta.feed[0].id);
  });

  test("'Tentar de novo' num post com erro cujo container já saiu: não publica de novo", async () => {
    const id = await insertPost(db, accountId, { status: "failed", container_id: "container-antigo", publishing_started_at: new Date(Date.now() - 3 * 3600_000) });
    meta.containerStatus.set("container-antigo", "PUBLISHED");
    meta.feed.push({ id: "media-antigo", caption: LEGENDA, timestamp: metaTimestamp(new Date(Date.now() - 3 * 3600_000 + 60_000)), permalink: "https://www.instagram.com/reel/antigo/" });

    const response = await contentIdRoute.PATCH(request(`/api/content/${id}`, { method: "PATCH", json: { action: "retry" } }), routeParams({ id }));
    const body = await response.json();
    assert.equal(body.data.status, "published");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("'Publicar agora' não chama o media_publish na requisição", async () => {
    const response = await contentRoute.POST(request("/api/content", {
      json: { accountId, publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/novo.mp4", caption: "Reel novo", publishNow: true },
    }));
    const body = await response.json();
    assert.equal(body.data.status, "publishing");
    assert.equal(meta.count("/media_publish"), 0);
  });
});
