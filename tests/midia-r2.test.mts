import "./helpers/env.mjs";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Fase 6 · R2: o link de envio impõe o tamanho do arquivo (content-length assinado) e a mídia de rascunho ou de post
 * com erro parado há mais de 14 dias sai do R2 (o post fica, pedindo mídia nova).
 */
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const r2 = await import("@/lib/content/r2");
const R2 = process.env.R2_PUBLIC_BASE_URL as string;

after(async () => {
  meta.restore();
  await db?.close();
});

describe("link de envio para o R2", () => {
  // Vetores conferidos com o botocore (a biblioteca oficial da AWS em Python), na mesma data e com as mesmas chaves falsas.
  const base = {
    method: "PUT" as const,
    host: "contafalsa.r2.cloudflarestorage.com",
    path: "/baldefalso/uaiflow/conteudo/2026-10/abc-v%C3%ADdeo.mp4",
    region: "auto",
    service: "s3",
    accessKeyId: "chavefalsa",
    secretAccessKey: "segredofalso",
    expiresSeconds: 3600,
    now: new Date("2026-10-11T17:03:11Z"),
  };

  test("assinatura igual à da AWS (só o host) e com o tamanho assinado (content-length)", () => {
    const soHost = new URL(r2.presignUrl(base));
    assert.equal(soHost.searchParams.get("X-Amz-SignedHeaders"), "host");
    assert.equal(soHost.searchParams.get("X-Amz-Signature"), "bb14859509b34e5a6382d2136ff1b46e3f1e2cde865729c37997e28f2081e472");

    const comTamanho = new URL(r2.presignUrl({ ...base, headers: { "Content-Length": "1234" } }));
    assert.equal(comTamanho.searchParams.get("X-Amz-SignedHeaders"), "content-length;host");
    assert.equal(comTamanho.searchParams.get("X-Amz-Signature"), "dc742ff1bd39ddda8e9ce4237af2cea3fdffb94fcfd705f1d81ebc2300ad4e6d");
  });

  test("createUploadTarget: o tamanho é obrigatório e vai na assinatura", () => {
    const alvo = r2.createUploadTarget({ fileName: "Reel Final.mp4", contentType: "video/mp4", size: 5_000_000 });
    const url = new URL(alvo.uploadUrl);
    assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;host");
    assert.equal(alvo.size, 5_000_000);
    assert.throws(() => r2.createUploadTarget({ fileName: "a.mp4", contentType: "video/mp4" }), /Falta o tamanho do arquivo/);
    assert.throws(() => r2.createUploadTarget({ fileName: "a.mp4", contentType: "video/mp4", size: 0 }), /Falta o tamanho do arquivo/);
    assert.throws(() => r2.createUploadTarget({ fileName: "a.mp4", contentType: "video/mp4", size: 1.5 }), /Falta o tamanho do arquivo/);
    assert.throws(() => r2.createUploadTarget({ fileName: "a.mp4", contentType: "video/mp4", size: r2.MAX_UPLOAD_BYTES + 1 }), /grande demais/);
  });

  test("as rotas de envio (tela e Molde) recusam sem o tamanho, com a frase", async () => {
    const tela = await import("@/app/api/uploads/presign/route");
    const semTamanho = await tela.POST(request("/api/uploads/presign", { json: { fileName: "a.mp4", contentType: "video/mp4" } }));
    assert.equal(semTamanho.status, 400);
    assert.match((await semTamanho.json()).error, /Falta o tamanho do arquivo/);
    const comTamanho = await tela.POST(request("/api/uploads/presign", { json: { fileName: "a.mp4", contentType: "video/mp4", size: 10 } }));
    assert.equal(comTamanho.status, 200);

    const molde = await import("@/app/api/molde/upload/route");
    const headers = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
    assert.equal((await molde.POST(request("/api/molde/upload", { json: { fileName: "a.mp4", contentType: "video/mp4" }, headers }))).status, 400);
    const ok = await molde.POST(request("/api/molde/upload", { json: { fileName: "a.mp4", contentType: "video/mp4", size: 99 }, headers }));
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).data.uploadUrl, /X-Amz-SignedHeaders=content-length%3Bhost/);
  });
});

describe("tela: post sem mídia", () => {
  test("rascunho com a mídia apagada mostra 'Precisa de mídia nova' e o formulário abre sem o link antigo", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const tela = await import("@/app/conteudo/conteudo-client");
    const base = { account_id: "a", account_username: "c", publish_type: "reel_video", caption: "x", media_url: `${R2}/uaiflow/a.mp4`, cover_url: null, media_items: [], media_keys: ["uaiflow/a.mp4"], container_id: null, published_media_id: null, permalink: null, published_at: null, created_at: "2026-10-07T12:00:00Z", updated_at: "2026-10-07T12:00:00Z", scheduled_at: null };
    const apagada = { ...base, id: "p1", title: "Sem mídia", status: "draft", last_error: "A mídia foi apagada", media_deleted_at: "2026-10-08T12:00:00Z" };
    const normal = { ...base, id: "p2", title: "Com mídia", status: "draft", last_error: null, media_deleted_at: null };
    const html = renderToStaticMarkup(createElement(tela.PostList, { posts: [apagada, normal] as never, onOpenPost: () => undefined }));
    assert.equal(html.split("Precisa de mídia nova").length - 1, 1);
    assert.equal(tela.needsNewMedia({ status: "published", media_deleted_at: "2026-10-08T12:00:00Z" }), false, "publicado sem mídia não precisa de nada");
    const rascunho = tela.draftFromPost(apagada as never);
    assert.equal(rascunho.mediaUrl, "");
    assert.deepEqual(rascunho.mediaKeys, []);
    assert.equal(tela.draftFromPost(normal as never).mediaUrl, `${R2}/uaiflow/a.mp4`);
  });
});

