import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/**
 * v137 · K12: a página de venda no ar pelo UaiFlow (/api/molde/paginas e /v/<slug>, migração 0020).
 * Banco de teste com todas as migrações; R2 falso (o HTML fica privado no R2) e, sem o R2, no banco.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Oração</title></head><body><h1>Oração da manhã</h1>
<a href="https://pay.kiwify.com.br/abc" target="_blank">Comprar</a> <a href="/l/abc123">Comprar pelo link</a></body></html>`;

describe("v137 · K12 a página de venda no UaiFlow", { skip: semBanco }, () => {
  let db: TestDatabase;
  let rota: typeof import("@/app/api/molde/paginas/route");
  let rotaId: typeof import("@/app/api/molde/paginas/[id]/route");
  let publica: typeof import("@/app/v/[slug]/route");
  let paginas: typeof import("@/lib/molde/paginas");
  const r2Env = { ...process.env };

  before(async () => {
    db = await createTestDatabase();
    rota = await import("@/app/api/molde/paginas/route");
    rotaId = await import("@/app/api/molde/paginas/[id]/route");
    publica = await import("@/app/v/[slug]/route");
    paginas = await import("@/lib/molde/paginas");
  });

  beforeEach(async () => {
    meta.reset();
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL"]) process.env[k] = r2Env[k];
    await db.sql("delete from public.molde_paginas");
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  const criar = (json: Record<string, unknown>, headers: Record<string, string> = MOLDE) =>
    rota.POST(request("/api/molde/paginas", { method: "POST", json, headers }));
  const abrir = (slug: string, method = "GET") => publica[method === "HEAD" ? "HEAD" : "GET"](request(`/v/${slug}`, { method }), routeParams({ slug }));

  test("sem o x-molde-token: 401 nas três rotas", async () => {
    assert.equal((await criar({ titulo: "x", html: HTML, molde: "birdie" }, {})).status, 401);
    assert.equal((await rota.GET(request("/api/molde/paginas?molde=birdie"))).status, 401);
    const id = "2b6c0d6e-8a51-4c41-9a39-7c1d1c1b0f10";
    assert.equal((await rotaId.DELETE(request(`/api/molde/paginas/${id}`, { method: "DELETE" }), routeParams({ id }))).status, 401);
  });

  test("cria com o slug saído do título, guarda no R2 (privado) e abre em /v/<slug> com o isolamento", async () => {
    const r = await criar({ titulo: "Oração da Manhã — 7 dias!", html: HTML, molde: "birdie" });
    assert.equal(r.status, 201);
    const corpo = await r.json();
    assert.equal(corpo.slug, "oracao-da-manha-7-dias");
    assert.equal(corpo.url, "https://uaiflow.teste/v/oracao-da-manha-7-dias");
    assert.equal(corpo.publicada, true);
    assert.equal(corpo.criada, true);
    assert.equal(corpo.tamanho, Buffer.byteLength(HTML));
    assert.ok(meta.r2.has(`uaiflow/paginas/${corpo.id}.html`), "o HTML foi para o R2");
    const [linha] = await db.sql<{ html: string | null; armazenamento: string }>("select html, armazenamento from public.molde_paginas where id = $1", [corpo.id]);
    assert.equal(linha.html, null);
    assert.equal(linha.armazenamento, "r2");

    const v = await abrir(corpo.slug);
    assert.equal(v.status, 200);
    assert.equal(await v.text(), HTML);
    assert.match(String(v.headers.get("content-type")), /^text\/html; charset=utf-8/);
    const csp = String(v.headers.get("content-security-policy"));
    assert.match(csp, /^sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation/);
    assert.doesNotMatch(csp, /allow-same-origin/, "o HTML do Molde nunca roda com a origem do UaiFlow");
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(v.headers.get("x-content-type-options"), "nosniff");
    assert.equal(v.headers.get("x-frame-options"), "DENY");
    const h = await abrir(corpo.slug, "HEAD");
    assert.equal(h.status, 200);
    assert.equal(await h.text(), "");
  });

  test("atualiza pelo id e pelo slug (mesmo projeto); outro projeto com o mesmo slug ganha -2", async () => {
    const a = await (await criar({ titulo: "Oração", slug: "oracao", html: HTML, molde: "birdie" })).json();
    const b = await criar({ id: a.id, titulo: "Oração nova", html: "<p>nova</p>", molde: "birdie" });
    assert.equal(b.status, 200);
    assert.equal((await b.json()).slug, "oracao");
    assert.equal(await (await abrir("oracao")).text(), "<p>nova</p>");
    const c = await criar({ slug: "oracao", titulo: "Oração 3", html: "<p>3</p>", molde: "birdie" });
    assert.equal(c.status, 200);
    assert.equal((await c.json()).id, a.id);
    const d = await (await criar({ slug: "oracao", titulo: "Outra", html: "<p>dell</p>", molde: "dell" })).json();
    assert.equal(d.slug, "oracao-2");
    assert.equal(await (await abrir("oracao")).text(), "<p>3</p>");
    // o id de outro projeto não é achado
    assert.equal((await criar({ id: a.id, titulo: "x", html: "<p>x</p>", molde: "dell" })).status, 404);
    // a lista do projeto
    const lista = await (await rota.GET(request("/api/molde/paginas?molde=birdie", { headers: MOLDE }))).json();
    assert.equal(lista.data.length, 1);
    assert.equal(lista.data[0].titulo, "Oração 3");
    assert.equal(lista.data[0].url, "https://uaiflow.teste/v/oracao");
  });

  test("recusas com a frase: grande demais (413), sem título, slug ruim, id ruim, conta que não existe", async () => {
    const grande = "a".repeat(paginas.PAGINA_MAX_BYTES + 1);
    const r = await criar({ titulo: "Grande", html: grande, molde: "birdie" });
    assert.equal(r.status, 413);
    const e = await r.json();
    assert.equal(e.codigo, "grande_demais");
    assert.match(e.error, /o máximo é 5,0 MB/);
    assert.equal((await criar({ html: HTML, molde: "birdie" })).status, 400);
    assert.equal((await criar({ titulo: "x", html: HTML })).status, 400);
    assert.equal((await criar({ titulo: "x", html: "  ", molde: "birdie" })).status, 400);
    assert.equal((await criar({ titulo: "x", slug: "!!", html: HTML, molde: "birdie" })).status, 400);
    assert.equal((await criar({ titulo: "x", id: "nao-e-uuid", html: HTML, molde: "birdie" })).status, 400);
    const conta = await criar({ titulo: "x", html: HTML, molde: "birdie", accountId: "2b6c0d6e-8a51-4c41-9a39-7c1d1c1b0f10" });
    assert.equal(conta.status, 400);
    assert.equal((await conta.json()).codigo, "conta");
    assert.equal(meta.r2.size, 0, "nada recusado foi para o R2");
  });

  test("DELETE tira do ar (404 em português); um POST com o mesmo id põe de volta", async () => {
    const a = await (await criar({ titulo: "Sai do ar", html: HTML, molde: "birdie" })).json();
    const d = await rotaId.DELETE(request(`/api/molde/paginas/${a.id}?molde=birdie`, { method: "DELETE", headers: MOLDE }), routeParams({ id: a.id }));
    assert.equal(d.status, 200);
    assert.deepEqual(await d.json(), { id: a.id, slug: "sai-do-ar", url: "https://uaiflow.teste/v/sai-do-ar", publicada: false });
    const v = await abrir("sai-do-ar");
    assert.equal(v.status, 404);
    assert.match(await v.text(), /Página não encontrada/);
    assert.equal(v.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await rotaId.DELETE(request(`/api/molde/paginas/${a.id}?molde=dell`, { method: "DELETE", headers: MOLDE }), routeParams({ id: a.id }))).status, 404);
    assert.equal((await criar({ id: a.id, titulo: "Sai do ar", html: HTML, molde: "birdie" })).status, 200);
    assert.equal((await abrir("sai-do-ar")).status, 200);
    // rascunho (publicada: false) não abre
    await criar({ titulo: "Rascunho", html: HTML, molde: "birdie", publicada: false });
    assert.equal((await abrir("rascunho")).status, 404);
    assert.equal((await abrir("nao-existe")).status, 404);
    assert.equal((await abrir("..%2f")).status, 404);
  });

  test("sem o R2 configurado, o HTML fica no banco e abre igual", async () => {
    delete process.env.R2_BUCKET;
    const a = await (await criar({ titulo: "No banco", html: HTML, molde: "birdie" })).json();
    const [linha] = await db.sql<{ html: string | null; armazenamento: string; html_key: string | null }>("select html, armazenamento, html_key from public.molde_paginas where id = $1", [a.id]);
    assert.equal(linha.armazenamento, "banco");
    assert.equal(linha.html, HTML);
    assert.equal(linha.html_key, null);
    assert.equal(meta.r2.size, 0);
    assert.equal(await (await abrir("no-banco")).text(), HTML);
  });

  test("o R2 falhou: 502 com a frase, e a página nova não fica no ar", async () => {
    meta.r2Fails = 500;
    const r = await criar({ titulo: "Falhou", html: HTML, molde: "birdie" });
    assert.equal(r.status, 502);
    assert.equal((await r.json()).codigo, "armazenamento");
    meta.r2Fails = null;
    assert.equal((await abrir("falhou")).status, 404);
    // mandar de novo (mesmo slug, mesmo projeto) completa
    assert.equal((await criar({ titulo: "Falhou", html: HTML, molde: "birdie" })).status, 200);
    assert.equal((await abrir("falhou")).status, 200);
  });

  test("o /v é público no proxy (sem login) e o /l continua público", async () => {
    const { proxy } = await import("@/proxy");
    const v = await proxy(request("/v/qualquer"));
    assert.equal(v.status, 200);
    assert.equal(v.headers.get("location"), null);
    const l = await proxy(request("/l/abc123"));
    assert.equal(l.headers.get("location"), null);
  });

  test("PAGINAS_BASE_URL (o domínio próprio) vira o começo da url; inválido é ignorado", async () => {
    process.env.PAGINAS_BASE_URL = "https://oracaodamanha.com.br/";
    try {
      const a = await (await criar({ titulo: "Domínio", html: HTML, molde: "birdie" })).json();
      assert.equal(a.url, "https://oracaodamanha.com.br/v/dominio");
      process.env.PAGINAS_BASE_URL = "http://inseguro.com.br";
      const b = await (await criar({ titulo: "Domínio", html: HTML, molde: "birdie" })).json();
      assert.equal(b.url, "https://uaiflow.teste/v/dominio");
    } finally {
      delete process.env.PAGINAS_BASE_URL;
    }
  });

  test("slugDe: acentos, símbolos e tamanho", () => {
    assert.equal(paginas.slugDe("Oração da Manhã — 7 dias!"), "oracao-da-manha-7-dias");
    assert.equal(paginas.slugDe("x"), "x-pagina");
    assert.equal(paginas.slugDe("!!!"), "");
    assert.ok(paginas.slugDe("a".repeat(100)).length <= 60);
  });
});
