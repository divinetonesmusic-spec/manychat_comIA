import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

/** Tela Conteúdo: nota de post publicado não pode aparecer como erro (Rodada 1, achado 4). */
const { lastErrorClass } = await import("@/app/conteudo/conteudo-client");

describe("cor da nota no detalhe do post", () => {
  test("post publicado: nota neutra (ex.: 'Publicado; não consegui buscar o link'), não vermelha", () => {
    assert.doesNotMatch(lastErrorClass("published"), /red/);
    assert.match(lastErrorClass("published"), /ms-muted/);
  });

  test("publicando continua neutro; com erro continua vermelho", () => {
    assert.match(lastErrorClass("publishing"), /ms-muted/);
    assert.match(lastErrorClass("failed"), /text-red-500/);
  });
});
