import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Links rastreados: POST/GET /api/molde/links e o redirecionamento público /l/<código>. */
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const DESTINO = "https://loja.teste.invalid/ebook";
const UA_NAVEGADOR = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 320.0.0.30.110";

describe("links rastreados", { skip: semBanco }, () => {
  let db: TestDatabase;
  let contaA: string;
  let contaB: string;
  let links: typeof import("@/app/api/molde/links/route");
  let redirecionar: typeof import("@/app/l/[slug]/route");
  let proxy: typeof import("@/proxy").proxy;

  before(async () => {
    db = await createTestDatabase();
    links = await import("@/app/api/molde/links/route");
    redirecionar = await import("@/app/l/[slug]/route");
    ({ proxy } = await import("@/proxy"));
  });

  beforeEach(async () => {
    await db.sql("delete from public.tracked_links");
    await db.sql("delete from public.instagram_accounts");
    contaA = await seedAccount(db, { username: "conta_a", userId: "17840000000000010" });
    contaB = await seedAccount(db, { username: "conta_b", userId: "17840000000000020", token: "IGAA-TESTE-CONTA-B", isDefault: false });
  });

  after(async () => {
    await db?.close();
  });

  const criar = (json: Record<string, unknown>, headers: Record<string, string> = MOLDE) => links.POST(request("/api/molde/links", { headers, json }));
  const clicar = (slug: string, consulta = "", init: { method?: string; ua?: string | null } = {}) =>
    redirecionar[init.method === "HEAD" ? "HEAD" : "GET"](
      request(`/l/${slug}${consulta}`, { method: init.method ?? "GET", headers: init.ua === null ? {} : { "user-agent": init.ua ?? UA_NAVEGADOR } }),
      routeParams({ slug }),
    );
  const cliques = async (slug?: string) =>
    Number((await db.sql<{ n: string }>(
      `select count(*) as n from public.link_clicks c join public.tracked_links l on l.id = c.link_id where $1::text is null or l.slug = $1`,
      [slug ?? null],
    ))[0].n);

  async function novoLink(externalRef = "reel-1", extra: Record<string, unknown> = {}) {
    const response = await criar({ accountId: contaA, externalRef, destino: DESTINO, ...extra });
    assert.ok(response.status === 200 || response.status === 201, await response.clone().text());
    return (await response.json()).data as { externalRef: string; slug: string; url: string; destino: string; criado: boolean };
  }

  describe("POST /api/molde/links", () => {
    test("cria: código de 7 letras/números, url com a base do site, criado:true", async () => {
      const response = await criar({ accountId: contaA, externalRef: "reel-1", destino: DESTINO, rotulo: "E-book" });
      assert.equal(response.status, 201);
      const { data } = await response.json();
      assert.deepEqual(Object.keys(data).sort(), ["criado", "destino", "externalRef", "slug", "url"]);
      assert.match(data.slug, /^[a-z0-9]{7}$/);
      assert.equal(data.url, `https://uaiflow.teste/l/${data.slug}`);
      assert.equal(data.externalRef, "reel-1");
      assert.equal(data.destino, DESTINO);
      assert.equal(data.criado, true);
      const [linha] = await db.sql("select * from public.tracked_links");
      assert.equal(linha.label, "E-book");
      assert.equal(linha.account_id, contaA);
    });

    test("pedir de novo o mesmo Reel devolve o mesmo código (criado:false); outro Reel ou outro perfil ganha outro", async () => {
      const primeiro = await novoLink("reel-1");
      const segundo = await criar({ accountId: contaA, externalRef: "reel-1", destino: DESTINO });
      assert.equal(segundo.status, 200);
      const dados = (await segundo.json()).data;
      assert.equal(dados.slug, primeiro.slug);
      assert.equal(dados.criado, false);
      const outroReel = await novoLink("reel-2");
      const outroPerfil = (await (await criar({ accountId: contaB, externalRef: "reel-1", destino: DESTINO })).json()).data;
      assert.equal(new Set([primeiro.slug, outroReel.slug, outroPerfil.slug]).size, 3);
      assert.equal((await db.sql("select 1 from public.tracked_links")).length, 3);
    });

    test("sem perfil também vale (um por Reel)", async () => {
      const a = (await (await criar({ externalRef: "reel-1", destino: DESTINO })).json()).data;
      const b = (await (await criar({ externalRef: "reel-1", destino: DESTINO })).json()).data;
      assert.equal(a.slug, b.slug);
      assert.equal((await db.sql("select 1 from public.tracked_links where account_id is null")).length, 1);
    });

    test("destino mudou: atualiza o destino, mantém o código e os cliques", async () => {
      const link = await novoLink("reel-1");
      await clicar(link.slug);
      const novo = "https://loja.teste.invalid/ebook-novo";
      const response = await criar({ accountId: contaA, externalRef: "reel-1", destino: novo });
      const { data } = await response.json();
      assert.equal(data.slug, link.slug);
      assert.equal(data.destino, novo);
      assert.equal(data.criado, false);
      assert.equal(await cliques(link.slug), 1, "os cliques continuam");
      assert.equal((await clicar(link.slug)).headers.get("location"), novo);
    });

    test("destino sem https:// (http, vazio, texto, javascript:) é recusado com 400 e a frase certa", async () => {
      for (const destino of ["http://loja.teste.invalid/x", "", "loja.teste.invalid", "javascript:alert(1)", "https://", "https:// com espaço", undefined, 42]) {
        const response = await criar({ accountId: contaA, externalRef: "reel-1", destino });
        assert.equal(response.status, 400, String(destino));
        assert.equal((await response.json()).error, "O link de destino precisa começar com https://");
      }
      assert.equal((await db.sql("select 1 from public.tracked_links")).length, 0);
    });

    test("sem externalRef: 400; accountId que não é id: 400; perfil que não existe: 404", async () => {
      assert.equal((await criar({ destino: DESTINO })).status, 400);
      assert.equal((await criar({ accountId: "xyz", externalRef: "r", destino: DESTINO })).status, 400);
      assert.equal((await criar({ accountId: "00000000-0000-4000-8000-000000000000", externalRef: "r", destino: DESTINO })).status, 404);
    });

    test("sem token: 401", async () => {
      assert.equal((await criar({ externalRef: "r", destino: DESTINO }, {})).status, 401);
      assert.equal((await db.sql("select 1 from public.tracked_links")).length, 0);
    });

    test("se o código sorteado já existe, sorteia outro", async () => {
      const tracked = await import("@/lib/db/tracked-links");
      await db.sql("insert into public.tracked_links (slug, account_id, external_ref, destination_url) values ('aaaaaaa', $1, 'reel-ocupado', $2)", [contaA, DESTINO]);
      const sorteios = ["aaaaaaa", "aaaaaaa", "bbbbbbb"];
      let chamadas = 0;
      const link = await tracked.upsertTrackedLink({ accountId: contaA, externalRef: "reel-novo", destino: DESTINO }, () => sorteios[chamadas++]);
      assert.equal(link.slug, "bbbbbbb");
      assert.equal(chamadas, 3);
      assert.equal(link.criado, true);
      assert.match(tracked.newSlug(), /^[a-z0-9]{7}$/);
    });
  });

  describe("GET /l/<código>", () => {
    test("redireciona 302 para o destino, sem guardar em cache, e conta 1 clique (origem outro)", async () => {
      const link = await novoLink();
      const response = await clicar(link.slug);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), DESTINO);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const [clique] = await db.sql("select * from public.link_clicks");
      assert.equal(clique.origin, "outro");
      assert.equal(await cliques(), 1);
    });

    test("?de=bio|dm|comentario marca a origem; qualquer outro valor vira outro", async () => {
      const link = await novoLink();
      for (const de of ["bio", "dm", "comentario", "bio", "story", "BIO", ""]) await clicar(link.slug, de ? `?de=${de}` : "");
      const linhas = await db.sql<{ origin: string; n: string }>("select origin, count(*) as n from public.link_clicks group by origin");
      const porOrigem = Object.fromEntries(linhas.map((l) => [l.origin, Number(l.n)]));
      assert.deepEqual(porOrigem, { bio: 2, dm: 1, comentario: 1, outro: 3 });
    });

    test("robôs de prévia redirecionam mas não contam", async () => {
      const link = await novoLink();
      const robos = [
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        "Facebot",
        "WhatsApp/2.23.20.0 A",
        "TelegramBot (like TwitterBot)",
        "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
        "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
        "Googlebot/2.1 (+http://www.google.com/bot.html)",
        "SomeCrawler/1.0",
        "curl/8.4.0",
        "Wget/1.21",
        "LinkPreview/1.0",
        "Mozilla/5.0 (compatible; spider)",
      ];
      for (const ua of robos) {
        const response = await clicar(link.slug, "", { ua });
        assert.equal(response.status, 302, ua);
        assert.equal(response.headers.get("location"), DESTINO, ua);
      }
      assert.equal(await cliques(), 0);
    });

    test("HEAD redireciona e não conta", async () => {
      const link = await novoLink();
      const response = await clicar(link.slug, "", { method: "HEAD" });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), DESTINO);
      assert.equal(await cliques(), 0);
    });

    test("o navegador de dentro do Instagram e navegadores comuns contam; sem User-Agent também", async () => {
      const link = await novoLink();
      await clicar(link.slug, "", { ua: UA_NAVEGADOR });
      await clicar(link.slug, "", { ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 Instagram 310.0.0.38.109 Android" });
      await clicar(link.slug, "", { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15" });
      await clicar(link.slug, "", { ua: null });
      assert.equal(await cliques(), 4);
    });

    test("código que não existe: 404 com a frase; nada é gravado", async () => {
      await novoLink();
      for (const slug of ["naoexiste", "x", "ABCDEFG", "a b"]) {
        const response = await clicar(slug);
        assert.equal(response.status, 404, slug);
        assert.equal(await response.text(), "Link não encontrado.");
      }
      assert.equal(await cliques(), 0);
    });

    test("não guarda IP nem navegador: a tabela só tem quando e de onde", async () => {
      const colunas = await db.sql<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'link_clicks' order by column_name");
      assert.deepEqual(colunas.map((c) => c.column_name), ["clicked_at", "id", "link_id", "origin"]);
      const link = await novoLink();
      await clicar(link.slug, "", { ua: UA_NAVEGADOR });
      assert.ok(!JSON.stringify(await db.sql("select * from public.link_clicks")).includes("iPhone"));
    });

    test("se o banco falhar ao gravar o clique, redireciona igual e registra no log", async () => {
      const link = await novoLink();
      await db.sql("alter table public.link_clicks rename to link_clicks_fora");
      const erros: string[] = [];
      const original = console.error;
      console.error = (...partes: unknown[]) => void erros.push(partes.join(" "));
      try {
        const response = await clicar(link.slug);
        assert.equal(response.status, 302);
        assert.equal(response.headers.get("location"), DESTINO);
      } finally {
        console.error = original;
        await db.sql("alter table public.link_clicks_fora rename to link_clicks");
      }
      assert.equal(erros.length, 1);
      assert.match(erros[0], /não consegui gravar o clique/);
    });

    test("se gravar o clique demorar, o redirecionamento não espera mais de ~300 ms (e o clique entra depois)", async () => {
      const link = await novoLink();
      await db.sql(`create function public.teste_clique_lento() returns trigger language plpgsql as $$ begin perform pg_sleep(1.2); return new; end $$`);
      await db.sql("create trigger teste_clique_lento before insert on public.link_clicks for each row execute function public.teste_clique_lento()");
      try {
        const inicio = Date.now();
        const response = await clicar(link.slug);
        const gasto = Date.now() - inicio;
        assert.equal(response.status, 302);
        assert.ok(gasto < 900, `demorou ${gasto} ms`);
        assert.equal(await cliques(), 0, "ainda não terminou de gravar");
        const limite = Date.now() + 5000;
        while ((await cliques()) === 0 && Date.now() < limite) await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(await cliques(), 1, "o clique entra quando o banco termina");
      } finally {
        await db.sql("drop trigger teste_clique_lento on public.link_clicks");
        await db.sql("drop function public.teste_clique_lento()");
      }
    });
  });

  describe("GET /api/molde/links", () => {
    const ler = (consulta = "", headers: Record<string, string> = MOLDE) => links.GET(request(`/api/molde/links${consulta}`, { headers }));

    test("cliques total, 7 dias, 30 dias e por origem; só os refs pedidos", async () => {
      const um = await novoLink("reel-1");
      const dois = await novoLink("reel-2");
      await novoLink("reel-3");
      const semear = (slug: string, origem: string, diasAtras: number, vezes = 1) =>
        db.sql(
          `insert into public.link_clicks (link_id, origin, clicked_at)
           select l.id, $2, now() - make_interval(days => $3::int, hours => 1) from public.tracked_links l, generate_series(1, $4) where l.slug = $1`,
          [slug, origem, diasAtras, vezes],
        );
      await semear(um.slug, "bio", 1, 3);
      await semear(um.slug, "dm", 6, 2);
      await semear(um.slug, "comentario", 20, 4);
      await semear(um.slug, "outro", 45, 5);
      await semear(dois.slug, "dm", 0);

      const response = await ler("?refs=reel-1,reel-2");
      assert.equal(response.status, 200);
      const { data } = await response.json();
      assert.equal(data.length, 2);
      const a = data.find((l: { externalRef: string }) => l.externalRef === "reel-1");
      assert.equal(a.slug, um.slug);
      assert.equal(a.url, `https://uaiflow.teste/l/${um.slug}`);
      assert.equal(a.destino, DESTINO);
      assert.deepEqual(a.cliques, { total: 14, d7: 5, d30: 9, porOrigem: { bio: 3, dm: 2, comentario: 4, outro: 5 } });
      const b = data.find((l: { externalRef: string }) => l.externalRef === "reel-2");
      assert.deepEqual(b.cliques, { total: 1, d7: 1, d30: 1, porOrigem: { bio: 0, dm: 1, comentario: 0, outro: 0 } });
    });

    test("link sem cliques volta com zeros; ref sem link não aparece; sem refs, todos", async () => {
      await novoLink("reel-1");
      const { data } = await (await ler("?refs=reel-1,reel-sem-link")).json();
      assert.equal(data.length, 1);
      assert.deepEqual(data[0].cliques, { total: 0, d7: 0, d30: 0, porOrigem: { bio: 0, dm: 0, comentario: 0, outro: 0 } });
      await novoLink("reel-2");
      assert.equal((await (await ler()).json()).data.length, 2);
    });

    test("accountId separa os perfis", async () => {
      await novoLink("reel-1");
      await criar({ accountId: contaB, externalRef: "reel-1", destino: "https://outra.teste.invalid/x" });
      const daA = (await (await ler(`?refs=reel-1&accountId=${contaA}`)).json()).data;
      assert.equal(daA.length, 1);
      assert.equal(daA[0].destino, DESTINO);
      assert.equal((await (await ler("?refs=reel-1")).json()).data.length, 2);
      assert.equal((await ler("?accountId=xyz")).status, 400);
    });

    test("cliques contados pelo /l aparecem na leitura", async () => {
      const link = await novoLink("reel-1");
      await clicar(link.slug, "?de=bio");
      await clicar(link.slug, "?de=dm");
      const { data } = await (await ler("?refs=reel-1")).json();
      assert.deepEqual(data[0].cliques.porOrigem, { bio: 1, dm: 1, comentario: 0, outro: 0 });
      assert.equal(data[0].cliques.total, 2);
    });

    test("aceita até 200 refs (os que passam disso são ignorados)", async () => {
      await novoLink("reel-1");
      const refs = ["reel-1", ...Array.from({ length: 250 }, (_, i) => `x${i}`)].join(",");
      assert.equal((await (await ler(`?refs=${refs}`)).json()).data.length, 1);
    });

    test("sem token: 401", async () => {
      assert.equal((await ler("", {})).status, 401);
    });
  });

  describe("acesso", () => {
    test("/l/ não pede login: o proxy deixa passar; /api/molde/links também (o token é conferido dentro da rota)", async () => {
      const link = await novoLink();
      const publico = await proxy(request(`/l/${link.slug}`));
      assert.equal(publico.headers.get("x-middleware-next"), "1");
      assert.equal((await proxy(request("/l/abc?de=bio"))).headers.get("x-middleware-next"), "1");
      assert.equal((await proxy(request("/api/molde/links"))).headers.get("x-middleware-next"), "1");
      // e a vizinhança continua protegida
      assert.notEqual((await proxy(request("/lojas"))).headers.get("x-middleware-next"), "1");
      assert.notEqual((await proxy(request("/api/contacts"))).headers.get("x-middleware-next"), "1");
    });

    test("/api/molde/links sem token: 401 em GET e POST", async () => {
      assert.equal((await links.GET(request("/api/molde/links"))).status, 401);
      assert.equal((await links.POST(request("/api/molde/links", { json: { externalRef: "r", destino: DESTINO } }))).status, 401);
    });

    test("as duas tabelas têm RLS ligado e nenhuma política", async () => {
      const tabelas = await db.sql<{ relname: string; relrowsecurity: boolean }>(
        "select relname, relrowsecurity from pg_class where relname in ('tracked_links', 'link_clicks') order by relname",
      );
      assert.deepEqual(tabelas.map((t) => [t.relname, t.relrowsecurity]), [["link_clicks", true], ["tracked_links", true]]);
      assert.equal((await db.sql("select 1 from pg_policies where tablename in ('tracked_links', 'link_clicks')")).length, 0);
    });

    test("a 0006 pode ser colada de novo sem erro nem perda de dados", async () => {
      const link = await novoLink();
      await clicar(link.slug);
      const { readFileSync } = await import("node:fs");
      const sql = readFileSync("supabase/migrations/0006_fase5.sql", "utf8");
      await db.sql(sql);
      assert.equal(await cliques(), 1);
      assert.equal((await db.sql("select 1 from public.tracked_links")).length, 1);
    });
  });
});
