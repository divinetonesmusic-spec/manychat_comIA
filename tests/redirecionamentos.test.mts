import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { request, routeParams } from "./helpers/http.mjs";

/** U-SEG-04: depois do login (e nas rotas de contato), só se volta para caminhos dentro do UaiFlow. */
const { safeNextPath } = await import("@/lib/auth");

function location(response: Response) {
  const value = response.headers.get("location");
  assert.ok(value, `sem redirecionamento (status ${response.status})`);
  return new URL(value);
}

describe("U-SEG-04: safeNextPath só deixa caminhos internos", () => {
  test("bloqueia //, /\\ e truques com tab/quebra de linha", () => {
    for (const ruim of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "https://evil.example", "evil", ""]) {
      assert.equal(safeNextPath(ruim), "/dashboard", JSON.stringify(ruim));
    }
    assert.equal(safeNextPath("/perfis?accountId=1#x"), "/perfis?accountId=1#x");
    assert.equal(safeNextPath(null, "/caixa-de-entrada"), "/caixa-de-entrada");
  });

  test("/auth/callback?next=//evil.example vai para /dashboard", async () => {
    const route = await import("@/app/auth/callback/route");
    for (const ruim of ["//evil.example/entrar", "/\\evil.example", "/\t/evil.example"]) {
      const response = await route.GET(request(`/auth/callback?next=${encodeURIComponent(ruim)}`));
      const destino = location(response);
      assert.equal(destino.host, "uaiflow.teste", ruim);
      assert.equal(destino.pathname, "/dashboard", ruim);
    }
  });

  test("rotas de contato com next=/\\evil voltam para a caixa de entrada", async () => {
    const tags = await import("@/app/api/contacts/[id]/tags/route");
    const response = await tags.POST(
      request("/api/contacts/123/tags", { form: { action: "add", tag: "", next: "/\\evil.example" } }),
      routeParams({ id: "123" }),
    );
    const destino = location(response);
    assert.equal(destino.host, "uaiflow.teste");
    assert.equal(destino.pathname, "/caixa-de-entrada");
  });
});
