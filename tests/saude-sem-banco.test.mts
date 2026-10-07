import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

/**
 * Banco fora do ar: DATABASE_URL das variáveis falsas aponta para uma porta fechada (127.0.0.1:1).
 * Não precisa de Postgres; roda sempre.
 */
describe("saúde com o banco fora do ar", () => {
  test("/api/health responde 503 e diz que o banco não respondeu (sem detalhes técnicos)", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.match(body.motivo, /banco de dados .*não respondeu/);
    assert.deepEqual(body.tokens, { menorPrazoDias: null });
    assert.doesNotMatch(text, /127\.0\.0\.1|ECONNREFUSED|sem-banco|postgresql:/);
  });
});
