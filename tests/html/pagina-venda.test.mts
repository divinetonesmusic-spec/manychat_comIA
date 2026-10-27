import "../helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createTestDatabase, semBanco, type TestDatabase } from "../helpers/db.mjs";

/**
 * A página de venda do Molde (/v/<slug>, 0020) num Chromium de verdade, depois do build (next start): o HTML roda isolado (CSP
 * sandbox sem allow-same-origin: origem vazia, sem cookie nem armazenamento do UaiFlow, o fetch ao painel não leva o login), os
 * scripts e formulários funcionam, o link de checkout com target=_blank abre numa aba normal, o toque num link leva a página
 * inteira ao checkout e o link rastreado /l/<código> conta o clique e leva ao destino.
 *
 * O Playwright não é dependência do UaiFlow: o teste usa o que achar (PLAYWRIGHT_DIR, NODE_PATH ou /opt/node-tools) e o Chromium de
 * PLAYWRIGHT_BROWSERS_PATH; sem eles, aparece como pulado. O checkout (https://pay.exemplo.com) é respondido pelo navegador.
 */
const ROOT = process.cwd();
type Pagina = {
  goto(u: string): Promise<unknown>;
  url(): string;
  click(s: string): Promise<void>;
  textContent(s: string): Promise<string | null>;
  evaluate<T>(f: string): Promise<T>;
  waitForURL(u: RegExp | string, o?: Record<string, unknown>): Promise<void>;
  waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForEvent(e: "popup", o?: Record<string, unknown>): Promise<Pagina>;
  waitForLoadState(s?: string): Promise<void>;
  on(e: "request", f: (r: { url(): string }) => void): void;
};
type Rota = { request(): { url(): string }; fulfill(o: Record<string, unknown>): Promise<void>; abort(): Promise<void>; fallback(): Promise<void> };
type Contexto = { addCookies(c: Array<Record<string, unknown>>): Promise<void>; route(r: RegExp, f: (rota: Rota) => Promise<void> | void): Promise<void>; newPage(): Promise<Pagina>; close(): Promise<void> };
type Navegador = { newContext(o?: Record<string, unknown>): Promise<Contexto>; close(): Promise<void> };
type Playwright = { chromium: { launch(o?: Record<string, unknown>): Promise<Navegador> } };
function acharPlaywright(): Playwright | null {
  const pastas = [process.env.PLAYWRIGHT_DIR, ...(process.env.NODE_PATH || "").split(path.delimiter), path.join(ROOT, "node_modules"), "/opt/node-tools/node_modules"].filter(Boolean) as string[];
  for (const p of pastas) {
    try {
      return createRequire(path.join(p, "_.js"))("playwright") as Playwright;
    } catch {
      // tenta a próxima pasta
    }
  }
  return null;
}
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
const pw = acharPlaywright();
const semBuild = existsSync(path.join(ROOT, ".next", "BUILD_ID")) ? false : "sem build: rode npm run build antes do npm run test:html";
const motivo = semBanco || semBuild || (pw ? false : "sem o Playwright (PLAYWRIGHT_DIR=<pasta node_modules com o playwright>)");
const PORT = 3990 + (process.pid % 40);
const BASE = `http://127.0.0.1:${PORT}`;
const CHECKOUT = "https://pay.exemplo.com/oracao";

const HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Oração da manhã</title></head><body>
<h1 id="t">Oração da manhã</h1>
<p id="js">sem script</p>
<p id="origem"></p>
<p id="painel">?</p>
<a id="novaaba" href="${CHECKOUT}?de=nova" target="_blank" rel="noopener">Comprar (nova aba)</a>
<a id="mesma" href="${CHECKOUT}?de=mesma">Comprar</a>
<a id="rastreado" href="/l/abc1234?de=bio">Comprar pelo link</a>
<form id="f" action="${CHECKOUT}" method="get"><input name="email" value="ana@exemplo.com"><button id="enviar">Quero</button></form>
<script>
  document.getElementById("js").textContent = "script rodou";
  var o = [];
  try { o.push("origin=" + self.origin); } catch (e) { o.push("origin=erro"); }
  try { o.push("cookie=" + document.cookie); } catch (e) { o.push("cookie=bloqueado"); }
  try { localStorage.setItem("x", "1"); o.push("storage=ok"); } catch (e) { o.push("storage=bloqueado"); }
  document.getElementById("origem").textContent = o.join(" ");
  fetch("/api/molde/paginas?molde=birdie", { credentials: "include" }).then(function (r) { document.getElementById("painel").textContent = "painel=" + r.status; }, function () { document.getElementById("painel").textContent = "painel=bloqueado"; });
