import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { request } from "./helpers/http.mjs";

/** Supabase em que a 0007 ainda não foi colada: a senha de administrador funciona, só que sem limite de tentativas. */
const SENHA = "senha-de-admin-de-teste-123";

describe("senha de administrador sem a migração 0007", { skip: semBanco }, () => {
  let db: TestDatabase;
  let login: typeof import("@/app/api/admin/login/route");

  before(async () => {
    db = await createTestDatabase({ ate: "0006" });
    login = await import("@/app/api/admin/login/route");
    process.env.ADMIN_PASSWORD = SENHA;
  });
  after(async () => {
    delete process.env.ADMIN_PASSWORD;
    await db?.close();
  });

  test("o banco de teste está mesmo sem a tabela nova", async () => {
    assert.equal((await db.sql("select 1 from pg_class where relname = 'admin_login_attempts'")).length, 0);
  });

  test("erros não bloqueiam, a senha certa entra e o aviso vai ao log uma vez só", async () => {
    const avisos: string[] = [];
    const original = console.warn;
    console.warn = (...partes: unknown[]) => void avisos.push(partes.join(" "));
    try {
      for (let i = 0; i < 7; i += 1) {
        const errada = await login.POST(request("/api/admin/login", { form: { password: "errada-errada" }, headers: { "x-nf-client-connection-ip": "203.0.113.9" } }));
        assert.equal(new URL(errada.headers.get("location") as string).searchParams.get("error"), "1");
      }
      const certa = await login.POST(request("/api/admin/login", { form: { password: SENHA }, headers: { "x-nf-client-connection-ip": "203.0.113.9" } }));
      assert.equal(new URL(certa.headers.get("location") as string).pathname, "/dashboard");
      assert.ok(certa.cookies.get("admin_session")?.value);
    } finally {
      console.warn = original;
    }
    const doLogin = avisos.filter((aviso) => aviso.includes("[login]"));
    assert.equal(doLogin.length, 1, "o aviso aparece uma vez por processo");
    assert.match(doLogin[0], /0007/);
  });
});
