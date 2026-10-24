import "../helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createTestDatabase, semBanco, type TestDatabase } from "../helpers/db.mjs";
import { seedAccount } from "../helpers/seed.mjs";

/**
 * Etapa U-SEG (v133), depois do build: o proxy de verdade (matcher compilado pelo Next) não deixa um endereço de /api
 * terminado em .png passar sem sessão, as imagens públicas continuam abertas e o login do Instagram grava o cookie do state.
 */
const ROOT = process.cwd();
const semBuild = existsSync(path.join(ROOT, ".next", "BUILD_ID")) ? false : "sem build: rode npm run build antes do npm run test:html";
const motivo = semBanco || semBuild;
const PORT = 3800 + (process.pid % 150);
const BASE = `http://127.0.0.1:${PORT}`;

describe("depois do build: proxy e login do Instagram (v133)", { skip: motivo }, () => {
  let db: TestDatabase;
  let server: ChildProcess;
  let cookie: string;
  const logs: string[] = [];

  before(async () => {
    db = await createTestDatabase();
    await seedAccount(db, { username: "ruthie_teste", userId: "2001", token: "IGAA-TESTE-VAZOU-RUTHIE", isDefault: true });
    cookie = `admin_session=${await (await import("@/lib/auth")).createAdminSessionValue()}`;
    server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT), "-H", "127.0.0.1"], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: db.url, NODE_OPTIONS: `--require ${path.join(ROOT, "tests", "html", "bloquear-rede.cjs")}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => logs.push(String(chunk)));
    server.stderr?.on("data", (chunk) => logs.push(String(chunk)));
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${BASE}/login`)).status < 500) return;
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

  test("/api/... terminado em .png sem sessão: 401 (antes passava sem conferir a sessão)", async () => {
    for (const caminho of ["/api/automations/x.png", "/api/content/qualquer.svg"]) {
      const response = await fetch(`${BASE}${caminho}`, { method: "DELETE", redirect: "manual" });
      assert.equal(response.status, 401, `${caminho}: ${response.status}`);
    }
  });

  test("ícones e imagens públicas continuam abertos sem login", async () => {
    for (const caminho of ["/icon.png", "/next.svg"]) {
      const response = await fetch(`${BASE}${caminho}`, { redirect: "manual" });
      assert.equal(response.status, 200, `${caminho}: ${response.status}`);
    }
  });

  test("login do Instagram: grava o cookie httpOnly do state e a volta sem ele é recusada", async () => {
    const inicio = await fetch(`${BASE}/api/oauth/login?next=%2Fperfis`, { headers: { cookie }, redirect: "manual" });
    const setCookie = inicio.headers.getSetCookie().find((linha) => linha.startsWith("uaiflow_ig_state=")) ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=lax/i);
    assert.match(setCookie, /Secure/i, "em produção o cookie é Secure");
    const state = new URL(inicio.headers.get("location") as string).searchParams.get("state") as string;
    const volta = await fetch(`${BASE}/api/oauth/callback?code=x&state=${encodeURIComponent(state)}`, { redirect: "manual" });
    assert.match(new URL(volta.headers.get("location") as string).searchParams.get("instagram_error") ?? "", /link de conexão/);
  });

  test("/configuracoes: o botão «Renovar a conexão» é um formulário POST (não um link GET)", async () => {
    const html = await (await fetch(`${BASE}/configuracoes`, { headers: { cookie } })).text();
    assert.match(html, /<form[^>]*method="post"[^>]*action="\/api\/token\/refresh"|<form[^>]*action="\/api\/token\/refresh"[^>]*method="post"/);
    assert.doesNotMatch(html, /href="\/api\/token\/refresh"/);
    assert.doesNotMatch(html, /IGAA-TESTE/);
  });
});
