import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Revisão F10: um post nunca recebe (nem apaga) cópias de segurança do Molde ou prévias de aprovação (sem banco). */
const VIDEO = "https://midia.teste.invalid/uaiflow/reel.mp4";

describe("mediaKeys do pacote do post", () => {
  test("recusa as chaves de uaiflow/molde-backups/ e uaiflow/molde-previas/; mantém as de mídia", async () => {
    const { parsePostPackage } = await import("@/lib/content/package");
    const boas = ["uaiflow/molde/2026-10/abc12345-reel.mp4", "uaiflow/geral/2026-10/x.jpg"];
    const ruins = [
      "uaiflow/molde-backups/birdie-lanier/20261016-130500-123-0a1b2c3d4e5f60718293.json.gz",
      "uaiflow/molde-backups/_envios/lua-azul-abcdefabcdefabcdef/00-de-02",
      "uaiflow/molde-previas/2026-09/abc-previa.mp4",
      "fora/de/uaiflow.mp4",
      "uaiflow/../segredo",
      42,
    ];
    const parsed = parsePostPackage({ publishType: "reel", mediaUrl: VIDEO, mediaKeys: [...ruins, ...boas] });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.mediaKeys, boas);
    const parcial = parsePostPackage({ mediaKeys: [ruins[0], ruins[2]] }, { partial: true });
    assert.ok(parcial.ok);
    assert.deepEqual(parcial.value.mediaKeys, []);
  });

  test("isProtectedKey: só esses dois prefixos; e quem apaga mídia de post filtra por ela", async () => {
    const { isProtectedKey } = await import("@/lib/content/r2");
    assert.equal(isProtectedKey("uaiflow/molde-backups/x/y.json.gz"), true);
    assert.equal(isProtectedKey("uaiflow/molde-previas/2026-09/p.mp4"), true);
    assert.equal(isProtectedKey("uaiflow/molde/2026-09/final.mp4"), false);
    assert.equal(isProtectedKey("uaiflow/molde-backupsx/a"), false);
    // as duas rotas que apagam mídia de post (apagar o post e a limpeza do relógio) passam as chaves pelo filtro
    for (const arquivo of ["src/lib/content/service.ts", "src/lib/content/scheduler.ts"]) {
      const fonte = readFileSync(arquivo, "utf8");
      assert.match(fonte, /\.filter\(\(key\) => !isProtectedKey\(key\)\)/, arquivo);
      assert.match(fonte, /key && !isProtectedKey\(key\)/, arquivo);
    }
  });
});
