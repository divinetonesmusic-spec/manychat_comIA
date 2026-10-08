import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta, type FakeCall } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Fase 5 · aviso de "feito com IA": o campo aiGenerated do pacote vira is_ai_generated no pedido à Meta
 * (no carrossel, só no container pai) e a Meta recusando nunca tira o aviso calado.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const FRASE_RECUSA = 'O Instagram não aceitou o aviso de "feito com IA" neste post. Tente de novo mais tarde ou desmarque o aviso e publique.';
const VIDEO = "https://midia.teste.invalid/uaiflow/reel.mp4";

/** Pedidos de criação de container (POST /{ig-user-id}/media). */
function criacoes(): FakeCall[] {
  return meta.calls.filter((call) => call.method === "POST" && /\/media$/.test(call.path));
}

describe("aviso de IA na publicação", { skip: semBanco }, () => {
  let db: TestDatabase;
  let accountId: string;
  let scheduler: typeof import("@/lib/content/scheduler");
  let moldeRoute: typeof import("@/app/api/molde/posts/route");
  let moldeIdRoute: typeof import("@/app/api/molde/posts/[id]/route");
  let contentRoute: typeof import("@/app/api/content/route");

  before(async () => {
    db = await createTestDatabase();
    scheduler = await import("@/lib/content/scheduler");
    moldeRoute = await import("@/app/api/molde/posts/route");
    moldeIdRoute = await import("@/app/api/molde/posts/[id]/route");
    contentRoute = await import("@/app/api/content/route");
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

  /** Manda o pacote como o Molde manda (já no horário) e devolve o post criado. */
  async function enviar(json: Record<string, unknown>) {
    const response = await moldeRoute.POST(request("/api/molde/posts", {
      headers: MOLDE,
      json: { externalRef: `item-${Math.random().toString(36).slice(2)}`, accountId, scheduledAt: new Date(Date.now() - 1000).toISOString(), ...json },
    }));
    const body = await response.json();
    assert.ok(body.data, JSON.stringify(body));
    return body.data as { id: string; aiGenerated: boolean; status: string };
  }

  async function ciclos(vezes = 4) {
    for (let i = 0; i < vezes; i += 1) await scheduler.runContentCycle(8000);
  }

  test("Reel com aiGenerated:true: o pedido à Meta leva is_ai_generated: true", async () => {
    const criado = await enviar({ publishType: "reel", mediaUrl: VIDEO, caption: "Reel com aviso", aiGenerated: true });
    assert.equal(criado.aiGenerated, true);
    await ciclos();
    const pedidos = criacoes();
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0].body.is_ai_generated, true);
    assert.equal(pedidos[0].body.media_type, "REELS");
    assert.equal((await readPost(db, criado.id)).status, "published");
  });

  test("sem o campo (ou falso): o corpo fica igual ao de hoje, sem is_ai_generated", async () => {
    await enviar({ publishType: "reel", mediaUrl: VIDEO, caption: "Reel sem aviso" });
    await enviar({ publishType: "reel", mediaUrl: VIDEO, caption: "Reel falso", aiGenerated: false });
    await ciclos(6);
    const pedidos = criacoes();
    assert.equal(pedidos.length, 2);
    for (const pedido of pedidos) {
      assert.equal("is_ai_generated" in pedido.body, false);
      assert.deepEqual(Object.keys(pedido.body).sort(), ["caption", "media_type", "share_to_feed", "video_url"]);
    }
  });

  test("carrossel com aiGenerated:true: filhos sem o campo, container pai com", async () => {
    const criado = await enviar({
      publishType: "carousel",
      mediaItems: [{ type: "image", url: "https://midia.teste.invalid/uaiflow/1.jpg" }, { type: "image", url: "https://midia.teste.invalid/uaiflow/2.jpg" }],
      caption: "Carrossel com aviso",
      aiGenerated: true,
    });
    await ciclos(6);
    const pedidos = criacoes();
    const filhos = pedidos.filter((pedido) => pedido.body.is_carousel_item === true);
    const pais = pedidos.filter((pedido) => pedido.body.media_type === "CAROUSEL");
    assert.equal(filhos.length, 2);
    assert.equal(pais.length, 1);
    for (const filho of filhos) assert.equal("is_ai_generated" in filho.body, false, "nos filhos o campo dá erro na Meta");
    assert.equal(pais[0].body.is_ai_generated, true);
    assert.equal((await readPost(db, criado.id)).status, "published");
  });

  test("carrossel sem aviso: nem o pai leva o campo", async () => {
    await enviar({
      publishType: "carousel",
      mediaItems: [{ type: "image", url: "https://midia.teste.invalid/uaiflow/1.jpg" }, { type: "image", url: "https://midia.teste.invalid/uaiflow/2.jpg" }],
    });
    await ciclos(6);
    assert.ok(criacoes().length >= 3);
    for (const pedido of criacoes()) assert.equal("is_ai_generated" in pedido.body, false);
  });

  test("story de foto com aiGenerated:true: STORIES com o campo; foto no feed também", async () => {
    await enviar({ publishType: "story_image", mediaUrl: "https://midia.teste.invalid/uaiflow/story.jpg", aiGenerated: true });
    await enviar({ publishType: "feed_image", mediaUrl: "https://midia.teste.invalid/uaiflow/foto.jpg", aiGenerated: true });
    await ciclos(6);
    const pedidos = criacoes();
    const story = pedidos.find((pedido) => pedido.body.media_type === "STORIES");
    const foto = pedidos.find((pedido) => pedido.body.image_url === "https://midia.teste.invalid/uaiflow/foto.jpg");
    assert.equal(story?.body.is_ai_generated, true);
    assert.equal(foto?.body.is_ai_generated, true);
  });

  test("a Meta recusa o aviso: o post falha com a frase, tenta uma vez só e nunca tira o aviso calado", async () => {
    meta.createMediaError = "(#100) Invalid parameter: is_ai_generated is not allowed for this account";
    const criado = await enviar({ publishType: "reel", mediaUrl: VIDEO, caption: "Reel recusado", aiGenerated: true });
    await ciclos(3);
    const post = await readPost(db, criado.id);
    assert.equal(post.status, "failed");
    assert.equal(post.last_error, FRASE_RECUSA);
    assert.equal(post.ai_generated, true, "o aviso continua marcado no post");
    assert.equal(criacoes().length, 1, "não tentou de novo sem o aviso");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("carrossel: a Meta aceita os itens mas recusa o aviso no container pai: o post falha com a frase (não fica tentando)", async () => {
    meta.rejectAiFlag = true;
    const criado = await enviar({
      publishType: "carousel",
      mediaItems: [{ type: "image", url: "https://midia.teste.invalid/uaiflow/1.jpg" }, { type: "image", url: "https://midia.teste.invalid/uaiflow/2.jpg" }],
      aiGenerated: true,
    });
    await ciclos(6);
    const post = await readPost(db, criado.id);
    assert.equal(post.status, "failed");
    assert.equal(post.last_error, FRASE_RECUSA);
    assert.equal(criacoes().filter((pedido) => pedido.body.media_type === "CAROUSEL").length, 1, "tentou o pai uma vez só");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("a 0006 cria a coluna e o índice e pode ser colada de novo", async () => {
    const colunas = await db.sql("select 1 from information_schema.columns where table_name = 'content_posts' and column_name = 'ai_generated'");
    assert.equal(colunas.length, 1);
    await db.sql(readFileSync("supabase/migrations/0006_fase5.sql", "utf8"));
    await db.sql(readFileSync("supabase/migrations/0006_fase5.sql", "utf8"));
    const indices = await db.sql("select 1 from pg_indexes where indexname = 'content_posts_published_window_idx'");
    assert.equal(indices.length, 1);
  });

  test("GET /api/molde/posts devolve aiGenerated (acréscimo; o resto do formato fica)", async () => {
    const [a, b] = [
      await enviar({ publishType: "reel", mediaUrl: VIDEO, aiGenerated: true, scheduledAt: new Date(Date.now() + 3600_000).toISOString(), externalRef: "com-aviso" }),
      await enviar({ publishType: "reel", mediaUrl: VIDEO, scheduledAt: new Date(Date.now() + 3600_000).toISOString(), externalRef: "sem-aviso" }),
    ];
    const response = await moldeRoute.GET(request("/api/molde/posts?refs=com-aviso,sem-aviso", { headers: MOLDE }));
    const { data } = (await response.json()) as { data: Array<Record<string, unknown>> };
    const porRef = new Map(data.map((post) => [post.externalRef, post]));
    assert.equal(porRef.get("com-aviso")?.aiGenerated, true);
    assert.equal(porRef.get("sem-aviso")?.aiGenerated, false);
    assert.equal(porRef.get("com-aviso")?.id, a.id);
    assert.equal(porRef.get("sem-aviso")?.id, b.id);
    for (const campo of ["id", "externalRef", "status", "scheduledAt", "permalink", "lastError", "keyword", "insights"]) assert.ok(campo in data[0], campo);
  });

  test("PATCH /api/molde/posts/[id] muda o campo, e uma edição sem ele não mexe", async () => {
    const criado = await enviar({ publishType: "reel", mediaUrl: VIDEO, scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    const patch = async (json: Record<string, unknown>) => {
      const response = await moldeIdRoute.PATCH(request(`/api/molde/posts/${criado.id}`, { method: "PATCH", headers: MOLDE, json }), routeParams({ id: criado.id }));
      return (await response.json()).data as { aiGenerated: boolean };
    };
    assert.equal((await patch({ aiGenerated: true })).aiGenerated, true);
    assert.equal((await readPost(db, criado.id)).ai_generated, true);
    assert.equal((await patch({ caption: "outra legenda" })).aiGenerated, true, "edição sem o campo mantém");
    assert.equal((await patch({ aiGenerated: false })).aiGenerated, false);
    assert.equal((await patch({ aiGenerated: "sim" })).aiGenerated, false, "outro tipo é ignorado");
  });

  test("com a 0006 colada não há warning (POST, PATCH e tela)", async () => {
    const molde = await moldeRoute.POST(request("/api/molde/posts", {
      headers: MOLDE,
      json: { externalRef: "com-0006", publishType: "reel", mediaUrl: VIDEO, aiGenerated: true, accountId, when: "draft" },
    }));
    const criado = await molde.json();
    assert.equal("warning" in criado, false);
    const patch = await moldeIdRoute.PATCH(request(`/api/molde/posts/${criado.data.id}`, { method: "PATCH", headers: MOLDE, json: { aiGenerated: false } }), routeParams({ id: criado.data.id }));
    assert.equal("warning" in (await patch.json()), false);
    const tela = await contentRoute.POST(request("/api/content", { json: { accountId, publishType: "reel_video", mediaUrl: VIDEO, aiGenerated: true, when: "draft" } }));
    assert.equal((await tela.json()).warning, undefined);
  });

  test("o Molde mandando o mesmo item de novo sem o campo não apaga o aviso", async () => {
    await enviar({ publishType: "reel", mediaUrl: VIDEO, externalRef: "mesmo-item", aiGenerated: true, scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    const segundo = await enviar({ publishType: "reel", mediaUrl: VIDEO, externalRef: "mesmo-item", caption: "texto novo", scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    assert.equal(segundo.aiGenerated, true);
  });

  test("a tela Conteúdo (POST /api/content) também grava o aviso, e o rascunho nasce sem ele", async () => {
    const response = await contentRoute.POST(request("/api/content", {
      json: { accountId, publishType: "reel_video", mediaUrl: VIDEO, caption: "Pela tela", aiGenerated: true, when: "draft" },
    }));
    const body = await response.json();
    assert.equal(body.data.ai_generated, true);
    const sem = await contentRoute.POST(request("/api/content", { json: { accountId, publishType: "reel_video", mediaUrl: VIDEO, when: "draft" } }));
    assert.equal((await sem.json()).data.ai_generated, false);
  });
});
