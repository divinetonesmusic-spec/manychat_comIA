import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/**
 * U-SEG-05 (v133): o relógio de cada minuto renova o token de TODAS as conexões que precisam (não só a conta padrão),
 * uma por vez e dentro do tempo, e avisa no Telegram quando falha ou falta pouco para vencer (1 aviso a cada 24 h).
 */
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const HORA = 3600_000;
const DIA = 24 * HORA;

describe("quando renovar (isDue)", () => {
  test("token novo ou renovado há menos de 7 dias: não; com mais de 7 dias: sim; erro recente espera 6 h", async () => {
    const { isDue } = await import("@/lib/instagram/token-clock");
    const now = new Date("2026-10-24T12:00:00Z");
    const em = (dias: number) => new Date(now.getTime() + dias * DIA).toISOString();
    assert.equal(isDue({ expiresAt: em(59.5), lastRefreshAt: null }, {}, now), false, "acabou de conectar");
    assert.equal(isDue({ expiresAt: em(55), lastRefreshAt: null }, {}, now), false, "5 dias de vida");
    assert.equal(isDue({ expiresAt: em(50), lastRefreshAt: null }, {}, now), true, "10 dias de vida");
    assert.equal(isDue({ expiresAt: em(50), lastRefreshAt: em(-2) }, {}, now), false, "renovado há 2 dias");
    assert.equal(isDue({ expiresAt: null, lastRefreshAt: null }, {}, now), true, "sem data: tenta");
    assert.equal(isDue({ expiresAt: em(20), lastRefreshAt: null }, { erroEm: em(-0.1) }, now), false, "falhou há pouco");
    assert.equal(isDue({ expiresAt: em(20), lastRefreshAt: null }, { erroEm: em(-0.3) }, now), true, "falhou há 7 h");
    assert.equal(isDue({ expiresAt: null, lastRefreshAt: null }, { okEm: em(-1) }, now), false, "renovado ontem pelo relógio");
  });
});

