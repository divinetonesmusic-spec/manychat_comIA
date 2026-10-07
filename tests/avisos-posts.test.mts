import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/** Aviso no Telegram quando um post passa para "Com erro": 1 aviso por mudança, em qualquer caminho. */
const meta = installFakeMeta();
const HORA = 3600_000;

describe("aviso de post que não saiu", { skip: semBanco }, () => {
  let db: TestDatabase;
  let accountId: string;
  let scheduler: typeof import("@/lib/content/scheduler");
  let contentRoute: typeof import("@/app/api/content/route");
  let drainRoute: typeof import("@/app/api/queue/drain/route");

  before(async () => {
    db = await createTestDatabase();
    scheduler = await import("@/lib/content/scheduler");
    contentRoute = await import("@/app/api/content/route");
    drainRoute = await import("@/app/api/queue/drain/route");
  });

  beforeEach(async () => {
    meta.reset();
    process.env.TELEGRAM_BOT_TOKEN = "123456789:TESTE-token-falso-do-robo";
    process.env.TELEGRAM_CHAT_ID = "987654321";
    process.env.APP_BASE_URL = "https://uaiflow.teste";
    await db.sql("delete from public.content_posts");
    await db.sql("delete from public.automations");
    await db.sql("delete from public.instagram_accounts");
    accountId = await seedAccount(db, { username: "ruthie" });
  });

  after(async () => {
    meta.restore();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    await db?.close();
  });

  const textos = () => meta.telegram.map((aviso) => String(aviso.body.text));

  test("Meta recusa o vídeo (container ERROR): vira 'Com erro' e manda exatamente 1 aviso, mesmo com o relógio rodando de novo", async () => {
    const id = await insertPost(db, accountId, {
      title: "Antes do café",
      status: "publishing",
      container_id: "container-recusado",
      publishing_started_at: new Date(),
    });
    meta.containerStatus.set("container-recusado", "ERROR");
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);

    assert.equal((await readPost(db, id)).status, "failed");
    assert.equal(meta.telegram.length, 1, "1 aviso por mudança");
    const [texto] = textos();
    assert.match(texto, /^UaiFlow: o post "Antes do café" \(@ruthie\) não saiu\./);
    assert.match(texto, /\nMotivo: .+/);
    assert.match(texto, new RegExp(`\\nAbra: https://uaiflow\\.teste/conteudo\\?accountId=${accountId}$`));
  });

  test("post agendado que a Meta não aceita (criação do container falha): 1 aviso com o motivo traduzido", async () => {
    const id = await insertPost(db, accountId, { title: "Reel da manhã" });
    meta.createMediaError = "Invalid parameter: video_url download failed";
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);

    const post = await readPost(db, id);
    assert.equal(post.status, "failed");
    assert.equal(meta.telegram.length, 1);
    assert.match(textos()[0], /"Reel da manhã" \(@ruthie\)/);
    assert.match(textos()[0], /Motivo: A Meta nao conseguiu baixar a midia/);
  });

  test("Meta sem terminar em 2 h: 1 aviso", async () => {
    const id = await insertPost(db, accountId, {
      status: "publishing",
      container_id: "container-lento",
      publishing_started_at: new Date(Date.now() - 3 * HORA),
      scheduled_at: new Date(Date.now() - 3 * HORA),
    });
    meta.containerStatus.set("container-lento", "IN_PROGRESS");
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);

    assert.equal((await readPost(db, id)).status, "failed");
    assert.equal(meta.telegram.length, 1);
    assert.match(textos()[0], /Motivo: A Meta nao terminou de processar em 2 h/);
  });

  test("preso em 'publicando' depois de 3 tentativas (recuperação do relógio): 1 aviso", async () => {
    const id = await insertPost(db, accountId, {
      status: "publishing",
      attempts: 3,
      publishing_started_at: new Date(Date.now() - 20 * 60_000),
    });
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);

    assert.equal((await readPost(db, id)).status, "failed");
    assert.equal(meta.telegram.length, 1);
    assert.match(textos()[0], /Motivo: Nao consegui iniciar a publicacao depois de 3 tentativas\./);
  });

  test("carrossel com um item recusado pela Meta: 1 aviso", async () => {
    const id = await insertPost(db, accountId, {
      publish_type: "carousel",
      status: "publishing",
      publishing_started_at: new Date(),
      media_url: "https://midia.teste.invalid/uaiflow/1.jpg",
      media_items: JSON.stringify([
        { type: "image", url: "https://midia.teste.invalid/uaiflow/1.jpg", container_id: "item-ok", status: "processing" },
        { type: "image", url: "https://midia.teste.invalid/uaiflow/2.jpg", container_id: "item-ruim", status: "processing" },
      ]),
    });
    meta.containerStatus.set("item-ruim", "ERROR");
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);

    assert.equal((await readPost(db, id)).status, "failed");
    assert.equal(meta.telegram.length, 1);
    assert.match(textos()[0], /Motivo: Item 2/);
  });

  test("'Publicar agora' com a Meta recusando a mídia: o erro aparece na tela e 1 aviso no Telegram", async () => {
    meta.createMediaError = "Invalid parameter: video_url download failed";
    const response = await contentRoute.POST(request("/api/content", {
      json: { accountId, title: "Na hora", publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/quebrado.mp4", caption: "x", publishNow: true },
    }));
    assert.equal(response.status, 502);
    assert.equal(meta.telegram.length, 1);
    assert.match(textos()[0], /"Na hora" \(@ruthie\) não saiu/);
  });

  test("post publicado não gera aviso", async () => {
    const id = await insertPost(db, accountId);
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);
    assert.equal((await readPost(db, id)).status, "published");
    assert.equal(meta.telegram.length, 0);
  });

  test("um post que já estava 'Com erro' não gera outro aviso", async () => {
    const id = await insertPost(db, accountId, { status: "publishing", publishing_started_at: new Date() });
    const post = { id } as Parameters<typeof scheduler.markPostFailed>[0];
    await scheduler.markPostFailed(post, "Primeiro motivo");
    await scheduler.markPostFailed(post, "Segundo motivo");
    const atual = await readPost(db, id);
    assert.equal(atual.status, "failed");
    assert.equal(atual.last_error, "Segundo motivo", "o motivo continua sendo atualizado como antes");
    assert.equal(meta.telegram.length, 1);
  });

  test("dois relógios marcando o mesmo post ao mesmo tempo: 1 aviso só", async () => {
    const ids = await Promise.all([1, 2, 3].map(() => insertPost(db, accountId, { status: "publishing", publishing_started_at: new Date() })));
    for (const id of ids) {
      const post = { id } as Parameters<typeof scheduler.markPostFailed>[0];
      await Promise.all([scheduler.markPostFailed(post, "Motivo A"), scheduler.markPostFailed(post, "Motivo B")]);
    }
    assert.equal(meta.telegram.length, ids.length, "1 aviso por post");
  });

  test("Telegram fora do ar: o post vira 'Com erro' do mesmo jeito e o relógio não quebra", async () => {
    meta.telegramFails = "rede";
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-x", publishing_started_at: new Date() });
    meta.containerStatus.set("container-x", "ERROR");
    const silenciar = console.error;
    console.error = () => undefined;
    try {
      const result = await scheduler.runContentCycle(8000);
      assert.equal(result.failed, 1);
    } finally {
      console.error = silenciar;
    }
    assert.equal((await readPost(db, id)).status, "failed");
  });

  test("sem APP_BASE_URL, o aviso do relógio usa o endereço do pedido", async () => {
    delete process.env.APP_BASE_URL;
    await insertPost(db, accountId, { status: "publishing", container_id: "container-y", publishing_started_at: new Date() });
    meta.containerStatus.set("container-y", "ERROR");
    const response = await drainRoute.POST(new NextRequest("https://pedido.teste/api/queue/drain", {
      method: "POST",
      headers: { "x-worker-secret": process.env.WORKER_SECRET as string },
    }));
    assert.equal(response.status, 200);
    assert.equal(meta.telegram.length, 1);
    assert.match(textos()[0], new RegExp(`Abra: https://pedido\\.teste/conteudo\\?accountId=${accountId}$`));
  });
});
