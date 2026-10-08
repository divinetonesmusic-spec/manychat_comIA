import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Diagnóstico do perfil: "Nenhum aviso de novas mensagens ligado" é aviso (amarelo), não "ok" (verde). */
const meta = installFakeMeta();

type Checagem = { key: string; status: string; detail: string };

describe("diagnóstico: aviso de novas mensagens", { skip: semBanco }, () => {
  let db: TestDatabase;
  let conta: string;

  before(async () => {
    db = await createTestDatabase();
    conta = await seedAccount(db, { username: "conta_diag", userId: "1001", token: "IGAA-TESTE-DIAG", isDefault: true });
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  async function checagens() {
    const { GET } = await import("@/app/api/profile/diagnostics/route");
    const resposta = await GET(request(`/api/profile/diagnostics?accountId=${conta}`));
    const corpo = await resposta.json() as { data: { checks: Checagem[]; summary: { status: string } } };
    return corpo.data;
  }

  test("a Meta não tem nenhum aviso ligado e aqui também não: amarelo (warn), com o texto de sempre", async () => {
    // O simulador responde { success: true } em /subscribed_apps, sem lista: a Meta não tem aviso ligado.
    await db.sql("update public.instagram_accounts set webhook_subscribed_at = null where id = $1", [conta]);
    const dados = await checagens();
    const aviso = dados.checks.find((item) => item.key === "webhook");
    assert.ok(aviso);
    assert.equal(aviso.detail, "Nenhum aviso de novas mensagens ligado, segundo a Meta.");
    assert.equal(aviso.status, "warn");
    assert.notEqual(dados.summary.status, "ok");
  });

  test("a Meta não retornou, mas aqui consta como ligado: continua amarelo", async () => {
    await db.sql("update public.instagram_accounts set webhook_subscribed_at = now() where id = $1", [conta]);
    const aviso = (await checagens()).checks.find((item) => item.key === "webhook");
    assert.equal(aviso?.status, "warn");
  });
});
