import "../helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createTestDatabase, semBanco, type TestDatabase } from "../helpers/db.mjs";

/**
 * A contagem de visitas (Umami Cloud, v134), depois do build: com UMAMI_WEBSITE_ID no ambiente, o quiz público (/q/<slug>)
 * leva o script do Umami com o id do site; as telas do painel (fora de /q, /e e /p) não levam.
 */
const ROOT = process.cwd();
const semBuild = existsSync(path.join(ROOT, ".next", "BUILD_ID")) ? false : "sem build: rode npm run build antes do npm run test:html";
const motivo = semBanco || semBuild;
const PORT = 3950 + (process.pid % 40);
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = "94db1cb1-74f4-4a40-ad6c-962362670409";

describe("depois do build: o script do Umami nas páginas públicas (v134)", { skip: motivo }, () => {
  let db: TestDatabase;
  let server: ChildProcess;
  const logs: string[] = [];

  before(async () => {
    db = await createTestDatabase();
    server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT), "-H", "127.0.0.1"], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: db.url, UMAMI_WEBSITE_ID: SITE, NODE_OPTIONS: `--require ${path.join(ROOT, "tests", "html", "bloquear-rede.cjs")}` },
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

  test("/q/<slug> leva o script do Umami com o id do site; o /login não leva", async () => {
    const op = (texto: string, pesos: Record<string, number>) => ({ texto, pesos });
    const quiz = {
      titulo: "Quiz das visitas",
      idioma: "pt-BR",
      perfis: [
        { id: "a", nome: "Perfil A", causa: "Causa A.", projecao: "x", oferta: { nome: "A", preco: 7 } },
        { id: "b", nome: "Perfil B", causa: "Causa B.", projecao: "y", oferta: { nome: "B", preco: 7 } },
      ],
      perguntas: [1, 2, 3, 4].map((n) => ({ texto: `Pergunta ${n}?`, tipo: "botoes", opcoes: [op("Sim", { a: 2 }), op("Não", { b: 2 })] })),
      provaSocial: { tipo: "como", passos: ["Responda", "Veja", "Receba"] },
    };
    const criado = await fetch(`${BASE}/api/molde/quiz`, { method: "POST", headers: { "content-type": "application/json", "x-molde-token": process.env.MOLDE_API_TOKEN as string }, body: JSON.stringify({ molde: "proj-1", quiz }) });
    assert.equal(criado.status, 201, await criado.clone().text());
    const { data } = (await criado.json()) as { data: { slug: string } };
    const html = await (await fetch(`${BASE}/q/${data.slug}`)).text();
    assert.match(html, /cloud\.umami\.is\/script\.js/);
    assert.ok(html.includes(SITE), "o id do site vai junto do script");
    const login = await (await fetch(`${BASE}/login`)).text();
    assert.doesNotMatch(login, /umami/i, "fora das páginas públicas, nada");
  });
});
