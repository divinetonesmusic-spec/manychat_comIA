import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Supabase em que a 0006 ainda não foi colada (sem a coluna ai_generated): nada quebra.
 * O post é criado, lido e publicado; sem a 0006 o aviso de IA não vai para a Meta.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };

describe("aviso de IA sem a migração 0006 aplicada", { skip: semBanco }, () => {
  let db: TestDatabase;
  let accountId: string;
  let scheduler: typeof import("@/lib/content/scheduler");
  let moldeRoute: typeof import("@/app/api/molde/posts/route");
  let moldeIdRoute: typeof import("@/app/api/molde/posts/[id]/route");
  let contentRoute: typeof import("@/app/api/content/route");

  before(async () => {
    db = await createTestDatabase({ ate: "0005" });
    scheduler = await import("@/lib/content/scheduler");
    moldeRoute = await import("@/app/api/molde/posts/route");
    moldeIdRoute = await import("@/app/api/molde/posts/[id]/route");
    contentRoute = await import("@/app/api/content/route");
  });

  beforeEach(async () => {
    meta.reset();
    await db.sql("delete from public.content_posts");
    await db.sql("delete from public.instagram_accounts");
    accountId = await seedAccount(db);
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  test("o banco de teste está mesmo sem a coluna nova", async () => {
    const rows = await db.sql("select 1 from information_schema.columns where table_name = 'content_posts' and column_name = 'ai_generated'");
    assert.equal(rows.length, 0);
  });

  test("criar e publicar com aiGenerated:true funciona; sem a coluna o pedido à Meta vai sem o campo", async () => {
    const response = await moldeRoute.POST(request("/api/molde/posts", {
      headers: MOLDE,
      json: { externalRef: "reel-sem-0006", publishType: "reel", mediaUrl: "https://midia.teste.invalid/uaiflow/reel.mp4", caption: "Reel", aiGenerated: true, accountId, scheduledAt: new Date(Date.now() - 1000).toISOString() },
    }));
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.data.aiGenerated, false, "sem a coluna, lido ausente = falso");

    for (let i = 0; i < 4; i += 1) await scheduler.runContentCycle(8000);
    const pedidos = meta.calls.filter((call) => call.method === "POST" && /\/media$/.test(call.path));
    assert.equal(pedidos.length, 1);
    assert.equal("is_ai_generated" in pedidos[0].body, false);
    const post = await readPost(db, body.data.id);
    assert.equal(post.status, "published", String(post.last_error));
    assert.equal(meta.count("/media_publish"), 1);
  });

  test("editar (PATCH) com aiGenerated e a tela Conteúdo não quebram sem a coluna", async () => {
    const id = await insertPost(db, accountId, { source: "molde", external_ref: "item-1", status: "draft", scheduled_at: null });
    const patch = await moldeIdRoute.PATCH(request(`/api/molde/posts/${id}`, { method: "PATCH", headers: MOLDE, json: { aiGenerated: true, caption: "Editada" } }), { params: Promise.resolve({ id }) });
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).data.aiGenerated, false);
    assert.equal((await readPost(db, id)).caption, "Editada");

    const tela = await contentRoute.POST(request("/api/content", {
      json: { accountId, publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/reel.mp4", aiGenerated: true, when: "draft" },
    }));
    assert.equal(tela.status, 200);
    const criado = (await tela.json()).data;
    assert.equal(criado.status, "draft");
    assert.ok(!criado.ai_generated);
  });

  test("carrossel sem a coluna: publica sem o campo no pai", async () => {
    const id = await insertPost(db, accountId, {
      publish_type: "carousel",
      media_url: "https://midia.teste.invalid/uaiflow/1.jpg",
      media_items: JSON.stringify([
        { type: "image", url: "https://midia.teste.invalid/uaiflow/1.jpg", status: "pending" },
        { type: "image", url: "https://midia.teste.invalid/uaiflow/2.jpg", status: "pending" },
      ]),
    });
    for (let i = 0; i < 6; i += 1) await scheduler.runContentCycle(8000);
    assert.equal((await readPost(db, id)).status, "published");
    for (const pedido of meta.calls.filter((call) => call.method === "POST" && /\/media$/.test(call.path))) assert.equal("is_ai_generated" in pedido.body, false);
  });
});
