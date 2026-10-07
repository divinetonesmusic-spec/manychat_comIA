import "./helpers/env.mjs";
import { after, afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";

/** Botão "Enviar aviso de teste" (Configurações) → POST /api/notify/test. */
const meta = installFakeMeta();
const { proxy } = await import("@/proxy");
const route = await import("@/app/api/notify/test/route");
const adminCookie = createHash("sha256").update(`${process.env.ADMIN_SESSION_SECRET}:uaiflow-admin-v1`).digest("hex");

describe("POST /api/notify/test", () => {
  afterEach(() => {
    meta.reset();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  after(() => meta.restore());

  test("exige sessão: sem login, o proxy responde 401 e nada é enviado", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456789:TESTE-token-falso-do-robo";
    process.env.TELEGRAM_CHAT_ID = "987654321";
    const response = await proxy(request("/api/notify/test", { method: "POST" }));
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /Entre novamente/);
    assert.equal(meta.telegram.length, 0);
  });

  test("com a sessão de administrador, o proxy deixa passar", async () => {
    const response = await proxy(request("/api/notify/test", { method: "POST", cookies: { admin_session: adminCookie } }));
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  test("sem as variáveis: explica o que falta configurar no Netlify", async () => {
    const response = await route.POST(request("/api/notify/test", { method: "POST" }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "Falta configurar TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no Netlify." });
    assert.equal(meta.calls.length, 0);
  });

  test("com as variáveis: manda o aviso de teste e responde 'Aviso enviado! Confira o Telegram.'", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456789:TESTE-token-falso-do-robo";
    process.env.TELEGRAM_CHAT_ID = "987654321";
    const response = await route.POST(request("/api/notify/test", { method: "POST" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, message: "Aviso enviado! Confira o Telegram." });
    assert.equal(meta.telegram.length, 1);
    assert.match(String(meta.telegram[0].body.text), /^UaiFlow: aviso de teste\./);
    assert.match(String(meta.telegram[0].body.text), /Abra: https:\/\/uaiflow\.teste\/configuracoes$/);
  });

  test("Telegram recusando: devolve o motivo do erro em português", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456789:TESTE-token-falso-do-robo";
    process.env.TELEGRAM_CHAT_ID = "987654321";
    meta.telegramFails = { status: 400, description: "Bad Request: chat not found" };
    const silenciar = console.error;
    console.error = () => undefined;
    try {
      const response = await route.POST(request("/api/notify/test", { method: "POST" }));
      const body = await response.json();
      assert.equal(response.status, 502);
      assert.equal(body.ok, false);
      assert.match(body.error, /^Não consegui enviar o aviso\. .*TELEGRAM_CHAT_ID/);
      assert.doesNotMatch(body.error, /TESTE-token-falso/);
    } finally {
      console.error = silenciar;
    }
  });
});
