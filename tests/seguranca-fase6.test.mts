import "./helpers/env.mjs";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { request } from "./helpers/http.mjs";

/** Fase 6 · Segurança: cadastro fechado, ALLOWED_EMAILS obrigatório em produção, sessão de administrador e segredos. */
// O banco vem antes de qualquer módulo do app (o pool lê DATABASE_URL ao carregar).
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const auth = await import("@/lib/auth");
const { proxy } = await import("@/proxy");
const DIA = 86_400_000;
const SENHA = "senha-de-admin-de-teste-123";

function location(response: Response) {
  const value = response.headers.get("location");
  assert.ok(value, `sem redirecionamento (status ${response.status})`);
  return new URL(value);
}

/** Troca variáveis só durante o teste (NODE_ENV inclusive) e devolve como estavam. */
function comAmbiente(valores: Record<string, string | undefined>) {
  const antes: Record<string, string | undefined> = {};
  const env = process.env as Record<string, string | undefined>;
  for (const [nome, valor] of Object.entries(valores)) {
    antes[nome] = env[nome];
    if (valor === undefined) delete env[nome];
    else env[nome] = valor;
  }
  return () => {
    for (const [nome, valor] of Object.entries(antes)) {
      if (valor === undefined) delete env[nome];
      else env[nome] = valor;
    }
  };
}

after(async () => {
  await db?.close();
});

describe("1a · cadastro fechado", () => {
  test("/cadastro (e qualquer coisa abaixo) leva para /login, mesmo sem sessão", async () => {
    for (const caminho of ["/cadastro", "/cadastro/", "/cadastro?x=1"]) {
      const response = await proxy(request(caminho));
      assert.equal(response.status, 307, caminho);
      const destino = location(response);
      assert.equal(destino.pathname, "/login", caminho);
      assert.equal(destino.searchParams.get("next"), null, `${caminho}: não guarda o cadastro como volta`);
    }
  });

  test("/login continua aberto", async () => {
    const response = await proxy(request("/login"));
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
});

describe("1b · ALLOWED_EMAILS", () => {
  let restaurar: () => void = () => undefined;
  afterEach(() => restaurar());

  test("em produção, lista vazia: ninguém entra pelo Supabase", () => {
    restaurar = comAmbiente({ NODE_ENV: "production", ALLOWED_EMAILS: undefined });
    assert.equal(auth.isAllowedEmail("dono@exemplo.com"), false);
    assert.equal(auth.isAllowedEmail(null), false);
    restaurar();
    restaurar = comAmbiente({ NODE_ENV: "production", ALLOWED_EMAILS: " , " });
    assert.equal(auth.isAllowedEmail("dono@exemplo.com"), false, "só vírgulas e espaços também é lista vazia");
  });

  test("em produção, com a lista: só quem está nela (sem diferença de maiúsculas)", () => {
    restaurar = comAmbiente({ NODE_ENV: "production", ALLOWED_EMAILS: "Dono@Exemplo.com, outra@exemplo.com" });
    assert.equal(auth.isAllowedEmail("dono@exemplo.com"), true);
    assert.equal(auth.isAllowedEmail("OUTRA@exemplo.com"), true);
    assert.equal(auth.isAllowedEmail("intrusa@exemplo.com"), false);
    assert.equal(auth.isAllowedEmail(undefined), false);
  });

  test("fora de produção, lista vazia continua deixando entrar (como antes)", () => {
    restaurar = comAmbiente({ NODE_ENV: "test", ALLOWED_EMAILS: undefined });
    assert.equal(auth.isAllowedEmail("qualquer@exemplo.com"), true);
  });

  test("npm run setup:check avisa quando ALLOWED_EMAILS está vazio", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, ALLOWED_EMAILS: "" };
    const resultado = spawnSync(process.execPath, ["scripts/check-env.cjs"], { env, encoding: "utf8", cwd: process.cwd() });
    assert.match(resultado.stderr, /ALLOWED_EMAILS está vazio/);
    assert.match(resultado.stderr, /só a senha de administrador/);
    const comLista = spawnSync(process.execPath, ["scripts/check-env.cjs"], { env: { ...env, ALLOWED_EMAILS: "dono@exemplo.com" }, encoding: "utf8", cwd: process.cwd() });
    assert.doesNotMatch(comLista.stderr, /ALLOWED_EMAILS/);
  });

  test(".env.example traz ALLOWED_EMAILS (o release:check confere)", async () => {
    const { readFileSync } = await import("node:fs");
    assert.match(readFileSync(".env.example", "utf8"), /^ALLOWED_EMAILS=/m);
    assert.match(readFileSync("scripts/release-check.cjs", "utf8"), /"ALLOWED_EMAILS"/);
  });
});

