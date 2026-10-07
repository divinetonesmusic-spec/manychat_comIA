import "./helpers/env.mjs";
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeMeta, type FakeMeta } from "./helpers/fake-meta.mjs";

/** Avisos pelo Telegram (src/lib/notify.ts): opcionais, nunca quebram quem chama, nunca mostram o token. */
const TOKEN = "123456789:TESTE-token-falso-do-robo";
const CHAT = "987654321";
const notify = await import("@/lib/notify");

function ligarTelegram() {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_CHAT_ID = CHAT;
}

function desligarTelegram() {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
}

/** Guarda o que foi escrito no console durante o teste. */
function capturarConsole() {
  const linhas: string[] = [];
  const originais = { error: console.error, warn: console.warn, log: console.log };
  for (const nome of ["error", "warn", "log"] as const) {
    console[nome] = (...args: unknown[]) => {
      linhas.push(args.map(String).join(" "));
    };
  }
  return { linhas, restaurar: () => Object.assign(console, originais) };
}

describe("envio pelo Telegram", () => {
  let meta: FakeMeta;

  beforeEach(() => {
    meta = installFakeMeta();
  });

  afterEach(() => {
    meta.restore();
    desligarTelegram();
  });

  test("sem TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID não chama a rede e não dá erro", async () => {
    desligarTelegram();
    assert.equal(notify.isTelegramConfigured(), false);
    assert.deepEqual(await notify.sendTelegram("oi"), { ok: false, reason: "not_configured" });
    await notify.notifyPostFailed({ id: "p1", title: "Post", caption: "", account_id: null, account_username: "conta" }, "Motivo");
    await notify.notifyTokenAlerts([{ accountId: "a", username: "conta", motivo: "vence_em_breve", diasParaVencer: 3, detalhe: "" }]);
    assert.equal(meta.calls.length, 0, "nenhuma chamada de rede");
  });

  test("só uma das duas variáveis também não manda nada", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    assert.deepEqual(await notify.sendTelegram("oi"), { ok: false, reason: "not_configured" });
    assert.equal(meta.calls.length, 0);
  });

  test("com as variáveis: POST no sendMessage com chat_id, texto puro e sem prévia de link", async () => {
    ligarTelegram();
    const result = await notify.sendTelegram("UaiFlow: teste");
    assert.deepEqual(result, { ok: true });
    assert.equal(meta.calls.length, 1);
    const call = meta.calls[0];
    assert.equal(call.method, "POST");
    assert.equal(call.host, "api.telegram.org");
    assert.equal(call.path, `/bot${TOKEN}/sendMessage`);
    assert.deepEqual(meta.telegram[0].body, { chat_id: CHAT, text: "UaiFlow: teste", disable_web_page_preview: true });
    assert.equal("parse_mode" in meta.telegram[0].body, false, "texto puro (sem parse_mode)");
  });

  test("erro de rede não lança, e o registro no console não traz o token", async () => {
    ligarTelegram();
    meta.telegramFails = "rede";
    const saida = capturarConsole();
    let result: Awaited<ReturnType<typeof notify.sendTelegram>>;
    try {
      result = await notify.sendTelegram("oi");
      await notify.notifyPostFailed({ id: "p1", title: "Post", caption: "", account_id: null, account_username: "conta" }, "Motivo");
    } finally {
      saida.restaurar();
    }
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "error");
    assert.match(result.ok === false && result.reason === "error" ? result.error : "", /Não consegui falar com o Telegram/);
    assert.ok(saida.linhas.length >= 1, "registra a falha no console");
    for (const linha of saida.linhas) assert.doesNotMatch(linha, /TESTE-token-falso/, "o token nunca aparece no console");
  });

  test("Telegram recusando (401): explica em português qual variável conferir", async () => {
    ligarTelegram();
    meta.telegramFails = { status: 401, description: "Unauthorized" };
    const saida = capturarConsole();
    try {
      const result = await notify.sendTelegram("oi");
      assert.equal(result.ok, false);
      assert.match(result.ok === false && result.reason === "error" ? result.error : "", /TELEGRAM_BOT_TOKEN/);
    } finally {
      saida.restaurar();
    }
  });

  test("conversa não encontrada (400 chat not found): pede para conferir o TELEGRAM_CHAT_ID", async () => {
    ligarTelegram();
    meta.telegramFails = { status: 400, description: "Bad Request: chat not found" };
    const saida = capturarConsole();
    try {
      const result = await notify.sendTelegram("oi");
      assert.match(result.ok === false && result.reason === "error" ? result.error : "", /TELEGRAM_CHAT_ID/);
    } finally {
      saida.restaurar();
    }
  });

  test("Telegram que não responde: desiste no prazo (5 s por padrão) sem lançar", async () => {
    assert.equal(notify.TELEGRAM_TIMEOUT_MS, 5000);
    ligarTelegram();
    const original = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("abortado")));
      })) as typeof fetch;
    const saida = capturarConsole();
    try {
      const inicio = Date.now();
      const result = await notify.sendTelegram("oi", { timeoutMs: 50 });
      assert.ok(Date.now() - inicio < 2000);
      assert.match(result.ok === false && result.reason === "error" ? result.error : "", /não respondeu/);
    } finally {
      saida.restaurar();
      globalThis.fetch = original;
    }
  });
});

