import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

/** Aviso de "feito com IA": a leitura do pacote e a frase de recusa (sem banco). */
const FRASE_RECUSA = 'O Instagram não aceitou o aviso de "feito com IA" neste post. Tente de novo mais tarde ou desmarque o aviso e publique.';
const VIDEO = "https://midia.teste.invalid/uaiflow/reel.mp4";

describe("aviso de IA no pacote (sem banco)", () => {
  test("parsePostPackage: só boolean vale; outro tipo é ignorado", async () => {
    const { parsePostPackage } = await import("@/lib/content/package");
    const base = { publishType: "reel", mediaUrl: VIDEO };
    for (const [entrada, esperado] of [[true, true], [false, false], ["sim", undefined], [1, undefined], [null, undefined], [undefined, undefined]] as const) {
      const parsed = parsePostPackage({ ...base, aiGenerated: entrada });
      assert.ok(parsed.ok);
      assert.equal(parsed.value.aiGenerated, esperado, `aiGenerated=${JSON.stringify(entrada)}`);
    }
  });

  test("edição parcial: só leva o campo quando ele vem como boolean", async () => {
    const { parsePostPackage } = await import("@/lib/content/package");
    const com = parsePostPackage({ aiGenerated: true }, { partial: true });
    assert.ok(com.ok);
    assert.equal(com.value.aiGenerated, true);
    const sem = parsePostPackage({ caption: "oi" }, { partial: true });
    assert.ok(sem.ok);
    assert.equal("aiGenerated" in sem.value, false);
    const ruim = parsePostPackage({ aiGenerated: "sim" }, { partial: true });
    assert.ok(ruim.ok);
    assert.equal("aiGenerated" in ruim.value, false);
  });

  test("a Meta recusando is_ai_generated vira a frase em português (antes de qualquer outra regra)", async () => {
    const { translateError } = await import("@/lib/content/scheduler");
    assert.equal(translateError(new Error("Instagram Graph v23.0: (#100) Invalid parameter: is_ai_generated is not supported for this media type")), FRASE_RECUSA);
    assert.equal(translateError(new Error("Instagram Graph v23.0: The parameter is_ai_generated is invalid")), FRASE_RECUSA);
    assert.notEqual(translateError(new Error("Instagram Graph v23.0: Invalid parameter")), FRASE_RECUSA);
  });
});