describe("1c · sessão de administrador conferida no servidor", () => {
  let restaurar: () => void = () => undefined;
  afterEach(() => restaurar());

  test("cookie novo vale; o formato antigo (hash fixo do segredo) não vale mais", () => {
    const valor = auth.createAdminSessionValue() as string;
    assert.match(valor, /^\d+\.[A-Za-z0-9_-]+$/);
    assert.equal(auth.isValidAdminSession(valor), true);
    const antigo = createHash("sha256").update(`${process.env.ADMIN_SESSION_SECRET}:uaiflow-admin-v1`).digest("hex");
    assert.equal(auth.isValidAdminSession(antigo), false);
    assert.equal(auth.isValidAdminSession(""), false);
    assert.equal(auth.isValidAdminSession(undefined), false);
  });

  test("vence em 30 dias (conferido no servidor) e não aceita data do futuro", () => {
    const agora = Date.now();
    const valor = auth.createAdminSessionValue(agora - 29 * DIA) as string;
    assert.equal(auth.isValidAdminSession(valor, agora), true, "29 dias: ainda vale");
    assert.equal(auth.isValidAdminSession(auth.createAdminSessionValue(agora - 31 * DIA) as string, agora), false, "31 dias: venceu");
    assert.equal(auth.isValidAdminSession(auth.createAdminSessionValue(agora + DIA) as string, agora), false, "emitido amanhã: falso");
  });

  test("mexer na data ou na assinatura derruba; trocar o segredo derruba todas as sessões", () => {
    const valor = auth.createAdminSessionValue() as string;
    const [emitido, assinatura] = valor.split(".");
    assert.equal(auth.isValidAdminSession(`${Number(emitido) + 1000}.${assinatura}`), false, "data trocada");
    assert.equal(auth.isValidAdminSession(`${emitido}.${assinatura.slice(0, -2)}xx`), false, "assinatura trocada");
    assert.equal(auth.isValidAdminSession(`${valor}.a`), false, "pedaço a mais");
    restaurar = comAmbiente({ ADMIN_SESSION_SECRET: "outro-segredo-da-sessao-com-mais-de-32-caracteres" });
    assert.equal(auth.isValidAdminSession(valor), false);
  });

  test("em produção sem segredo: não cria nem aceita sessão", () => {
    const valor = auth.createAdminSessionValue() as string;
    restaurar = comAmbiente({ NODE_ENV: "production", ADMIN_SESSION_SECRET: undefined, WORKER_SECRET: undefined });
    assert.equal(auth.createAdminSessionValue(), null);
    assert.equal(auth.isValidAdminSession(valor), false);
  });

  test("o proxy aceita o cookie novo e recusa o antigo e o vencido", async () => {
    const valido = await proxy(request("/dashboard", { cookies: { admin_session: auth.createAdminSessionValue() as string } }));
    assert.equal(valido.headers.get("x-middleware-next"), "1");

    const antigo = createHash("sha256").update(`${process.env.ADMIN_SESSION_SECRET}:uaiflow-admin-v1`).digest("hex");
    for (const cookie of [antigo, auth.createAdminSessionValue(Date.now() - 31 * DIA) as string]) {
      const response = await proxy(request("/dashboard", { cookies: { admin_session: cookie } }));
      assert.equal(location(response).pathname, "/login");
      const api = await proxy(request("/api/content", { cookies: { admin_session: cookie } }));
      assert.equal(api.status, 401);
    }
  });

  test("senha de administrador: comparação em tempo constante, mínimo de 12 caracteres", () => {
    restaurar = comAmbiente({ ADMIN_PASSWORD: SENHA });
    assert.equal(auth.isValidAdminPassword(SENHA), true);
    assert.equal(auth.isValidAdminPassword(`${SENHA} `), false);
    assert.equal(auth.isValidAdminPassword(""), false);
    restaurar();
    restaurar = comAmbiente({ ADMIN_PASSWORD: "curta" });
    assert.equal(auth.isValidAdminPassword("curta"), false);
  });

  test("auth.ts não compara senha nem cookie com === (U-SEG da Fase 6)", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/lib/auth.ts", "utf8");
    assert.ok(!/password === expected/.test(fonte));
    assert.ok(fonte.includes("timingSafeEqual"));
  });
});

