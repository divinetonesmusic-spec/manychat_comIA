import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { insertPost, seedAccount } from "./helpers/seed.mjs";

/** Supabase em que a 0006 ainda não foi colada (sem as tabelas de links): as rotas novas avisam; o resto segue igual. */
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const FRASE = "Falta colar a atualização 0006 no Supabase (veja docs/ATUALIZACAO_0006.md).";

describe("links rastreados sem a migração 0006", { skip: semBanco }, () => {
  let db: TestDatabase;
  let contaA: string;
  let links: typeof import("@/app/api/molde/links/route");
  let redirecionar: typeof import("@/app/l/[slug]/route");
  let resultados: typeof import("@/app/api/molde/resultados/route");
  let postsRoute: typeof import("@/app/api/molde/posts/route");

  before(async () => {
    db = await createTestDatabase({ ate: "0005" });
    links = await import("@/app/api/molde/links/route");
    redirecionar = await import("@/app/l/[slug]/route");
    resultados = await import("@/app/api/molde/resultados/route");
    postsRoute = await import("@/app/api/molde/posts/route");
    contaA = await seedAccount(db);
  });

  after(async () => {
    await db?.close();
  });

  test("o banco de teste está mesmo sem as tabelas novas", async () => {
    const tabelas = await db.sql("select 1 from pg_class where relname in ('tracked_links', 'link_clicks')");
    assert.equal(tabelas.length, 0);
  });

  test("POST /api/molde/links: 503 com a frase", async () => {
    const response = await links.POST(request("/api/molde/links", { headers: MOLDE, json: { accountId: contaA, externalRef: "reel-1", destino: "https://loja.teste.invalid/x" } }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, FRASE);
  });

  test("GET /api/molde/links: 503 com a frase", async () => {
    const response = await links.GET(request("/api/molde/links?refs=reel-1", { headers: MOLDE }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, FRASE);
  });

  test("a conferência do destino vem antes: http:// continua 400 (e sem token, 401)", async () => {
    const ruim = await links.POST(request("/api/molde/links", { headers: MOLDE, json: { externalRef: "reel-1", destino: "http://x.teste.invalid" } }));
    assert.equal(ruim.status, 400);
    assert.equal((await links.POST(request("/api/molde/links", { json: { externalRef: "r", destino: "https://x.teste.invalid" } }))).status, 401);
    assert.equal((await links.GET(request("/api/molde/links"))).status, 401);
  });

  test("/l/<código>: 404 com a frase simples (sem erro, sem redirecionar)", async () => {
    const erros: unknown[] = [];
    const original = console.error;
    console.error = (...partes: unknown[]) => void erros.push(partes);
    try {
      const response = await redirecionar.GET(request("/l/abcdefg", { headers: { "user-agent": "Mozilla/5.0 Instagram" } }), routeParams({ slug: "abcdefg" }));
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "Link não encontrado.");
      const head = await redirecionar.HEAD(request("/l/abcdefg", { method: "HEAD" }), routeParams({ slug: "abcdefg" }));
      assert.equal(head.status, 404);
    } finally {
      console.error = original;
    }
    assert.equal(erros.length, 0, "sem a 0006 não é erro de servidor: nada no log");
  });

  test("o resto segue igual: resultados e posts do Molde funcionam sem a 0006", async () => {
    await insertPost(db, contaA, { status: "published", scheduled_at: null, published_at: new Date(Date.now() - 3600_000), source: "molde", external_ref: "reel-1", caption: "Legenda" });
    const response = await resultados.GET(request("/api/molde/resultados", { headers: MOLDE }));
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].aiGenerated, false, "sem a coluna do aviso de IA, lido falso");
    assert.equal(data[0].captionInicio, "Legenda");

    const posts = await postsRoute.GET(request("/api/molde/posts?refs=reel-1", { headers: MOLDE }));
    assert.equal(posts.status, 200);
    assert.equal((await posts.json()).data.length, 1);
  });
});
