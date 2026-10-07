import "./helpers/env.mjs";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/**
 * U-SEG-02: login do Instagram protegido (state assinado, login só com sessão ou link assinado,
 * conectar conta nova não troca a padrão).
 */
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const oauth = await import("@/lib/oauth-state");
const loginRoute = await import("@/app/api/oauth/login/route");
const callbackRoute = await import("@/app/api/oauth/callback/route");
const adminCookie = createHash("sha256").update(`${process.env.ADMIN_SESSION_SECRET}:uaiflow-admin-v1`).digest("hex");
const MINUTOS = 60_000;

function location(response: Response) {
  const value = response.headers.get("location");
  assert.ok(value, `sem redirecionamento (status ${response.status})`);
  return new URL(value);
}

describe("state e link assinados", () => {
  test("state válido é aceito e traz o caminho de volta", () => {
    const state = oauth.createOAuthState("/perfis?accountId=abc");
    assert.equal(oauth.verifyOAuthState(state)?.next, "/perfis?accountId=abc");
  });

  test("dois states seguidos são diferentes (nonce)", () => {
    assert.notEqual(oauth.createOAuthState("/perfis"), oauth.createOAuthState("/perfis"));
  });

  test("state adulterado é recusado", () => {
    const state = oauth.createOAuthState("/perfis");
    const [body, mac] = state.split(".");
    const outroCorpo = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), next: "/dashboard" })).toString("base64url");
    assert.equal(oauth.verifyOAuthState(`${outroCorpo}.${mac}`), null);
    assert.equal(oauth.verifyOAuthState(`${body}.${mac.slice(0, -2)}xx`), null);
    assert.equal(oauth.verifyOAuthState("/perfis"), null, "o state antigo (só o caminho) não vale mais");
    assert.equal(oauth.verifyOAuthState(null), null);
  });

  test("state vencido (mais de 30 min) é recusado", () => {
    const agora = Date.now();
    const state = oauth.createOAuthState("/perfis", agora);
    assert.ok(oauth.verifyOAuthState(state, agora + 29 * MINUTOS));
    assert.equal(oauth.verifyOAuthState(state, agora + 31 * MINUTOS), null);
  });

  test("state não serve como link de login, e vice-versa", () => {
    assert.equal(oauth.verifyLoginLinkToken(oauth.createOAuthState("/perfis")), null);
    assert.equal(oauth.verifyOAuthState(oauth.createLoginLinkToken("/perfis")), null);
  });

  test("caminho de fora dentro do token vira /perfis", () => {
    assert.equal(oauth.verifyOAuthState(oauth.createOAuthState("//evil.example"))?.next, "/perfis");
  });
});

describe("U-SEG-02: /api/oauth/login", () => {
  beforeEach(() => meta.reset());

  test("sem sessão e sem link assinado → /login", async () => {
    const response = await loginRoute.GET(request("/api/oauth/login?next=%2Fperfis"));
    const destino = location(response);
    assert.equal(destino.host, "uaiflow.teste");
    assert.equal(destino.pathname, "/login");
    assert.equal(destino.searchParams.get("next"), "/perfis");
    assert.equal(meta.calls.length, 0, "sem sessão, nem consulta o Supabase");
  });

  test("com link assinado vencido ou adulterado → /login com aviso", async () => {
    const vencido = oauth.createLoginLinkToken("/perfis", Date.now() - 31 * MINUTOS);
    for (const t of [vencido, "lixo.lixo"]) {
      const destino = location(await loginRoute.GET(request(`/api/oauth/login?t=${encodeURIComponent(t)}`)));
      assert.equal(destino.pathname, "/login");
      assert.equal(destino.searchParams.get("error"), "expired");
    }
  });

  test("com link assinado válido (outro navegador, sem sessão) → Instagram, com state assinado", async () => {
    const t = oauth.createLoginLinkToken("/perfis?accountId=abc");
    const destino = location(await loginRoute.GET(request(`/api/oauth/login?t=${encodeURIComponent(t)}`)));
    assert.equal(`${destino.origin}${destino.pathname}`, "https://www.instagram.com/oauth/authorize");
    assert.equal(destino.searchParams.get("client_id"), process.env.INSTAGRAM_APP_ID);
    assert.equal(oauth.verifyOAuthState(destino.searchParams.get("state"))?.next, "/perfis?accountId=abc");
    assert.equal(meta.calls.length, 0, "nenhuma chamada externa");
  });

  test("com sessão do UaiFlow (cookie de administrador) → Instagram", async () => {
    const response = await loginRoute.GET(request("/api/oauth/login?next=%2Fperfis", { cookies: { admin_session: adminCookie } }));
    const destino = location(response);
    assert.equal(destino.host, "www.instagram.com");
    assert.equal(oauth.verifyOAuthState(destino.searchParams.get("state"))?.next, "/perfis");
  });
});

