import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { request } from "./helpers/http.mjs";
import { insertPost, seedAccount } from "./helpers/seed.mjs";

/** GET /api/molde/resultados: todos os posts publicados (de qualquer origem) com os números, para o Molde aprender. */
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const DIA = 24 * 60 * 60 * 1000;
const diasAtras = (dias: number) => new Date(Date.now() - dias * DIA);

describe("GET /api/molde/resultados", { skip: semBanco }, () => {
  let db: TestDatabase;
  let contaA: string;
  let contaB: string;
  let route: typeof import("@/app/api/molde/resultados/route");

  before(async () => {
    db = await createTestDatabase();
    route = await import("@/app/api/molde/resultados/route");
  });

  beforeEach(async () => {
    await db.sql("delete from public.content_posts");
    await db.sql("delete from public.instagram_accounts");
    contaA = await seedAccount(db, { username: "conta_a", userId: "17840000000000010" });
    contaB = await seedAccount(db, { username: "conta_b", userId: "17840000000000020", token: "IGAA-TESTE-CONTA-B", isDefault: false });
  });

  after(async () => {
    await db?.close();
  });

  const pegar = (consulta = "") => route.GET(request(`/api/molde/resultados${consulta}`, { headers: MOLDE }));

  async function publicado(conta: string, campos: Record<string, unknown>) {
    return insertPost(db, conta, { status: "published", scheduled_at: null, ...campos });
  }

  test("sem token do Molde: 401 (e token errado também)", async () => {
    assert.equal((await route.GET(request("/api/molde/resultados"))).status, 401);
    assert.equal((await route.GET(request("/api/molde/resultados", { headers: { "x-molde-token": "errado" } }))).status, 401);
  });

  test("só os publicados, de qualquer origem, dentro dos 90 dias, do mais novo para o mais velho", async () => {
    const molde = await publicado(contaA, { source: "molde", external_ref: "reel-1", published_at: diasAtras(2), title: "Reel do Molde", permalink: "https://instagram.teste/p/1" });
    const manual = await publicado(contaA, { source: "manual", external_ref: null, published_at: diasAtras(1), title: "Feito na tela" });
    const antigo = await publicado(contaA, { source: "molde", external_ref: "reel-0", published_at: diasAtras(10) });
    await insertPost(db, contaA, { status: "scheduled", source: "molde", external_ref: "reel-agendado" });
    await insertPost(db, contaA, { status: "failed", source: "molde", external_ref: "reel-falhou", published_at: diasAtras(1) });
    await publicado(contaA, { source: "molde", external_ref: "reel-velho", published_at: diasAtras(91) });
    await publicado(contaB, { source: "molde", external_ref: "reel-b", published_at: diasAtras(3) });

    const response = await pegar(`?accountId=${contaA}`);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.deepEqual(data.map((p: { id: string }) => p.id), [manual, molde, antigo]);
    assert.deepEqual(data.map((p: { source: string }) => p.source), ["manual", "molde", "molde"]);

    const todos = (await (await pegar()).json()).data;
    assert.equal(todos.length, 4, "sem accountId: todos os perfis");
    assert.deepEqual(new Set(todos.map((p: { username: string }) => p.username)), new Set(["conta_a", "conta_b"]));
  });

  test("devolve o formato combinado, com insights e sem token nem dado de contato", async () => {
    const insights = { views: 1200, likes: 80, reach: 900 };
    const id = await publicado(contaA, {
      source: "molde", external_ref: "reel-1", published_at: diasAtras(1), title: "Título", permalink: "https://instagram.teste/p/1",
      caption: "Legenda\ncom quebra", insights: JSON.stringify(insights), insights_at: diasAtras(0), ai_generated: true,
    });
    const { data } = await (await pegar()).json();
    assert.equal(data.length, 1);
    const [post] = data;
    assert.deepEqual(Object.keys(post).sort(), ["accountId", "aiGenerated", "captionInicio", "externalRef", "id", "insights", "insightsAt", "permalink", "publishType", "publishedAt", "source", "title", "username"]);
    assert.equal(post.id, id);
    assert.equal(post.externalRef, "reel-1");
    assert.equal(post.accountId, contaA);
    assert.equal(post.username, "conta_a");
    assert.equal(post.publishType, "reel_video");
    assert.equal(post.title, "Título");
    assert.equal(post.permalink, "https://instagram.teste/p/1");
    assert.deepEqual(post.insights, insights);
    assert.ok(post.insightsAt);
    assert.equal(post.aiGenerated, true);
    const texto = JSON.stringify(data);
    assert.ok(!texto.includes("IGAA-TESTE"), "nenhum token");
    assert.ok(!/instagram_access_token|dm_text|first_comment|link_url/.test(texto));
  });

  test("captionInicio: 140 caracteres, em uma linha só", async () => {
    await publicado(contaA, { published_at: diasAtras(1), caption: `${"a".repeat(100)}\r\n\n${"b".repeat(100)}` });
    await publicado(contaA, { published_at: diasAtras(2), caption: "Curta\nem duas linhas" });
    await publicado(contaA, { published_at: diasAtras(3), caption: "😀".repeat(200) });
    await publicado(contaA, { published_at: diasAtras(4), caption: "" });
    const { data } = await (await pegar()).json();
    const [longa, curta, emoji, vazia] = data.map((p: { captionInicio: string }) => p.captionInicio);
    assert.equal(Array.from(longa).length, 140);
    assert.ok(!/[\r\n]/.test(longa));
    assert.equal(longa, `${"a".repeat(100)} ${"b".repeat(39)}`);
    assert.equal(curta, "Curta em duas linhas");
    assert.equal(Array.from(emoji).length, 140, "corta por caractere, sem partir o emoji");
    assert.ok(!emoji.includes("�"));
    assert.equal(vazia, "");
  });

  test("dias e limite são respeitados (e têm máximo)", async () => {
    for (const d of [1, 5, 20, 50, 100, 200, 300, 400]) await publicado(contaA, { published_at: diasAtras(d) });
    const contar = async (consulta: string) => (await (await pegar(consulta)).json()).data.length;
    assert.equal(await contar(""), 4, "padrão: 90 dias (1, 5, 20 e 50; o de 100 fica de fora)");
    assert.equal(await contar("?dias=7"), 2);
    assert.equal(await contar("?dias=365"), 7);
    assert.equal(await contar("?dias=9999"), 7, "máximo de 365 dias");
    assert.equal(await contar("?limite=2"), 2);
    assert.equal(await contar("?limite=2&dias=365"), 2);
    assert.equal(await contar("?dias=abc&limite=-3"), 4, "valor inválido volta ao padrão");
    const { data } = await (await pegar("?limite=2&dias=365")).json();
    assert.ok(new Date(data[0].publishedAt) > new Date(data[1].publishedAt), "o limite corta os mais velhos");
  });

  test("limite máximo de 500", async () => {
    await db.sql(
      `insert into public.content_posts (account_id, publish_type, caption, media_url, status, published_at, source)
       select $1, 'reel_video', 'x', 'https://midia.teste.invalid/a.mp4', 'published', now() - (g || ' minutes')::interval, 'manual' from generate_series(1, 520) g`,
      [contaA],
    );
    assert.equal((await (await pegar("?limite=9999")).json()).data.length, 500);
    assert.equal((await (await pegar()).json()).data.length, 200, "padrão: 200");
  });

  test("se o banco falhar: 500 em português (sem texto técnico) e o erro vai para o log", async () => {
    await db.sql("alter table public.content_posts rename column published_at to published_at_fora");
    const erros: string[] = [];
    const original = console.error;
    console.error = (...partes: unknown[]) => void erros.push(partes.join(" "));
    try {
      const response = await pegar();
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "Não consegui ler os resultados agora. Tente de novo em instantes." });
    } finally {
      console.error = original;
      await db.sql("alter table public.content_posts rename column published_at_fora to published_at");
    }
    assert.equal(erros.length, 1);
    assert.match(erros[0], /\[resultados\]/);
    assert.equal((await pegar()).status, 200, "passado o problema, volta ao normal");
  });

  test("accountId que não é um id: 400", async () => {
    const response = await pegar("?accountId=nao-e-um-id");
    assert.equal(response.status, 400);
  });
});