describe("1d · segredos comparados em tempo constante", () => {
  test("o relógio, a renovação e a verificação do webhook usam safeEqualSecret", async () => {
    const { readFileSync } = await import("node:fs");
    for (const arquivo of ["src/app/api/queue/drain/route.ts", "src/app/api/token/refresh/route.ts", "src/app/api/webhook/route.ts"]) {
      const fonte = readFileSync(arquivo, "utf8");
      assert.ok(fonte.includes("safeEqualSecret("), arquivo);
      assert.ok(!/providedSecret !== expected|token === process\.env\.WEBHOOK_VERIFY_TOKEN/.test(fonte), arquivo);
    }
  });

  test("safeEqualSecret: igual, diferente, tamanhos diferentes e vazio", async () => {
    const { safeEqualSecret } = await import("@/lib/secrets");
    assert.equal(safeEqualSecret("abc", "abc"), true);
    assert.equal(safeEqualSecret("abc", "abd"), false);
    assert.equal(safeEqualSecret("abc", "abcdef"), false);
    assert.equal(safeEqualSecret("", ""), false);
    assert.equal(safeEqualSecret(null, "abc"), false);
    assert.equal(safeEqualSecret("abc", undefined), false);
  });

  test("relógio: segredo errado 401; sem segredo 401", async () => {
    const route = await import("@/app/api/queue/drain/route");
    assert.equal((await route.POST(request("/api/queue/drain", { method: "POST", headers: { "x-worker-secret": "errado" } }))).status, 401);
    assert.equal((await route.POST(request("/api/queue/drain", { method: "POST" }))).status, 401);
    const refresh = await import("@/app/api/token/refresh/route");
    assert.equal((await refresh.POST(request("/api/token/refresh", { method: "POST", headers: { "x-worker-secret": `${process.env.WORKER_SECRET}x` } }))).status, 401);
  });

  test("webhook: verificação da Meta só com o token certo", async () => {
    const restaurar = comAmbiente({ WEBHOOK_VERIFY_TOKEN: "token-de-verificacao-do-webhook-de-teste" });
    try {
      const webhook = await import("@/app/api/webhook/route");
      const certo = await webhook.GET(request("/api/webhook?hub.mode=subscribe&hub.verify_token=token-de-verificacao-do-webhook-de-teste&hub.challenge=42"));
      assert.equal(certo.status, 200);
      assert.equal(await certo.text(), "42");
      const errado = await webhook.GET(request("/api/webhook?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=42"));
      assert.equal(errado.status, 403);
    } finally {
      restaurar();
    }
  });
});

describe("1c · limite de 5 senhas erradas por endereço em 15 minutos (com a 0007)", { skip: semBanco }, () => {
  let login: typeof import("@/app/api/admin/login/route");
  let restaurar: () => void = () => undefined;

  before(async () => {
    login = await import("@/app/api/admin/login/route");
  });
  beforeEach(async () => {
    restaurar = comAmbiente({ ADMIN_PASSWORD: SENHA });
    await db!.sql("delete from public.admin_login_attempts");
  });
  afterEach(() => restaurar());

  function entrar(senha: string, ip = "203.0.113.7") {
    return login.POST(request("/api/admin/login", { form: { password: senha, next: "/perfis" }, headers: { "x-nf-client-connection-ip": ip } }));
  }

  test("senha certa: entra, o cookie vale 30 dias e é aceito pelo servidor", async () => {
    const response = await entrar(SENHA);
    assert.equal(location(response).pathname, "/perfis");
    const cookie = response.cookies.get("admin_session");
    assert.ok(cookie?.value);
    assert.equal(cookie.maxAge, 60 * 60 * 24 * 30);
    assert.equal(cookie.httpOnly, true);
    assert.equal(auth.isValidAdminSession(cookie.value), true);
  });

  test("5 erradas bloqueiam o endereço (até a senha certa); outro endereço continua entrando", async () => {
    for (let i = 0; i < 5; i += 1) {
      const errada = await entrar("senha-errada-qualquer");
      assert.equal(location(errada).searchParams.get("error"), "1", `tentativa ${i + 1}`);
    }
    const bloqueada = await entrar(SENHA);
    assert.equal(location(bloqueada).searchParams.get("error"), "bloqueado");
    assert.equal(bloqueada.cookies.get("admin_session"), undefined, "bloqueado não ganha sessão");

    const outro = await entrar(SENHA, "198.51.100.20");
    assert.equal(location(outro).pathname, "/perfis");

    const linhas = await db!.sql<{ ip_hash: string }>("select ip_hash from public.admin_login_attempts");
    assert.equal(linhas.length, 5);
    assert.ok(linhas.every((linha) => /^[0-9a-f]{64}$/.test(linha.ip_hash) && !linha.ip_hash.includes("203.0.113.7")), "guarda só o hash");
  });

  test("tentativas de mais de 15 minutos não contam", async () => {
    for (let i = 0; i < 5; i += 1) await entrar("senha-errada-qualquer");
    await db!.sql("update public.admin_login_attempts set attempted_at = now() - interval '16 minutes'");
    assert.equal(location(await entrar(SENHA)).pathname, "/perfis");
  });

  test("entrar certo esquece as erradas daquele endereço", async () => {
    for (let i = 0; i < 4; i += 1) await entrar("senha-errada-qualquer");
    assert.equal(location(await entrar(SENHA)).pathname, "/perfis");
    assert.equal((await db!.sql("select 1 from public.admin_login_attempts")).length, 0);
    for (let i = 0; i < 4; i += 1) await entrar("senha-errada-qualquer");
    assert.equal(location(await entrar(SENHA)).pathname, "/perfis", "conta do zero depois de entrar");
  });

  test("sem x-nf-client-connection-ip, usa o 1º endereço de x-forwarded-for", async () => {
    const pedir = (senha: string) => login.POST(request("/api/admin/login", { form: { password: senha }, headers: { "x-forwarded-for": "192.0.2.1, 10.0.0.1" } }));
    for (let i = 0; i < 5; i += 1) await pedir("senha-errada-qualquer");
    assert.equal(location(await pedir(SENHA)).searchParams.get("error"), "bloqueado");
  });
});