describe("U-SEG-02: /api/oauth/callback recusa state inválido", () => {
  beforeEach(() => meta.reset());

  for (const [nome, state] of [
    ["sem state", ""],
    ["state antigo (só o caminho)", "/perfis"],
    ["state vencido", oauth.createOAuthState("/perfis", Date.now() - 31 * MINUTOS)],
    ["state de outro tipo (link de login)", oauth.createLoginLinkToken("/perfis")],
  ] as const) {
    test(`${nome}: não troca o código e volta para /perfis com erro em português`, async () => {
      const response = await callbackRoute.GET(request(`/api/oauth/callback?code=codigo-roubado&state=${encodeURIComponent(state)}`));
      const destino = location(response);
      assert.equal(destino.host, "uaiflow.teste");
      assert.equal(destino.pathname, "/perfis");
      assert.match(destino.searchParams.get("instagram_error") ?? "", /link de conexão/);
      assert.equal(meta.calls.length, 0, "não chamou a Meta");
    });
  }
});

describe("U-SEG-02: conectar conta pelo callback (com banco)", { skip: semBanco }, () => {
  after(async () => {
    meta.restore();
    await db?.close();
  });

  beforeEach(async () => {
    meta.reset();
    await db!.sql("delete from public.instagram_accounts");
  });

  test("state válido: troca o código, salva a conta e volta para o caminho certo", async () => {
    meta.profile = { user_id: "3001", username: "primeira_conta" };
    const state = oauth.createOAuthState("/perfis?accountId=x");
    const destino = location(await callbackRoute.GET(request(`/api/oauth/callback?code=ok&state=${encodeURIComponent(state)}`)));
    assert.equal(destino.pathname, "/perfis");
    assert.equal(destino.searchParams.get("accountId"), "x");
    assert.equal(destino.searchParams.get("instagram_connected"), "1");
    const contas = await db!.sql<{ instagram_username: string; is_default: boolean }>("select instagram_username, is_default from public.instagram_accounts");
    assert.deepEqual(contas, [{ instagram_username: "primeira_conta", is_default: true }], "a primeira conta vira a padrão");
  });

  test("conectar a 2ª conta não tira a conta padrão atual", async () => {
    await seedAccount(db!, { username: "ruthie", userId: "1001", isDefault: true });
    meta.profile = { user_id: "1002", username: "payoff" };
    const state = oauth.createOAuthState("/perfis");
    await callbackRoute.GET(request(`/api/oauth/callback?code=ok&state=${encodeURIComponent(state)}`));

    const contas = await db!.sql<{ instagram_username: string; is_default: boolean }>("select instagram_username, is_default from public.instagram_accounts order by instagram_username");
    assert.deepEqual(contas, [
      { instagram_username: "payoff", is_default: false },
      { instagram_username: "ruthie", is_default: true },
    ]);
    const [config] = await db!.sql<{ instagram_username: string | null }>("select instagram_username from public.config where id = true");
    assert.notEqual(config.instagram_username, "payoff", "o espelho da conta padrão não muda para a conta nova");
  });

  test("reconectar a conta padrão mantém ela como padrão", async () => {
    await seedAccount(db!, { username: "ruthie", userId: "1001", isDefault: true });
    await seedAccount(db!, { username: "payoff", userId: "1002", isDefault: false });
    meta.profile = { user_id: "1001", username: "ruthie" };
    await callbackRoute.GET(request(`/api/oauth/callback?code=ok&state=${encodeURIComponent(oauth.createOAuthState("/perfis"))}`));
    const contas = await db!.sql<{ instagram_username: string; is_default: boolean; instagram_access_token: string }>(
      "select instagram_username, is_default, instagram_access_token from public.instagram_accounts order by instagram_username",
    );
    assert.deepEqual(contas.map((conta) => [conta.instagram_username, conta.is_default]), [["payoff", false], ["ruthie", true]]);
    assert.match(contas[1].instagram_access_token, /^IGAA-TESTE-LONGO-/, "token novo salvo");
  });
});
