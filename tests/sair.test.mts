import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "./helpers/http.mjs";

/** Fase 6 · "Sair" apaga também o cookie de administrador. */
const { proxy } = await import("@/proxy");
const auth = await import("@/lib/auth");

describe("Sair", () => {
  test("POST /api/admin/logout apaga o cookie de administrador (vazio, maxAge 0, httpOnly)", async () => {
    const route = await import("@/app/api/admin/logout/route");
    const response = await route.POST();
    assert.equal(response.status, 200);
    const cookie = response.cookies.get("admin_session");
    assert.equal(cookie?.value, "");
    assert.equal(cookie?.maxAge, 0);
    assert.equal(cookie?.httpOnly, true);
    assert.equal(cookie?.path, "/");
    assert.match(response.headers.get("set-cookie") ?? "", /admin_session=;.*Max-Age=0/i);
  });

  test("a rota de sair passa pelo proxy mesmo sem sessão (cookie vencido também sai)", async () => {
    const response = await proxy(request("/api/admin/logout", { method: "POST", cookies: { admin_session: (await auth.createAdminSessionValue(Date.now() - 40 * 86_400_000)) as string } }));
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  test("o botão Sair chama a rota do servidor e também sai do Supabase", () => {
    const botao = readFileSync("src/app/sign-out-button.tsx", "utf8");
    assert.ok(botao.includes('fetch("/api/admin/logout", { method: "POST" })'));
    assert.ok(botao.includes("supabase.auth.signOut()"));
  });
});
