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

describe("depois do build: nenhum token no HTML e link de conexão funcionando", { skip: motivo }, () => {
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

  test("U-SEG-02: o link de Perfis (Copiar link) abre o login do Instagram em outro navegador, sem sessão", async () => {
    const html = await (await fetch(`${BASE}/perfis`, { headers: { cookie } })).text();
    const match = html.match(/\/api\/oauth\/login\?next=[^"\s<>]*?(?:&amp;|\\u0026|&)t=([A-Za-z0-9_.%-]+)/);
    assert.ok(match, "a tela Perfis não trouxe o link assinado");
    const t = decodeURIComponent(match[1]);

    const semSessao = await fetch(`${BASE}/api/oauth/login?next=%2Fperfis&t=${encodeURIComponent(t)}`, { redirect: "manual" });
    assert.ok([302, 303, 307].includes(semSessao.status), `status ${semSessao.status}`);
    assert.match(semSessao.headers.get("location") ?? "", /^https:\/\/www\.instagram\.com\/oauth\/authorize\?/);

    const semNada = await fetch(`${BASE}/api/oauth/login?next=%2Fperfis`, { redirect: "manual" });
    assert.match(semNada.headers.get("location") ?? "", /\/login\?/, "sem sessão e sem link: vai para o login do UaiFlow");
  });

  test("U-UX-03: a volta do Instagram mostra o aviso no topo (conectado, não autorizou, outro motivo) e sem parâmetros não mostra nada", async () => {
    const abrir = async (query: string) => (await fetch(`${BASE}/perfis${query}`, { headers: { cookie } })).text();
    const conectado = await abrir("?instagram_connected=1");
    assert.match(conectado, /Pronto! O Instagram foi conectado\./);
    assert.match(conectado, />Fechar</);
    const negado = await abrir("?instagram_error=access_denied");
    assert.match(negado, /Você não autorizou o Instagram\. Nada mudou; tente de novo quando quiser\./);
    const outro = await abrir(`?instagram_error=${encodeURIComponent("Invalid redirect uri")}`);
    assert.match(outro, /Não consegui conectar o Instagram\./);
    assert.match(outro, /Invalid redirect uri/);
    const limpo = await abrir("");
    assert.doesNotMatch(limpo, /O Instagram foi conectado|Não consegui conectar o Instagram|Você não autorizou/);
  });

  test("U-UX-02: /dashboard traz o seletor de perfil do celular com as duas contas (a principal marcada)", async () => {
    const html = await (await fetch(`${BASE}/dashboard`, { headers: { cookie } })).text();
    const seletor = html.match(/<select[^>]*id="perfil-do-instagram-celular"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(seletor, "não achei o seletor do celular");
    assert.match(html, /Perfil do Instagram/);
    assert.match(seletor[1], /@ruthie_teste[^<]*\(principal\)/);
    assert.match(seletor[1], /@payoff_teste</);
    assert.doesNotMatch(seletor[1], /@payoff_teste[^<]*\(principal\)/);
    assert.match(html, /<div class="[^"]*md:hidden[^"]*"><label[^>]*>Perfil do Instagram<\/label><select[^>]*id="perfil-do-instagram-celular"/, "o seletor do celular fica escondido a partir de 768 px");
  });

  test("U-UX-01/03: o menu traz o grupo Avançado; sem busca nem sino no topo", async () => {
    const html = await (await fetch(`${BASE}/dashboard`, { headers: { cookie } })).text();
    assert.match(html, />Avançado</);
    for (const rotulo of ["Início", "Caixa de entrada", "Conteúdo", "Contatos", "Automações", "Perfis", "Fluxos", "Assistente UaiFlow", "Configurações"]) {
      assert.ok(html.includes(`<span>${rotulo}</span>`), `falta o item do menu: ${rotulo}`);
    }
    assert.ok(html.indexOf("<span>Perfis</span>") < html.indexOf(">Avançado<"), "Perfis fica no grupo principal, antes do Avançado");
    assert.ok(html.indexOf(">Avançado<") < html.indexOf("<span>Fluxos</span>"), "Fluxos fica depois do título Avançado");
    assert.doesNotMatch(html, /search-input|Buscar automacoes|aria-label="Notificacoes"/);
  });

  test("U-UX-03: /perfis traz o passo a passo da Meta recolhido", async () => {
    const html = await (await fetch(`${BASE}/perfis`, { headers: { cookie } })).text();
    const detalhes = html.match(/<details[^>]*>\s*<summary[^>]*>Avançado: configuração na Meta<\/summary>/);
    assert.ok(detalhes, "falta o bloco recolhido");
    assert.doesNotMatch(detalhes[0], /\bopen\b/);
    assert.ok(html.indexOf("Avançado: configuração na Meta") < html.indexOf("Abrir Meta Developer"), "o botão fica dentro do bloco");
  });

  test("U-UX-03: o login não oferece mais 'Criar conta' (e a rota /cadastro continua abrindo)", async () => {
    const login = await (await fetch(`${BASE}/login`)).text();
    assert.match(login, /Entrar na UaiFlow/);
    assert.doesNotMatch(login, /Criar conta|Nao tem uma conta/);
    const cadastro = await fetch(`${BASE}/cadastro`);
    assert.equal(cadastro.status, 200);
  });

  test("API de trocar o perfil principal (chamada pelo navegador)", async () => {
    const response = await fetch(`${BASE}/api/instagram-accounts/${secondAccountId}/default`, { method: "POST", headers: { cookie } });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(text, TOKEN);
  });
});