</script></body></html>`;

describe("a página de venda no navegador (/v/<slug>, isolada)", { skip: motivo }, () => {
  let db: TestDatabase;
  let server: ChildProcess;
  let browser: Navegador;
  let linkId = "";
  const logs: string[] = [];

  before(async () => {
    db = await createTestDatabase();
    await db.sql(`insert into public.molde_paginas (molde, slug, titulo, armazenamento, html, tamanho, publicada, publicada_em)
                  values ('birdie', 'oracao-da-manha', 'Oração da manhã', 'banco', $1, $2, true, now())`, [HTML, Buffer.byteLength(HTML)]);
    const [l] = await db.sql<{ id: string }>(`insert into public.tracked_links (slug, external_ref, destination_url) values ('abc1234', 'reel-1', $1) returning id`, [`${CHECKOUT}?de=link`]);
    linkId = l.id;
    server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT), "-H", "127.0.0.1"], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: db.url, APP_BASE_URL: BASE, NODE_OPTIONS: `--require ${path.join(ROOT, "tests", "html", "bloquear-rede.cjs")}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (c) => logs.push(String(c)));
    server.stderr?.on("data", (c) => logs.push(String(c)));
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${BASE}/login`)).status < 500) break;
      } catch {
        // ainda subindo
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    browser = await (pw as Playwright).chromium.launch();
  });

  after(async () => {
    await browser?.close();
    server?.kill("SIGTERM");
    await db?.close();
  });

  async function contexto() {
    const ctx = await browser.newContext({ locale: "pt-BR" });
    // um cookie de sessão do painel no mesmo endereço: a página de venda não pode ler nem usar
    await ctx.addCookies([{ name: "uaiflow_admin", value: "sessao-secreta-do-painel", domain: "127.0.0.1", path: "/", sameSite: "Lax" }]);
    await ctx.route(/^https:\/\/pay\.exemplo\.com\//, (rota) => rota.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Checkout</title><h1>Checkout</h1>" }));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|pay\.exemplo\.com)/, (rota) => rota.abort());
    return ctx;
  }

  test("os cabeçalhos: sandbox sem allow-same-origin, nosniff, sem iframe", async () => {
    const r = await fetch(`${BASE}/v/oracao-da-manha`);
    assert.equal(r.status, 200, logs.join(""));
    const csp = String(r.headers.get("content-security-policy"));
    assert.match(csp, /sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation/);
    assert.doesNotMatch(csp, /allow-same-origin/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    const n = await fetch(`${BASE}/v/nao-existe`);
    assert.equal(n.status, 404);
    assert.match(await n.text(), /Página não encontrada/);
  });

  test("isolada: o script roda, mas com origem vazia, sem o cookie, sem armazenamento e sem o login do painel", async () => {
    const ctx = await contexto();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/v/oracao-da-manha`);
    assert.equal(await page.textContent("#js"), "script rodou");
    const origem = String(await page.textContent("#origem"));
    assert.match(origem, /origin=null/);
    assert.doesNotMatch(origem, /sessao-secreta/);
    assert.match(origem, /storage=bloqueado/);
    await page.waitForSelector("#painel:not(:text('?'))", { timeout: 5000 }).catch(() => undefined);
    // o fetch ao UaiFlow sai sem a sessão (origem diferente): ou é bloqueado (CORS), ou responde sem login
    assert.doesNotMatch(String(await page.textContent("#painel")), /painel=200/);
    await ctx.close();
  });

  test("o checkout abre: nova aba normal (fora do isolamento), na mesma aba pelo toque, e pelo formulário", async () => {
    const ctx = await contexto();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/v/oracao-da-manha`);
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.click("#novaaba")]);
    await popup.waitForLoadState();
    assert.match(popup.url(), /^https:\/\/pay\.exemplo\.com\/oracao\?de=nova/);
    assert.equal(await popup.evaluate<string>("self.origin"), "https://pay.exemplo.com", "a aba do checkout não herda o isolamento");
    await page.click("#mesma");
    await page.waitForURL(/pay\.exemplo\.com\/oracao\?de=mesma/);
    await page.goto(`${BASE}/v/oracao-da-manha`);
    await page.click("#enviar");
    await page.waitForURL(/pay\.exemplo\.com\/oracao\?email=/);
    await ctx.close();
  });

  test("o link rastreado /l/<código> conta o clique e leva ao checkout", async () => {
    const ctx = await contexto();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/v/oracao-da-manha`);
    // o Playwright não intercepta o destino de um redirecionamento: confere que o navegador PEDIU o checkout depois do /l/
    const pedidos: string[] = [];
    page.on("request", (r) => pedidos.push(r.url()));
    await page.click("#rastreado");
    const ate = Date.now() + 10_000;
    while (Date.now() < ate && !pedidos.some((u) => u.startsWith(`${CHECKOUT}?de=link`))) await new Promise((r) => setTimeout(r, 100));
    assert.ok(pedidos.some((u) => u === `${BASE}/l/abc1234?de=bio`), pedidos.join("\n"));
    assert.ok(pedidos.some((u) => u.startsWith(`${CHECKOUT}?de=link`)), pedidos.join("\n"));
    const cliques = await db.sql<{ origin: string }>("select origin from public.link_clicks where link_id = $1", [linkId]);
    assert.deepEqual(cliques.map((c) => c.origin), ["bio"]);
    await ctx.close();
  });
});
