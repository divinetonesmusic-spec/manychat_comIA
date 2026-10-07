import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** U-SEG-01: os tokens do Instagram nunca vão para o navegador. */
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const TOKEN = /IGAA-TESTE/;

describe("conversão para a versão pública (sem segredo)", () => {
  test("conta: mantém o que as telas usam e tira o token (e qualquer campo não previsto)", async () => {
    const { toPublicInstagramAccount } = await import("@/lib/instagram/public-account");
    const conta = {
      id: "conta-1",
      instagram_access_token: "IGAA-TESTE-SEGREDO",
      instagram_user_id: "1784",
      instagram_username: "ruthie",
      instagram_name: "Ruthie",
      instagram_profile_picture_url: "https://cdn.teste.invalid/foto.jpg",
      token_expires_at: "2026-12-01T00:00:00.000Z",
      webhook_subscribed_at: null,
      is_default: true,
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
      campo_novo_secreto: "IGAA-TESTE-OUTRO",
    };
    const publica = toPublicInstagramAccount(conta);
    assert.deepEqual(publica, {
      id: "conta-1",
      instagram_user_id: "1784",
      instagram_username: "ruthie",
      instagram_name: "Ruthie",
      instagram_profile_picture_url: "https://cdn.teste.invalid/foto.jpg",
      is_default: true,
      token_expires_at: "2026-12-01T00:00:00.000Z",
    });
    assert.doesNotMatch(JSON.stringify(publica), TOKEN);
  });

  test("config do perfil ativo: tira o token", async () => {
    const { toPublicConfig } = await import("@/lib/instagram/public-account");
    const publica = toPublicConfig({
      account_id: "conta-1",
      instagram_access_token: "IGAA-TESTE-SEGREDO",
      instagram_user_id: "1784",
      instagram_username: "ruthie",
      instagram_name: null,
      instagram_profile_picture_url: null,
      token_expires_at: null,
      webhook_subscribed_at: null,
    });
    assert.equal("instagram_access_token" in publica, false);
    assert.equal(publica.instagram_username, "ruthie");
    assert.doesNotMatch(JSON.stringify(publica), TOKEN);
  });
});

describe("dados das telas e da API do navegador", { skip: semBanco }, () => {
  let accountId: string;
  before(async () => {
    accountId = await seedAccount(db!, { username: "ruthie", token: "IGAA-TESTE-RUTHIE", isDefault: true });
    await seedAccount(db!, { username: "payoff", userId: "1002", token: "IGAA-TESTE-PAYOFF", isDefault: false });
  });
  after(async () => {
    await db?.close();
  });

  test("a lista de contas das telas não traz token", async () => {
    const { listPublicInstagramAccounts } = await import("@/lib/db/repositories");
    const contas = await listPublicInstagramAccounts();
    assert.equal(contas.length, 2);
    assert.doesNotMatch(JSON.stringify(contas), TOKEN);
  });

  test("trocar o perfil principal responde sem token", async () => {
    const route = await import("@/app/api/instagram-accounts/[id]/default/route");
    const response = await route.POST(request(`/api/instagram-accounts/${accountId}/default`, { method: "POST" }), routeParams({ id: accountId }));
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(text).data.instagram_username, "ruthie");
    assert.doesNotMatch(text, TOKEN);
  });
});