describe("renovação no relógio (com banco)", { skip: semBanco }, () => {
  let clock: typeof import("@/lib/instagram/token-clock");
  let ids: Record<string, string>;

  before(async () => {
    clock = await import("@/lib/instagram/token-clock");
  });

  beforeEach(async () => {
    meta.reset();
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    process.env.TELEGRAM_CHAT_ID = "999";
    await db!.sql("delete from public.app_status");
    await db!.sql("delete from public.instagram_accounts");
    ids = {
      padrao: await seedAccount(db!, { username: "padrao", userId: "1001", token: "IGAA-TESTE-PADRAO", isDefault: true, expiresInDays: 58 }),
      segunda: await seedAccount(db!, { username: "segunda", userId: "1002", token: "IGAA-TESTE-SEGUNDA", isDefault: false, expiresInDays: 20 }),
      terceira: await seedAccount(db!, { username: "terceira", userId: "1003", token: "IGAA-TESTE-TERCEIRA", isDefault: false, expiresInDays: 30 }),
    };
  });

  after(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  const rodar = (now = new Date(), deadline = Date.now() + 9000) => clock.runTokenClock({ deadline, now, force: true });

  test("renova as contas que NÃO são a padrão e que precisam; a padrão recém-renovada fica", async () => {
    const result = await rodar();
    assert.equal(result.renovadas, 2);
    assert.equal(meta.count("/refresh_access_token"), 2);
    const contas = await db!.sql<{ instagram_username: string; dias: number }>(
      "select instagram_username, round(extract(epoch from token_expires_at - now()) / 86400) as dias from public.instagram_accounts order by instagram_username",
    );
    for (const conta of contas) assert.ok(Number(conta.dias) >= 58, `${conta.instagram_username}: ${conta.dias} dias`);
    assert.equal(meta.telegram.length, 0, "nada a avisar");
    assert.doesNotMatch(JSON.stringify(await db!.sql("select valor from public.app_status")), /IGAA/, "o estado guardado não tem token");

    const segunda = await rodar();
    assert.equal(segunda.renovadas, 0, "renovadas há pouco: não repete");
    assert.equal(meta.count("/refresh_access_token"), 2);
  });

  test("falha: aviso no Telegram (sem token), nova tentativa só depois de 6 h e aviso de novo só depois de 24 h", async () => {
    meta.refreshFails.add("IGAA-TESTE-SEGUNDA");
    const agora = new Date();
    const primeira = await rodar(agora);
    assert.equal(primeira.falhas, 1);
    assert.equal(primeira.avisos, 1);
    assert.equal(meta.telegram.length, 1);
    const texto = String(meta.telegram[0].body.text);
    assert.match(texto, /@segunda: não consegui renovar/);
    assert.doesNotMatch(texto, /IGAA/);

    await rodar(new Date(agora.getTime() + 2 * HORA));
    assert.equal(meta.count("/refresh_access_token"), 2, "1 renovada + 1 falha; nada novo em 2 h");
    assert.equal(meta.telegram.length, 1);

    await rodar(new Date(agora.getTime() + 7 * HORA));
    assert.equal(meta.count("/refresh_access_token"), 3, "tentou de novo depois de 6 h");
    assert.equal(meta.telegram.length, 1, "o aviso não repete antes de 24 h");

    await rodar(new Date(agora.getTime() + 25 * HORA));
    assert.equal(meta.telegram.length, 2, "depois de 24 h avisa de novo");
  });

  test("conexão vencendo em menos de 10 dias sem conseguir renovar: avisa", async () => {
    await db!.sql("update public.instagram_accounts set token_expires_at = now() + interval '4 days' where id = $1", [ids.terceira]);
    meta.refreshFails.add("IGAA-TESTE-TERCEIRA");
    await rodar();
    assert.match(String(meta.telegram[0]?.body.text), /@terceira: não consegui renovar a conexão\. Ela vence em [34] dias/);
  });

  test("pouco tempo no relógio: não começa nenhuma renovação (fica para o próximo minuto)", async () => {
    const result = await rodar(new Date(), Date.now() + 1500);
    assert.equal(meta.count("/refresh_access_token"), 0);
    assert.equal(result.pendentes, 2);
  });

  test("entre servidores, roda no máximo a cada 15 min", async () => {
    clock.resetTokenClockMemory();
    const primeira = await clock.runTokenClock({ deadline: Date.now() + 9000 });
    clock.resetTokenClockMemory();
    const segunda = await clock.runTokenClock({ deadline: Date.now() + 9000 });
    assert.equal(primeira.ran, true);
    assert.equal(segunda.ran, false);
    assert.equal(segunda.motivo, "cedo");
    clock.resetTokenClockMemory();
  });

  test("o relógio (/api/queue/drain) chama a renovação", async () => {
    clock.resetTokenClockMemory();
    const drain = await import("@/app/api/queue/drain/route");
    const response = await drain.POST(request("/api/queue/drain", { method: "POST", headers: { "x-worker-secret": process.env.WORKER_SECRET as string } }));
    const body = await response.json();
    assert.equal(body.tokens?.ran, true, JSON.stringify(body.tokens));
    assert.equal(meta.count("/refresh_access_token"), 2);
  });
});

describe("botão «Renovar a conexão» (Configurações)", { skip: semBanco }, () => {
  let route: typeof import("@/app/api/token/refresh/route");
  let adminCookie: string;

  before(async () => {
    route = await import("@/app/api/token/refresh/route");
    adminCookie = (await (await import("@/lib/auth")).createAdminSessionValue()) as string;
  });

  beforeEach(async () => {
    meta.reset();
    await db!.sql("delete from public.instagram_accounts");
    await seedAccount(db!, { username: "padrao", userId: "1001", token: "IGAA-TESTE-PADRAO", isDefault: true, expiresInDays: 20 });
    await seedAccount(db!, { username: "segunda", userId: "1002", token: "IGAA-TESTE-SEGUNDA", isDefault: false, expiresInDays: 20 });
  });

  test("com a sessão e vindo do próprio site: renova todos e volta para Configurações", async () => {
    const response = await route.POST(request("/api/token/refresh", { method: "POST", cookies: { admin_session: adminCookie }, headers: { origin: "https://uaiflow.teste" } }));
    assert.equal(response.status, 303);
    const destino = new URL(response.headers.get("location") as string);
    assert.equal(destino.pathname, "/configuracoes");
    assert.equal(destino.searchParams.get("renovacao"), "ok");
    assert.equal(meta.count("/refresh_access_token"), 2);
  });

  test("formulário de outro site (CSRF): recusado sem chamar a Meta", async () => {
    const response = await route.POST(request("/api/token/refresh", { method: "POST", cookies: { admin_session: adminCookie }, headers: { origin: "https://site-do-mal.example" } }));
    assert.equal(response.status, 403);
    assert.equal(meta.count("/refresh_access_token"), 0);
  });

  test("GET com a sessão (link ou imagem): continua exigindo o segredo do relógio", async () => {
    const response = await route.GET(request("/api/token/refresh", { cookies: { admin_session: adminCookie } }));
    assert.equal(response.status, 401);
    assert.equal(meta.count("/refresh_access_token"), 0);
  });
});

after(async () => {
  meta.restore();
  await db?.close();
});