describe("mídia de rascunho ou de post com erro parado há 14 dias", { skip: semBanco }, () => {
  let scheduler: typeof import("@/lib/content/scheduler");
  let planner: typeof import("@/lib/db/content-planner");
  let service: typeof import("@/lib/content/service");
  let conta: string;

  beforeEach(async () => {
    scheduler = await import("@/lib/content/scheduler");
    planner = await import("@/lib/db/content-planner");
    service = await import("@/lib/content/service");
    meta.reset();
    await db!.sql("delete from public.content_posts");
    await db!.sql("delete from public.instagram_accounts");
    conta = await seedAccount(db!, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
  });

  /** Post parado: `dias` sem mudança (updated_at), com a mídia no R2 ou num link de fora. */
  async function parado(status: string, dias: number, fields: Record<string, unknown> = {}) {
    const id = await insertPost(db!, conta, {
      status,
      scheduled_at: status === "scheduled" ? new Date(Date.now() + 86_400_000) : null,
      media_url: `${R2}/uaiflow/molde/2026-09/${status}-${dias}.mp4`,
      media_keys: [`uaiflow/molde/2026-09/${status}-${dias}.mp4`],
      // Na criação (um update passaria pelo gatilho que põe updated_at = agora).
      updated_at: new Date(Date.now() - dias * 86_400_000),
      ...fields,
    });
    return id;
  }

  const apagadosNoR2 = () => meta.calls.filter((call) => call.method === "DELETE" && call.host.endsWith("r2.cloudflarestorage.com")).map((call) => call.path);

  test("rascunho e com erro de 15 dias perdem a mídia (o post fica, com a nota); os mais novos e os de fora ficam", async () => {
    const rascunho = await parado("draft", 15);
    const comErro = await parado("failed", 20, { last_error: "A Meta recusou o vídeo." });
    const rascunhoNovo = await parado("draft", 10);
    const agendado = await parado("scheduled", 30);
    const linkDeFora = await parado("draft", 30, { media_url: "https://loja.teste.invalid/video.mp4", media_keys: [] });

    const resultado = await scheduler.runContentCycle(8000);
    assert.equal(resultado.cleaned, 2);
    assert.deepEqual(apagadosNoR2().sort(), ["/baldefalso/uaiflow/molde/2026-09/draft-15.mp4", "/baldefalso/uaiflow/molde/2026-09/failed-20.mp4"]);

    for (const id of [rascunho, comErro]) {
      const post = await readPost(db!, id);
      assert.ok(post.media_deleted_at, "marcado");
      assert.equal(post.last_error, planner.MEDIA_REMOVED_NOTE);
      assert.match(String(post.last_error), /Envie a mídia de novo/);
    }
    assert.equal((await readPost(db!, rascunho)).status, "draft", "o post continua");
    assert.equal((await readPost(db!, comErro)).status, "failed");
    for (const id of [rascunhoNovo, agendado, linkDeFora]) assert.equal((await readPost(db!, id)).media_deleted_at, null);
  });

  test("sem mídia: 'Tentar de novo' e 'Publicar agora' pedem mídia nova; o mesmo link não serve; com mídia nova volta ao normal", async () => {
    const id = await parado("failed", 20);
    await scheduler.runContentCycle(8000);
    const linkAntigo = String((await readPost(db!, id)).media_url);

    await assert.rejects(service.editPost(id, {}, true), (error: Error & { status?: number }) => error.message === planner.MEDIA_REMOVED_NOTE && error.status === 409);
    await assert.rejects(service.editPost(id, { mediaUrl: linkAntigo, caption: "nova" }, false), /já foi apagada/);
    assert.equal((await readPost(db!, id)).status, "failed", "nada mudou");

    const editado = await service.editPost(id, { mediaUrl: `${R2}/uaiflow/conteudo/2026-10/novo.mp4` }, false);
    assert.equal(editado?.media_deleted_at, null);
    assert.equal(editado?.last_error, null);
    assert.equal(editado?.status, "draft");
  });

  test("o Molde vê que o post precisa de mídia nova (mediaDeleted)", async () => {
    const id = await parado("draft", 15);
    await scheduler.runContentCycle(8000);
    const { publicView } = await import("@/lib/content/molde-auth");
    const post = await planner.getContentPost(id);
    const visto = publicView(post!);
    assert.equal(visto.mediaDeleted, true);
    assert.equal(visto.lastError, planner.MEDIA_REMOVED_NOTE);
  });
});
