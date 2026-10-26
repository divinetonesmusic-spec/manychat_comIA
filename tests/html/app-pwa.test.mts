import "../helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createTestDatabase, semBanco, type TestDatabase } from "../helpers/db.mjs";

/**
 * O app por assinatura (0018) num navegador de verdade, depois do build (next start), em 390×844 de toque: o manifest (nome, cores e
 * ícones da marca, instalável), o service worker no escopo do app, os áudios guardados no aparelho, a tela que abre SEM internet e
 * o áudio de teste que TOCA sem internet (o toque conta o dia depois, quando a internet volta); alvos de toque de 44 px e o
 * contraste AA (4,5:1; 3:1 na letra grande) de todo texto à vista, logado e no convite.
 *
 * O Playwright não é dependência do UaiFlow: o teste usa o que achar (PLAYWRIGHT_DIR, NODE_PATH ou o do Molde ao lado) e o Chromium
 * de PLAYWRIGHT_BROWSERS_PATH; sem eles, aparece como pulado. O R2 é o do navegador falso (a rota responde o áudio de teste).
 */
const ROOT = process.cwd();
/* o pedaço do Playwright que o teste usa (ele não é dependência do UaiFlow: os tipos ficam aqui) */
type Rota = { request(): { url(): string }; fulfill(o: Record<string, unknown>): Promise<void>; fallback(): Promise<void>; abort(): Promise<void> };
type Resposta = { json(): Promise<unknown>; body(): Promise<Buffer>; headers(): Record<string, string>; status(): number };
type Pagina = {
  goto(u: string): Promise<unknown>;
  reload(): Promise<unknown>;
  textContent(s: string): Promise<string | null>;
  getAttribute(s: string, a: string): Promise<string | null>;
  click(s: string): Promise<void>;
  $(s: string): Promise<unknown>;
  evaluate<T>(f: string | (() => T | Promise<T>)): Promise<T>;
  on(e: "console", f: (m: { text(): string }) => void): void;
  waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: () => boolean, a: null, o: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(n: number): Promise<void>;
  on(e: "pageerror", f: (e: Error) => void): void;
  request: { get(u: string): Promise<Resposta> };
};
type Contexto = { addCookies(c: Array<Record<string, unknown>>): Promise<void>; route(r: RegExp, f: (rota: Rota) => Promise<void> | void): Promise<void>; newPage(): Promise<Pagina>; setOffline(b: boolean): Promise<void>; close(): Promise<void> };
type Navegador = { newContext(o: Record<string, unknown>): Promise<Contexto>; close(): Promise<void> };
type Playwright = { chromium: { launch(o?: Record<string, unknown>): Promise<Navegador> } };
function acharPlaywright(): Playwright | null {
  const pastas = [process.env.PLAYWRIGHT_DIR, ...(process.env.NODE_PATH || "").split(path.delimiter), path.join(ROOT, "node_modules")].filter(Boolean) as string[];
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
const PORT = 3950 + (process.pid % 40);
const BASE = `http://127.0.0.1:${PORT}`;
const SLUG = "noites-calmas";

/** Um áudio WAV de teste (2 s, 8 kHz, mono): um tom baixo. */
function wav(segundos = 2, taxa = 8000) {
  const n = segundos * taxa, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(taxa, 24); buf.writeUInt32LE(taxa * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.round(Math.sin((i / taxa) * 2 * Math.PI * 220) * 6000), 44 + i * 2);
  return buf;
}

describe("o app por assinatura no navegador (PWA, 390×844)", { skip: motivo }, () => {
  let db: TestDatabase;
  let server: ChildProcess;
  let browser: Navegador;
  let sessao = "";
  let assinanteId = "";
  const logs: string[] = [];
  const AUDIO = wav();

  before(async () => {
    db = await createTestDatabase();
    const { lerApp } = await import("@/lib/app/pacote");
    const { resumo, novoCodigoApp } = await import("@/lib/db/apps");
    const dias = Array.from({ length: 30 }, (_, i) => ({ titulo: `Respirar devagar ${i + 1}`, fazer: "Deite, apague a luz e toque o áudio. Respire junto com a voz.", audio: i % 7 === 6 ? "som" : "respira", minutos: 8 }));
    const lido = lerApp({ app: {
      titulo: "Noites Calmas", nomeCurto: "Noites", promessa: "Uma rotina de 30 noites para desacelerar antes de dormir.", idioma: "pt-BR",
      marca: { nome: "Lua", cores: { fundo: "#12101A", texto: "#EFE9DD", suave: "#A9A1B8", primaria: "#D9B26A", textoPrimaria: "#12101A" } },
      dias, audios: [{ id: "respira", titulo: "Respiração 4-7-8", minutos: 8 }, { id: "som", titulo: "Som de chuva", minutos: 20 }],
      preco: { valor: 19.9, moeda: "BRL", porque: "x" }, checkout: "https://pay.hotmart.com/X123?src=MOAPPORIGEM", convite: "Toque uma vez por noite.",
      lembrete: { assunto: "Sua noite", texto: "A noite de hoje está pronta.", hora: 21 }, aviso: "Personagem criado com IA.",
    } });
    assert.ok(lido.ok);
    if (!lido.ok) return;
    const audios = { respira: { key: "uaiflow/apps/t/respira.wav", size: AUDIO.length, contentType: "audio/wav" }, som: { key: "uaiflow/apps/t/som.wav", size: AUDIO.length, contentType: "audio/wav" } };
    const [app] = await db.sql(`insert into public.apps (molde, slug, titulo, pacote, audios, ativo, versao, publicado_em) values ('proj-1', $1, 'Noites Calmas', $2::jsonb, $3::jsonb, true, 2, now()) returning id`, [SLUG, JSON.stringify(lido.app), JSON.stringify(audios)]);
    const [pessoa] = await db.sql(`insert into public.app_assinantes (app_id, email, acesso_ate, sair_codigo) values ($1, 'ana@exemplo.com', now() + interval '30 days', $2) returning id`, [app.id, novoCodigoApp(24)]);
    assinanteId = pessoa.id;
    for (let i = 1; i <= 3; i += 1) await db.sql(`insert into public.app_uso (assinante_id, dia) values ($1, ((now() at time zone 'America/Sao_Paulo')::date - $2::int))`, [assinanteId, i]);
    sessao = novoCodigoApp(40);
    await db.sql(`insert into public.app_acessos (assinante_id, tipo, hash, expira_em) values ($1, 'sessao', $2, now() + interval '1 day')`, [assinanteId, resumo(sessao)]);
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

  async function contexto(comSessao: boolean) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR", timezoneId: "America/Sao_Paulo", reducedMotion: "reduce" });
    if (comSessao) await ctx.addCookies([{ name: "uf_a_noites_calmas", value: sessao, domain: "127.0.0.1", path: `/a/${SLUG}`, httpOnly: true, sameSite: "Lax" }]);
    // o R2: o link assinado responde o áudio de teste (com o CORS que o balde tem para o endereço do UaiFlow)
    await ctx.route(/r2\.cloudflarestorage\.com/, (rota) => rota.fulfill({ status: 200, body: AUDIO, headers: { "content-type": "audio/wav", "access-control-allow-origin": BASE } }));
    // nada mais sai para a internet
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (rota) => (/r2\.cloudflarestorage\.com/.test(rota.request().url()) ? rota.fallback() : rota.abort()));
    return ctx;
  }

  /**
   * Alvos de toque abaixo de 44 px e textos com contraste abaixo do AA, de tudo o que está à vista. Vai como texto (não como função):
   * o tsx renomeia as funções de dentro (__name) e o navegador não conhece esse ajudante.
   */
  const MEDIR = `(() => {
    const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).opacity !== "0";
    const alvos = [...document.querySelectorAll("button, a, input:not([type=hidden]), select, summary, label.fu-ck")].filter((e) => vis(e) && !e.closest(".fu-escondido"));
    const pequenos = alvos.filter((e) => !(e.tagName === "INPUT" && e.type === "checkbox"))
      .map((e) => ({ t: (e.textContent || e.name || e.tagName).trim().slice(0, 30), r: e.getBoundingClientRect() }))
      .filter((x) => x.r.height < 44 || x.r.width < 44).map((x) => x.t + " " + Math.round(x.r.width) + "x" + Math.round(x.r.height));
    const rgb = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    const fundo = (e) => { for (let x = e; x; x = x.parentElement) { const b = rgb(getComputedStyle(x).backgroundColor); if (b.length >= 3 && (b.length < 4 || b[3] > 0.5)) return b; } return [255, 255, 255]; };
    const baixos = [];
    for (const e of [...document.querySelectorAll("body *")].filter((e) => vis(e) && [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim()))) {
      const cs = getComputedStyle(e), a = lum(rgb(cs.color)), b = lum(fundo(e));
      const razao = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), tam = parseFloat(cs.fontSize), negrito = Number(cs.fontWeight) >= 700;
      if (razao < (tam >= 24 || (tam >= 18.66 && negrito) ? 3 : 4.5)) baixos.push((e.textContent || "").trim().slice(0, 30) + " " + razao.toFixed(2));
    }
    return { pequenos, baixos, transborda: document.scrollingElement.scrollWidth > innerWidth + 1 };
  })()`;
  async function medir(page: Pagina) {
    return page.evaluate<{ pequenos: string[]; baixos: string[]; transborda: boolean }>(MEDIR);
  }

  test("logado: a Noite 4 de 30, o manifest instalável, o service worker, os áudios guardados e o áudio tocando SEM internet", async () => {
    const ctx = await contexto(true);
    const page = await ctx.newPage();
    const erros: string[] = [];
    const consola: string[] = [];
    page.on("pageerror", (e) => erros.push(String(e)));
    page.on("console", (m) => consola.push(m.text()));
    await page.goto(`${BASE}/a/${SLUG}`);
    assert.equal(await page.textContent("h1"), "Noite 4 de 30", "3 noites feitas: hoje é a 4ª");
    assert.match(String(await page.textContent(".ap-selos")), /3 dias seguidos/);
    // o manifest: o link na página e o conteúdo (nome, escopo, cores e ícones PNG da marca)
    const href = await page.getAttribute('link[rel="manifest"]', "href");
    assert.equal(href, `/a/${SLUG}/manifest.webmanifest`);
    const mf = (await (await page.request.get(`${BASE}${href}`)).json()) as { name: string; short_name: string; display: string; scope: string; start_url: string; theme_color: string; icons: Array<{ src: string; sizes: string; type: string; purpose: string }> };
    assert.deepEqual([mf.name, mf.short_name, mf.display, mf.scope, mf.theme_color], ["Noites Calmas", "Noites", "standalone", `/a/${SLUG}`, "#12101A"]);
    for (const tamanho of ["192x192", "512x512"]) {
      const icone = mf.icons.find((i) => i.sizes === tamanho);
      assert.ok(icone, tamanho);
      const r = await page.request.get(`${BASE}${icone!.src}`);
      assert.equal(r.headers()["content-type"], "image/png");
      const png = await r.body();
      assert.equal(png.readUInt32BE(16), Number(tamanho.split("x")[0]), "o PNG tem o tamanho do manifest");
    }
    assert.ok(mf.icons.some((i) => i.purpose === "maskable"));
    assert.equal(await page.getAttribute('link[rel="apple-touch-icon"]', "href"), `/a/${SLUG}/icone/180`);
    // o service worker no escopo do app e os áudios guardados
    const escopo = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    assert.equal(escopo, `${BASE}/a/${SLUG}`);
    await page.waitForSelector('[data-guardado="ok"]', { timeout: 15_000 }).catch(async (e: Error) => {
      throw new Error(`${e.message}\nguardado=${await page.getAttribute(".ap-status", "data-guardado")}\n${consola.join("\n")}`);
    });
    const guardados = await page.evaluate(async () => (await (await caches.open("app-noites-calmas-audio-v2")).keys()).map((r) => new URL(r.url).pathname).sort());
    assert.deepEqual(guardados, [`/a/${SLUG}/audio/respira`, `/a/${SLUG}/audio/som`]);
    // 44 px, contraste AA e nada transborda
    const m1 = await medir(page);
    assert.deepEqual(m1.pequenos, [], "alvos de 44 px");
    assert.deepEqual(m1.baixos, [], "contraste AA");
    assert.equal(m1.transborda, false);
    // SEM internet: a tela abre (o service worker) e o áudio toca (o guardado no aparelho)
    await ctx.setOffline(true);
    await page.reload();
    assert.equal(await page.textContent("h1"), "Noite 4 de 30", "a tela guardada abre sem internet");
    await page.click("[data-tocar]");
    await page.waitForFunction(() => { const a = document.querySelector("audio"); return !!a && !a.paused && a.currentTime > 0.2; }, null, { timeout: 10_000 }).catch(async (e: Error) => {
      const estado = await page.evaluate<string>(`JSON.stringify({ main: (document.querySelector("main") || {}).outerHTML, h1: (document.querySelector("h1") || {}).textContent, audios: document.querySelectorAll("audio").length, tocar: !!document.querySelector("[data-tocar]"), hidratado: Object.keys(document.querySelector("[data-tocar]") || {}).some((k) => k.startsWith("__react")), escondido: !!document.getElementById("S:0"), msg: [...document.querySelectorAll(".fu-erro, .ap-status")].map((e) => e.textContent).join(" | "), cache: performance.getEntriesByType("resource").filter((e) => e.name.includes("/_next/static/")).map((e) => e.name.split("/").pop() + ":" + e.transferSize).join(",") })`);
      throw new Error(`${e.message}\n${estado.slice(0, 300)}\nERROS ${erros.join(" / ")}\n${consola.join("\n")}`);
    });
    await page.waitForSelector(".fu-ok", { timeout: 5000 });
    assert.match(String(await page.textContent(".ap-selos")), /4 dias seguidos/);
    const fila = await page.evaluate(() => localStorage.getItem("app-noites-calmas-uso"));
    assert.match(String(fila), /"noite":4/, "o toque sem internet fica guardado");
    assert.equal((await db.sql("select count(*)::int as n from public.app_uso where assinante_id = $1", [assinanteId]))[0].n, 3);
    // a internet volta: o toque guardado conta o dia
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && (await db.sql("select count(*)::int as n from public.app_uso where assinante_id = $1", [assinanteId]))[0].n < 4) await page.waitForTimeout(200);
    assert.equal((await db.sql("select count(*)::int as n from public.app_uso where assinante_id = $1", [assinanteId]))[0].n, 4);
    assert.deepEqual(erros, [], logs.join("").slice(-2000));
    await ctx.close();
  });

  test("sem assinatura: o convite (preço por mês, o que tem, Assinar) e «Já assinei» (o e-mail), com 44 px e contraste AA", async () => {
    const ctx = await contexto(false);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/a/${SLUG}?o=mo1a2b3c`);
    assert.equal(await page.textContent("h1"), "Noites Calmas");
    assert.match(String(await page.textContent(".ap-preco")), /R\$ 19,90\s*por mês/);
    assert.equal(await page.getAttribute(".fu-oferta a.fu-btn", "href"), `/a/${SLUG}/assinar?o=mo1a2b3c`);
    assert.ok(await page.$('form[action="/a/noites-calmas/entrar"] input[name="email"]'));
    const m = await medir(page);
    assert.deepEqual(m.pequenos, []);
    assert.deepEqual(m.baixos, []);
    assert.equal(m.transborda, false);
    // o áudio fecha sem a sessão
    assert.equal((await page.request.get(`${BASE}/a/${SLUG}/audio/respira`)).status(), 403);
    await ctx.close();
  });
});
