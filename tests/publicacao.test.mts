import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta, metaTimestamp } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { insertPost, LEGENDA, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * U-PUB-01: o mesmo post nunca sai duas vezes no Instagram, nem quando o Netlify corta a função
 * depois de a Meta publicar, nem no "Tentar de novo", nem no "Publicar agora".
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const AVISO_SEM_CONFERIR = "Não consegui conferir no Instagram se este post já saiu, então não publiquei de novo. Tente de novo em alguns minutos.";

describe("publicação segura (U-PUB-01, com a migração 0003)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let accountId: string;
  let scheduler: typeof import("@/lib/content/scheduler");
  let planner: typeof import("@/lib/db/content-planner");
  let repositories: typeof import("@/lib/db/repositories");
  let contentRoute: typeof import("@/app/api/content/route");
  let contentIdRoute: typeof import("@/app/api/content/[id]/route");
  let moldeRoute: typeof import("@/app/api/molde/posts/route");

  before(async () => {
    db = await createTestDatabase();
    scheduler = await import("@/lib/content/scheduler");
    planner = await import("@/lib/db/content-planner");
    repositories = await import("@/lib/db/repositories");
    contentRoute = await import("@/app/api/content/route");
    contentIdRoute = await import("@/app/api/content/[id]/route");
    moldeRoute = await import("@/app/api/molde/posts/route");
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

  test("a migração 0003 cria a coluna publish_requested_at", async () => {
    const rows = await db.sql("select 1 from information_schema.columns where table_name = 'content_posts' and column_name = 'publish_requested_at'");
    assert.equal(rows.length, 1);
  });

  test("(c) caminho normal: publica 1 vez, faz o 1º comentário e liga a automação", async () => {
    const id = await insertPost(db, accountId);
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);

    const post = await readPost(db, id);
    assert.equal(meta.count("/media_publish"), 1);
    assert.equal(post.status, "published");
    assert.equal(post.published_media_id, meta.feed[0].id);
    assert.ok(post.permalink);
    assert.ok(post.publish_requested_at, "grava a hora do pedido antes de chamar o media_publish");
    assert.ok(post.first_comment_id, "1º comentário feito");
    assert.ok(post.automation_id, "automação da palavra ligada");
  });

  test("(c) carrossel continua publicando 1 vez", async () => {
    const id = await insertPost(db, accountId, {
      publish_type: "carousel",
      media_url: "https://midia.teste.invalid/uaiflow/1.jpg",
      media_items: JSON.stringify([
        { type: "image", url: "https://midia.teste.invalid/uaiflow/1.jpg", status: "pending" },
        { type: "image", url: "https://midia.teste.invalid/uaiflow/2.jpg", status: "pending" },
      ]),
    });
    for (let round = 0; round < 4; round += 1) await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(post.status, "published", String(post.last_error));
    assert.equal(meta.count("/media_publish"), 1);
    assert.equal(post.published_media_id, meta.feed[0].id);
  });

  test("(a) corte do Netlify depois de a Meta publicar: vira publicado com o id certo e o media_publish não é chamado de novo", async () => {
    const id = await insertPost(db, accountId);
    meta.cutAfterPublish = true;
    await scheduler.runContentCycle(8000);
    assert.equal(meta.count("/media_publish"), 1);
    let post = await readPost(db, id);
    assert.equal(post.status, "publishing", "o corte deixou o post em 'publicando'");
    assert.ok(post.publish_requested_at);

    meta.cutAfterPublish = false;
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);
    post = await readPost(db, id);
    assert.equal(meta.count("/media_publish"), 1, "nenhuma chamada a mais ao media_publish");
    assert.equal(post.status, "published");
    assert.equal(post.published_media_id, meta.feed[0].id);
    assert.equal(post.permalink, meta.feed[0].permalink);
    assert.ok(post.first_comment_id);
    assert.ok(post.automation_id);
    const automations = await db.sql<{ post_id: string }>("select post_id from public.automations");
    assert.deepEqual(automations.map((row) => row.post_id), [meta.feed[0].id]);
  });

  test("(a) container PUBLISHED de um corte antigo (sem registro do pedido): vira publicado, sem publicar de novo", async () => {
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-legado", publishing_started_at: new Date(Date.now() - 5 * 60_000) });
    meta.containerStatus.set("container-legado", "PUBLISHED");
    meta.feed.push({ id: "media-legado", caption: LEGENDA, timestamp: metaTimestamp(new Date(Date.now() - 4 * 60_000)), permalink: "https://www.instagram.com/reel/legado/" });

    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(meta.count("/media_publish"), 0);
    assert.equal(post.status, "published");
    assert.equal(post.published_media_id, "media-legado");
    assert.equal(post.permalink, "https://www.instagram.com/reel/legado/");
  });

  test("container PUBLISHED há mais de 2 h também é sucesso (antes virava 'Com erro')", async () => {
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-velho", publishing_started_at: new Date(Date.now() - 3 * 3600_000) });
    meta.containerStatus.set("container-velho", "PUBLISHED");
    meta.feed.push({ id: "media-velho", caption: LEGENDA, timestamp: metaTimestamp(new Date(Date.now() - 3 * 3600_000 + 60_000)), permalink: "https://www.instagram.com/reel/velho/" });

    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(post.status, "published");
    assert.equal(post.published_media_id, "media-velho");
  });

  test("container PUBLISHED sem a mídia no feed: marca publicado sem link, com nota, e nunca publica de novo", async () => {
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-sem-feed", publishing_started_at: new Date() });
    meta.containerStatus.set("container-sem-feed", "PUBLISHED");

    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(meta.count("/media_publish"), 0);
    assert.equal(post.status, "published");
    assert.equal(post.published_media_id, null);
    assert.equal(post.last_error, "Publicado; não consegui buscar o link");
    assert.equal((await db.sql("select 1 from public.automations")).length, 0, "sem o id da mídia, não cria automação solta");
  });

  test("pedido registrado e container ainda FINISHED, mas a mídia já está no feed: vira publicado sem chamar o media_publish", async () => {
    const requestedAt = new Date(Date.now() - 2 * 60_000);
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-lento", publishing_started_at: requestedAt, publish_requested_at: requestedAt });
    meta.feed.push({ id: "media-lento", caption: LEGENDA, timestamp: metaTimestamp(new Date()), permalink: "https://www.instagram.com/reel/lento/" });

    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(meta.count("/media_publish"), 0);
    assert.equal(post.status, "published");
    assert.equal(post.published_media_id, "media-lento");
  });

  test("pedido registrado, container FINISHED e nada no feed: espera 3 min (a Meta pode ter recebido) e só então pede de novo (1 vez)", async () => {
    // Rodada 1, achado 2: um media_publish cortado solta a trava na hora; com a tela Conteúdo aberta, o ciclo
    // leve roda a cada 20 s. Antes de 3 min do pedido, nunca pede de novo.
    const requestedAt = new Date(Date.now() - 30_000);
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-refazer", publishing_started_at: new Date(Date.now() - 5 * 60_000), publish_requested_at: requestedAt });

    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(3500, { light: true });
    assert.equal(meta.count("/media_publish"), 0, "pedido há 30 s: não pede de novo");
    assert.equal((await readPost(db, id)).status, "publishing");

    await db.sql("update public.content_posts set publish_requested_at = now() - interval '4 minutes' where id = $1", [id]);
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(meta.count("/media_publish"), 1, "pedido há 4 min e nada no feed: pede de novo 1 vez");
    assert.equal(post.status, "published");
  });

  test("container PUBLISHED com o feed fora do ar: continua 'publicando' sem publicar de novo; quando o feed volta, publicado com id, 1º comentário e automação", async () => {
    // Rodada 1, achado 1: antes virava publicado sem id e perdia 1º comentário, automação e resultados.
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-feed-caiu", publishing_started_at: new Date(Date.now() - 5 * 60_000) });
    meta.containerStatus.set("container-feed-caiu", "PUBLISHED");
    meta.feed.push({ id: "media-feed-caiu", caption: LEGENDA, timestamp: metaTimestamp(new Date(Date.now() - 60_000)), permalink: "https://www.instagram.com/reel/feed-caiu/" });
    meta.feedFails = true;

    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);
    let post = await readPost(db, id);
    assert.equal(post.status, "publishing");
    assert.equal(post.published_media_id, null);
    assert.equal(post.last_error, "A Meta publicou. Buscando o link do post.", "nota clara enquanto espera");
    assert.equal(meta.count("/media_publish"), 0);

    meta.feedFails = false;
    await scheduler.runContentCycle(8000);
    post = await readPost(db, id);
    assert.equal(post.status, "published");
    assert.equal(post.published_media_id, "media-feed-caiu");
    assert.ok(post.first_comment_id, "1º comentário feito");
    assert.ok(post.automation_id, "automação ligada");
    assert.equal(post.last_error, null);
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("container PUBLISHED com pedido recente e o post ainda fora do feed: espera alguns minutos antes de desistir do link", async () => {
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-atraso", publishing_started_at: new Date(Date.now() - 5 * 60_000), publish_requested_at: new Date(Date.now() - 60_000) });
    meta.containerStatus.set("container-atraso", "PUBLISHED");

    await scheduler.runContentCycle(8000);
    assert.equal((await readPost(db, id)).status, "publishing", "pedido há 1 min: o feed pode estar atrasado");

    await db.sql("update public.content_posts set publish_requested_at = now() - interval '4 minutes' where id = $1", [id]);
    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(post.status, "published");
    assert.equal(post.last_error, "Publicado; não consegui buscar o link");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("container PUBLISHED há mais de 2 h com o feed fora do ar: marca publicado sem link (não fica preso)", async () => {
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-velho-sem-feed", publishing_started_at: new Date(Date.now() - 3 * 3600_000) });
    meta.containerStatus.set("container-velho-sem-feed", "PUBLISHED");
    meta.feedFails = true;

    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(post.status, "published");
    assert.equal(post.last_error, "Publicado; não consegui buscar o link");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("pedido registrado e o feed não responde: não arrisca, espera o próximo relógio", async () => {
    const requestedAt = new Date(Date.now() - 2 * 60_000);
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-duvida", publishing_started_at: requestedAt, publish_requested_at: requestedAt });
    meta.feedFails = true;

    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(meta.count("/media_publish"), 0);
    assert.equal(post.status, "publishing");
  });

  test("relê o post depois de pegar a trava: um retrato velho não publica um post que já saiu", async () => {
    const id = await insertPost(db, accountId, { status: "publishing", container_id: "container-retrato", publishing_started_at: new Date() });
    const snapshot = await planner.getContentPost(id);
    await db.sql("update public.content_posts set status = 'published', published_media_id = 'media-outro-relogio', published_at = now() where id = $1", [id]);

    const config = await repositories.getConfig(accountId);
    const result = await scheduler.advancePost(snapshot!, config);
    assert.equal(result, "waiting");
    assert.equal(meta.count("/media_publish"), 0);
    assert.equal((await readPost(db, id)).published_media_id, "media-outro-relogio");
  });

  test("(b) 'Tentar de novo' num post com erro cujo container já foi publicado: confere antes e não publica de novo", async () => {
    const id = await insertPost(db, accountId, {
      status: "failed",
      container_id: "container-erro",
      publishing_started_at: new Date(Date.now() - 3 * 3600_000),
      last_error: "A Meta nao terminou de processar em 2 h. Tente agendar de novo.",
    });
    meta.containerStatus.set("container-erro", "PUBLISHED");
    meta.feed.push({ id: "media-erro", caption: LEGENDA, timestamp: metaTimestamp(new Date(Date.now() - 3 * 3600_000 + 30_000)), permalink: "https://www.instagram.com/reel/erro/" });

    const response = await contentIdRoute.PATCH(request(`/api/content/${id}`, { method: "PATCH", json: { action: "retry" } }), routeParams({ id }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, "published");
    assert.equal(body.data.published_media_id, "media-erro");
    assert.equal(meta.count("/media_publish"), 0);
    assert.equal(meta.count("/media", "POST"), 0, "nem cria container novo");
  });

  test("(b) 'Tentar de novo' com pedido de publicação registrado: confere o feed e não publica de novo", async () => {
    const requestedAt = new Date(Date.now() - 3 * 3600_000);
    const id = await insertPost(db, accountId, { status: "failed", container_id: "container-x", publish_requested_at: requestedAt, publishing_started_at: requestedAt });
    meta.containerStatus.set("container-x", "EXPIRED");
    meta.feed.push({ id: "media-x", caption: LEGENDA, timestamp: metaTimestamp(new Date(requestedAt.getTime() + 20_000)), permalink: "https://www.instagram.com/reel/x/" });

    const response = await contentIdRoute.PATCH(request(`/api/content/${id}`, { method: "PATCH", json: { action: "retry" } }), routeParams({ id }));
    const body = await response.json();
    assert.equal(body.data.status, "published");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("(b) 'Tentar de novo' quando não dá para conferir no Instagram: recusa com aviso em português e não mexe no post", async () => {
    const requestedAt = new Date(Date.now() - 3 * 3600_000);
    const id = await insertPost(db, accountId, { status: "failed", container_id: "container-y", publish_requested_at: requestedAt, publishing_started_at: requestedAt, last_error: "erro antigo" });
    meta.feedFails = true;
    meta.containerStatus.set("container-y", "FINISHED");

    const response = await contentIdRoute.PATCH(request(`/api/content/${id}`, { method: "PATCH", json: { action: "retry" } }), routeParams({ id }));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.error, AVISO_SEM_CONFERIR, "mensagem só em português, sem detalhe técnico entre parênteses");
    assert.equal(meta.count("/media_publish"), 0);
    assert.equal((await readPost(db, id)).status, "failed");
  });

  test("(b) 'Tentar de novo' com container PUBLISHED e o feed fora do ar: recusa (tente em alguns minutos) em vez de marcar publicado sem id", async () => {
    // Rodada 1, achado 1 (lado do confirmEarlierPublish).
    const id = await insertPost(db, accountId, { status: "failed", container_id: "container-w", publishing_started_at: new Date(Date.now() - 3 * 3600_000), last_error: "erro antigo" });
    meta.containerStatus.set("container-w", "PUBLISHED");
    meta.feedFails = true;

    const response = await contentIdRoute.PATCH(request(`/api/content/${id}`, { method: "PATCH", json: { action: "retry" } }), routeParams({ id }));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.error, AVISO_SEM_CONFERIR);
    const post = await readPost(db, id);
    assert.equal(post.status, "failed");
    assert.equal(post.published_media_id, null);
    assert.equal(meta.count("/media_publish"), 0);
    assert.equal(meta.count("/media", "POST"), 0);
  });

  test("(b) 'Tentar de novo' sem Instagram conectado e com container antigo: mesma recusa em português", async () => {
    const id = await insertPost(db, accountId, { status: "failed", container_id: "container-v", publishing_started_at: new Date(Date.now() - 3 * 3600_000) });
    const contas = await import("@/lib/db/content-planner");
    const post = await contas.getContentPost(id);
    await db.sql("update public.instagram_accounts set instagram_access_token = '' where id = $1", [accountId]);
    const { ContentError, editPost } = await import("@/lib/content/service");
    await assert.rejects(() => editPost(post!.id, {}, false), (error: unknown) => error instanceof ContentError && error.message === AVISO_SEM_CONFERIR);
  });

  test("'Tentar de novo' de um post que de fato não saiu continua funcionando (volta para a fila, sem publicar na requisição)", async () => {
    const id = await insertPost(db, accountId, { status: "failed", container_id: "container-z", publishing_started_at: new Date(Date.now() - 3 * 3600_000) });
    meta.containerStatus.set("container-z", "ERROR");

    const response = await contentIdRoute.PATCH(request(`/api/content/${id}`, { method: "PATCH", json: { action: "retry" } }), routeParams({ id }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, "publishing");
    assert.equal(meta.count("/media_publish"), 0);

    await scheduler.runContentCycle(8000);
    assert.equal(meta.count("/media_publish"), 1);
    assert.equal((await readPost(db, id)).status, "published");
  });

  test("(b) Molde manda de novo um item com erro que na verdade saiu: devolve publicado, sem publicar de novo", async () => {
    const id = await insertPost(db, accountId, { status: "failed", container_id: "container-molde", source: "molde", external_ref: "reel-42", publishing_started_at: new Date(Date.now() - 3 * 3600_000) });
    meta.containerStatus.set("container-molde", "PUBLISHED");
    meta.feed.push({ id: "media-molde", caption: LEGENDA, timestamp: metaTimestamp(new Date(Date.now() - 3 * 3600_000 + 60_000)), permalink: "https://www.instagram.com/reel/molde/" });

    const response = await moldeRoute.POST(request("/api/molde/posts", {
      headers: MOLDE,
      json: { externalRef: "reel-42", publishType: "reel", mediaUrl: "https://midia.teste.invalid/uaiflow/reel.mp4", caption: LEGENDA, publishNow: true, accountId },
    }));
    const body = await response.json();
    assert.equal(body.data.id, id);
    assert.equal(body.data.status, "published");
    assert.equal(body.data.permalink, "https://www.instagram.com/reel/molde/");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("(d) 'Publicar agora' na tela Conteúdo: responde rápido, não chama o media_publish e diz 'Vai ao ar em até 2 minutos'", async () => {
    const response = await contentRoute.POST(request("/api/content", {
      json: { accountId, publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/novo.mp4", caption: "Reel novo", publishNow: true },
    }));
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.data.status, "publishing");
    assert.match(body.warning, /Vai ao ar em até 2 minutos/);
    assert.equal(meta.count("/media_publish"), 0, "a requisição não publica");
    assert.equal(meta.count("/media", "POST"), 1, "só cria o container (passo rápido)");
    assert.equal(body.data.lock_until, null, "solta a trava para o relógio");

    await scheduler.runContentCycle(8000);
    const post = await readPost(db, body.data.id);
    assert.equal(post.status, "published");
    assert.equal(meta.count("/media_publish"), 1);
  });

  test("(d) 'Publicar agora' pelo Molde: não publica na requisição e avisa em data.notice (campo novo)", async () => {
    const response = await moldeRoute.POST(request("/api/molde/posts", {
      headers: MOLDE,
      json: { externalRef: "reel-novo", publishType: "reel", mediaUrl: "https://midia.teste.invalid/uaiflow/novo.mp4", caption: "Reel do Molde", publishNow: true, accountId },
    }));
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.created, true);
    assert.equal(body.data.status, "publishing");
    assert.equal(body.data.notice, "Vai ao ar em até 2 minutos.");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("'Publicar agora' com a Meta recusando a mídia: mostra o erro na hora", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith("/media") && (init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({ error: { message: "Invalid parameter: video_url download failed" } }), { status: 400 });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const response = await contentRoute.POST(request("/api/content", {
        json: { accountId, publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/quebrado.mp4", caption: "x", publishNow: true },
      }));
      const body = await response.json();
      assert.equal(response.status, 502);
      assert.equal(body.data.status, "failed");
      assert.match(body.data.last_error, /baixar a mídia/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