describe("textos dos avisos", () => {
  afterEach(() => {
    process.env.APP_BASE_URL = "https://uaiflow.teste";
  });

  test("link: APP_BASE_URL primeiro; sem ela, o endereço do pedido; sem os dois, nenhum link", () => {
    assert.equal(notify.appLink("/conteudo", "https://outro.teste"), "https://uaiflow.teste/conteudo");
    process.env.APP_BASE_URL = "https://uaiflow.teste/";
    assert.equal(notify.appLink("/perfis"), "https://uaiflow.teste/perfis");
    delete process.env.APP_BASE_URL;
    assert.equal(notify.appLink("/conteudo", "https://site-do-pedido.teste"), "https://site-do-pedido.teste/conteudo");
    assert.equal(notify.appLink("/conteudo"), null);
    assert.equal(notify.appLink("/conteudo", null), null);
  });

  test("post que não saiu: título, @conta, motivo e o link da tela Conteúdo do perfil certo", () => {
    const text = notify.postFailedMessage(
      { id: "p1", title: "Antes do café da manhã, faça isto", caption: "legenda", account_id: "conta-1", account_username: "ruthie" },
      "A Meta recusou o vídeo (formato, duração ou resolução).",
    );
    assert.equal(
      text,
      [
        'UaiFlow: o post "Antes do café da manhã, faça isto" (@ruthie) não saiu.',
        "Motivo: A Meta recusou o vídeo (formato, duração ou resolução).",
        "Abra: https://uaiflow.teste/conteudo?accountId=conta-1",
      ].join("\n"),
    );
  });

  test("post sem título usa o começo da legenda; título longo é cortado com reticências", () => {
    const semTitulo = notify.postFailedMessage({ id: "p1", title: "", caption: "Primeira linha da legenda\nsegunda", account_id: null, account_username: null }, "x");
    assert.match(semTitulo, /^UaiFlow: o post "Primeira linha da legenda" não saiu\./);
    const longo = notify.postFailedMessage({ id: "p1", title: "a".repeat(80), caption: "", account_id: null, account_username: "c" }, "x");
    assert.match(longo, /"a{39}…" \(@c\)/);
    assert.match(longo, /Abra: https:\/\/uaiflow\.teste\/conteudo$/);
  });

  test("sem endereço do site: o aviso sai sem a linha do link", () => {
    delete process.env.APP_BASE_URL;
    const text = notify.postFailedMessage({ id: "p1", title: "Post", caption: "", account_id: null, account_username: "c" }, "x");
    assert.doesNotMatch(text, /Abra:/);
  });

  test("token: falha na renovação e vencimento próximo numa mensagem só, com o link de Perfis", () => {
    const text = notify.tokenAlertsMessage([
      { accountId: "a", username: "ruthie", motivo: "falha_na_renovacao", diasParaVencer: 3, detalhe: "Session has expired" },
      { accountId: "b", username: "payoff", motivo: "vence_em_breve", diasParaVencer: 5, detalhe: "" },
      { accountId: "c", username: "velha", motivo: "falha_na_renovacao", diasParaVencer: -2, detalhe: "" },
    ]);
    assert.equal(
      text,
      [
        "UaiFlow: atenção com a conexão do Instagram.",
        "- @ruthie: não consegui renovar a conexão. Ela vence em 3 dias. (Detalhe: Session has expired)",
        "- @payoff: a conexão vence em 5 dias.",
        "- @velha: não consegui renovar a conexão. Ela já venceu.",
        "Reconecte o perfil em Perfis: https://uaiflow.teste/perfis",
      ].join("\n"),
    );
  });
});
