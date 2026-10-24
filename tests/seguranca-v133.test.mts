import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Etapa U-SEG (v133): os achados menores (SSRF, redirecionamento aberto, token na resposta da API, segredo no erro). */
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();

describe("SSRF: o servidor só baixa mídia de endereço público", () => {
  const publico = async () => [{ address: "93.184.216.34", family: 4 }];

  test("recusa localhost, rede interna, metadata da nuvem e IPv6 interno", async () => {
    const { assertPublicHttpUrl, UnsafeUrlError } = await import("@/lib/net/url-segura");
    for (const url of [
      "http://localhost:3000/x.mp4",
      "http://127.0.0.1/x.mp4",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/x.mp4",
      "http://192.168.1.10/x.mp4",
      "http://172.20.0.1/x.mp4",
      "http://100.64.0.1/x.mp4",
      "http://[::1]/x.mp4",
      "http://[::ffff:127.0.0.1]/x.mp4",
      "http://[fd00::1]/x.mp4",
      "http://0.0.0.0/x.mp4",
      "http://servidor-interno/x.mp4",
      "http://api.internal/x.mp4",
      "file:///etc/passwd",
      "ftp://exemplo.com/x.mp4",
      "https://usuario:senha@exemplo.com/x.mp4",
    ]) {
      await assert.rejects(assertPublicHttpUrl(url, { lookup: publico }), UnsafeUrlError, url);
    }
  });

  test("nome público que o DNS resolve para IP interno: recusado", async () => {
    const { assertPublicHttpUrl } = await import("@/lib/net/url-segura");
    await assert.rejects(assertPublicHttpUrl("https://rebind.exemplo.com/x.mp4", { lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }] }));
    await assert.rejects(assertPublicHttpUrl("https://nao-existe.exemplo.com/x.mp4", { lookup: async () => { throw new Error("ENOTFOUND"); } }));
  });

  test("aceita o R2 público (sem DNS) e endereços públicos", async () => {
    const { assertPublicHttpUrl } = await import("@/lib/net/url-segura");
    let consultas = 0;
    await assertPublicHttpUrl("https://midia.teste.invalid/uaiflow/reel.mp4", { lookup: async () => { consultas += 1; return []; } });
    assert.equal(consultas, 0);
    await assertPublicHttpUrl("https://cdn.exemplo.com/reel.mp4", { lookup: publico });
    await assertPublicHttpUrl("https://93.184.216.34/reel.mp4");
  });

  test("YouTube: mídia com endereço interno nem é lida", async () => {
    const youtube = await import("@/lib/redes/youtube");
    meta.reset();
    await assert.rejects(youtube.headMedia("http://169.254.169.254/latest/meta-data/"), /rede interna/);
    await assert.rejects(
      youtube.uploadYoutubeChunk({ uploadUrl: "https://www.googleapis.com/upload/x", mediaUrl: "http://127.0.0.1:9001/x", offset: 0, total: 10, chunkBytes: 10, timeoutMs: 4000 }),
      /rede interna/,
    );
    assert.equal(meta.calls.length, 0);
  });
});

describe("segredos fora das mensagens de erro", () => {
  test("redactSecrets tira tokens e segredos de endereços e textos", async () => {
    const { redactSecrets } = await import("@/lib/secrets");
    const texto = redactSecrets(
      "falhou https://graph.instagram.com/refresh?access_token=IGAAabcdefghijklmnopqrstuvwxyz&client_secret=xyz Bearer EAAabcdefghijklmnopqrstuvwxyz ya29.abcdefghijklmnop bot123456:AAEabcdefghijklmnopqrstuvwxyz",
      1000,
    );
    assert.doesNotMatch(texto, /IGAAabc|EAAabc|ya29\.abc|AAEabc|client_secret=xyz/);
    assert.match(texto, /access_token=\*\*\*/);
  });
});

describe("/l/<código>: só redireciona para https", { skip: semBanco }, () => {
  let rota: typeof import("@/app/l/[slug]/route");
  before(async () => {
    rota = await import("@/app/l/[slug]/route");
  });
  beforeEach(async () => {
    await db!.sql("delete from public.tracked_links");
  });

  for (const [nome, destino, esperado] of [
    ["https normal", "https://loja.exemplo.com/produto", 302],
    ["javascript:", "javascript:alert(1)", 404],
    ["http sem TLS", "http://loja.exemplo.com/produto", 404],
    ["data:", "data:text/html,<script>alert(1)</script>", 404],
    ["https com usuário (engana o leitor)", "https://loja.exemplo.com@site-do-mal.example/", 404],
  ] as const) {
    test(`${nome} → ${esperado}`, async () => {
      await db!.sql("insert into public.tracked_links (slug, external_ref, destination_url) values ('abc123x', 'r1', $1)", [destino]);
      const response = await rota.GET(request("/l/abc123x"), routeParams({ slug: "abc123x" }));
      assert.equal(response.status, esperado);
      if (esperado === 302) assert.equal(response.headers.get("location"), destino);
    });
  }
});

describe("respostas da API sem token (paging da Meta)", { skip: semBanco }, () => {
  let accountId: string;
  before(async () => {
    await db!.sql("delete from public.instagram_accounts");
    accountId = await seedAccount(db!, { token: "IGAA-TESTE-PAGINACAO" });
  });

  test("/api/media e /api/profile/messenger-profile devolvem só a lista, sem o 'paging' com access_token", async () => {
    const original = globalThis.fetch;
    const comPaging = (data: unknown[]) => new Response(JSON.stringify({ data, paging: { next: "https://graph.instagram.com/v23.0/1/media?access_token=IGAA-TESTE-PAGINACAO&after=x" } }), { status: 200, headers: { "content-type": "application/json" } });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith("/media")) return comPaging([{ id: "m1" }]);
      if (url.pathname.endsWith("/messenger_profile")) return comPaging([{ ice_breakers: [] }]);
      return original(input, init);
    }) as typeof fetch;
    try {
      const media = await (await import("@/app/api/media/route")).GET(request(`/api/media?accountId=${accountId}`));
      const textoMedia = await media.text();
      assert.equal(media.status, 200, textoMedia);
      assert.deepEqual(JSON.parse(textoMedia), { data: [{ id: "m1" }] });
      const perfil = await (await import("@/app/api/profile/messenger-profile/route")).GET(request(`/api/profile/messenger-profile?kind=ice_breakers&accountId=${accountId}`));
      const textoPerfil = await perfil.text();
      assert.equal(perfil.status, 200, textoPerfil);
      assert.doesNotMatch(textoPerfil, /IGAA|access_token|paging/);
      assert.deepEqual(JSON.parse(textoPerfil), { data: { data: [{ ice_breakers: [] }] } });
    } finally {
      globalThis.fetch = original;
    }
  });
});

after(async () => {
  meta.restore();
  await db?.close();
});
