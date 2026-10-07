import "../helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { createTestDatabase, semBanco, type TestDatabase } from "../helpers/db.mjs";
import { seedAccount } from "../helpers/seed.mjs";

/**
 * U-SEG-01, verificação de ponta a ponta: sobe o UaiFlow já compilado (`next start`) com contas falsas
 * cujo token é IGAA-TESTE-VAZOU-..., abre as telas como administrador e procura o token no HTML que o
 * navegador recebe (inclui os dados dos componentes "use client", que vão embutidos na página).
 * Rode depois do `npm run build`: npm run test:html (precisa de TEST_DATABASE_URL).
 */
const ROOT = process.cwd();
const semBuild = existsSync(path.join(ROOT, ".next", "BUILD_ID")) ? false : "sem build: rode npm run build antes do npm run test:html";
const motivo = semBanco || semBuild;
const PORT = 3400 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = /IGAA-TESTE/;

describe("nenhum token do Instagram no HTML das telas", { skip: motivo }, () => {
  let db: TestDatabase;
  let server: ChildProcess;
  let cookie: string;
  let secondAccountId: string;
  let automationId: string;
  const logs: string[] = [];

  before(async () => {
    db = await createTestDatabase();
    await seedAccount(db, { username: "ruthie_teste", userId: "2001", token: "IGAA-TESTE-VAZOU-RUTHIE", isDefault: true });
    secondAccountId = await seedAccount(db, { username: "payoff_teste", userId: "2002", token: "IGAA-TESTE-VAZOU-PAYOFF", isDefault: false });
    await db.sql(
      `update public.config set instagram_access_token = 'IGAA-TESTE-VAZOU-CONFIG', instagram_user_id = '2001', instagram_username = 'ruthie_teste' where id = true`,
    );
    [{ id: automationId }] = await db.sql<{ id: string }>("insert into public.automations (account_id, name, keywords) values ($1, 'Fluxo de teste', array['EBOOK']) returning id", [secondAccountId]);

    const secret = process.env.ADMIN_SESSION_SECRET as string;
    cookie = `admin_session=${createHash("sha256").update(`${secret}:uaiflow-admin-v1`).digest("hex")}`;

    server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT), "-H", "127.0.0.1"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: db.url,
        NODE_OPTIONS: `--require ${path.join(ROOT, "tests", "html", "bloquear-rede.cjs")}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => logs.push(String(chunk)));
    server.stderr?.on("data", (chunk) => logs.push(String(chunk)));

    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${BASE}/login`);
        if (response.status < 500) return;
      } catch {
        // ainda subindo
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`O servidor não subiu a tempo.\n${logs.join("")}`);
  });

  after(async () => {
    server?.kill("SIGTERM");
    await db?.close();
  });

  const pages = [
    "/dashboard",
    "/conteudo",
    "/perfis",
    "/fluxos",
    "/automacoes",
    "/automacoes/nova",
    "/caixa-de-entrada",
    "/contatos",
    "/configuracoes",
  ];

  for (const page of pages) {
    test(`${page} (perfil padrão e segundo perfil)`, async () => {
      for (const url of [page, `${page}?accountId=${secondAccountId}`]) {
        const response = await fetch(`${BASE}${url}`, { headers: { cookie } });
        const html = await response.text();
        assert.equal(response.status, 200, `${url}: status ${response.status}\n${logs.join("").slice(-2000)}`);
        assert.match(html, /ruthie_teste/, `${url}: a tela não mostrou os dados de teste (o teste não valeria)`);
        assert.doesNotMatch(html, TOKEN, `${url}: o HTML traz um token do Instagram`);
      }
    });
  }

  test("/fluxos/[id]/editar", async () => {
    const response = await fetch(`${BASE}/fluxos/${automationId}/editar?accountId=${secondAccountId}`, { headers: { cookie } });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Fluxo de teste/);
    assert.doesNotMatch(html, TOKEN);
  });

  test("API de trocar o perfil principal (chamada pelo navegador)", async () => {
    const response = await fetch(`${BASE}/api/instagram-accounts/${secondAccountId}/default`, { method: "POST", headers: { cookie } });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(text, TOKEN);
  });
});
