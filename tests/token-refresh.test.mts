import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** U-PUB-02: a renovação semanal renova o token de TODAS as contas, cada uma por conta própria. */
const meta = installFakeMeta();
// O banco vem antes de qualquer import do app: o pool do app lê DATABASE_URL ao carregar.
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const WORKER = { "x-worker-secret": process.env.WORKER_SECRET as string };

describe("avisos de token (ponto de extensão para o Telegram)", () => {
  test("falha na renovação e token vencendo em menos de 10 dias viram aviso; o resto não", async () => {
    const { tokenRefreshAlerts } = await import("@/lib/instagram/token-refresh");
    const now = new Date("2026-10-07T12:00:00Z");
    const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
    const alerts = tokenRefreshAlerts([
      { accountId: "a", username: "ok_longe", ok: true, expiresAt: days(60) },
      { accountId: "b", username: "ok_perto", ok: true, expiresAt: days(5) },
      { accountId: "c", username: "falhou", ok: false, error: "Session has expired", tokenExpiresAt: days(3) },
    ], now);
    assert.deepEqual(alerts.map((alert) => [alert.username, alert.motivo, alert.diasParaVencer]), [
      ["ok_perto", "vence_em_breve", 5],
      ["falhou", "falha_na_renovacao", 3],
    ]);
  });
});

describe("renovação de token de todas as contas (U-PUB-02)", { skip: semBanco }, () => {
  let route: typeof import("@/app/api/token/refresh/route");

  before(async () => {
    route = await import("@/app/api/token/refresh/route");
  });

  beforeEach(async () => {
    meta.reset();
    await db!.sql("delete from public.instagram_accounts");
    await seedAccount(db!, { username: "ruthie", userId: "1001", token: "IGAA-TESTE-RUTHIE", isDefault: true, expiresInDays: 20 });
    await seedAccount(db!, { username: "payoff", userId: "1002", token: "IGAA-TESTE-PAYOFF", isDefault: false, expiresInDays: 20 });
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  test("sem o segredo do relógio continua recusando", async () => {
    const response = await route.POST(request("/api/token/refresh", { method: "POST" }));
    assert.equal(response.status, 401);
    assert.equal(meta.count("/refresh_access_token"), 0);
  });

  test("duas contas: as duas são renovadas e o resumo não traz token", async () => {
    const response = await route.POST(request("/api/token/refresh", { method: "POST", headers: WORKER }));
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.contas.map((conta: { username: string; ok: boolean }) => [conta.username, conta.ok]), [["ruthie", true], ["payoff", true]]);
    for (const conta of body.contas) assert.ok(new Date(conta.expiresAt).getTime() > Date.now() + 59 * 86_400_000);
    assert.doesNotMatch(text, /IGAA/, "nenhum token na resposta");
    assert.equal(meta.count("/refresh_access_token"), 2);

    const rows = await db!.sql<{ instagram_username: string; instagram_access_token: string; last_token_refresh_at: Date | null }>(
      "select instagram_username, instagram_access_token, last_token_refresh_at from public.instagram_accounts order by instagram_username",
    );
    for (const row of rows) {
      assert.match(row.instagram_access_token, /^IGAA-TESTE-RENOVADO-/, row.instagram_username);
      assert.ok(row.last_token_refresh_at);
    }
  });

  test("uma conta falhando: a outra é renovada e o erro aparece no resumo", async () => {
    meta.refreshFails.add("IGAA-TESTE-RUTHIE");
    const response = await route.POST(request("/api/token/refresh", { method: "POST", headers: WORKER }));
    const body = await response.json();
    assert.equal(response.status, 200, "pelo menos uma renovou");
    assert.equal(body.ok, false, "nem todas renovaram");
    const ruthie = body.contas.find((conta: { username: string }) => conta.username === "ruthie");
    const payoff = body.contas.find((conta: { username: string }) => conta.username === "payoff");
    assert.equal(ruthie.ok, false);
    assert.match(ruthie.erro, /Session has expired/);
    assert.equal(ruthie.expiresAt, undefined);
    assert.equal(payoff.ok, true);

    const [stillOld] = await db!.sql<{ instagram_access_token: string }>("select instagram_access_token from public.instagram_accounts where instagram_username = 'ruthie'");
    const [renewed] = await db!.sql<{ instagram_access_token: string }>("select instagram_access_token from public.instagram_accounts where instagram_username = 'payoff'");
    assert.equal(stillOld.instagram_access_token, "IGAA-TESTE-RUTHIE");
    assert.match(renewed.instagram_access_token, /^IGAA-TESTE-RENOVADO-/);
  });

  test("todas falhando: status 500 com o resumo", async () => {
    meta.refreshFails.add("IGAA-TESTE-RUTHIE");
    meta.refreshFails.add("IGAA-TESTE-PAYOFF");
    const response = await route.POST(request("/api/token/refresh", { method: "POST", headers: WORKER }));
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.contas.length, 2);
    assert.ok(body.contas.every((conta: { ok: boolean; erro: string }) => !conta.ok && conta.erro));
  });

  test("a conta padrão continua espelhada na tabela config depois da renovação", async () => {
    await route.GET(request("/api/token/refresh", { headers: WORKER }));
    const [config] = await db!.sql<{ instagram_access_token: string; instagram_username: string }>("select instagram_access_token, instagram_username from public.config where id = true");
    assert.equal(config.instagram_username, "ruthie");
    assert.match(config.instagram_access_token, /^IGAA-TESTE-RENOVADO-/);
  });
});
