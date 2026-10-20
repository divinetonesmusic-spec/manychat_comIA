import "./helpers/env.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Sem a 0011 colada: o painel avisa, as páginas públicas dão 404, o relógio segue e o post salva sem o destino. */
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase({ ate: "0010" });
const produtosRoute = await import("@/app/api/vendas/produtos/route");
const ofertaRoute = await import("@/app/p/[slug]/oferta/route");
const relogio = await import("@/lib/vendas/relogio");
const pkg = await import("@/lib/content/package");
const service = await import("@/lib/content/service");

after(async () => {
  meta.restore();
  await db?.close();
});

describe("sem a 0011", { skip: semBanco }, () => {
  test("painel responde 503 com o aviso; página pública 404; relógio sai sem erro", async () => {
    const lista = await produtosRoute.GET(request("/api/vendas/produtos"));
    assert.equal(lista.status, 503);
    assert.match((await lista.json()).error, /0011/);
    const oferta = await ofertaRoute.GET(request("/p/qualquer/oferta"), routeParams({ slug: "qualquer" }));
    assert.equal(oferta.status, 404);
    Object.assign(process.env, { RESEND_API_KEY: "re_chave_falsa", EMAIL_REMETENTE: "Teste <oi@exemplo.com>" });
    try {
      assert.equal((await relogio.runVendasClock({ deadline: Date.now() + 9000, enviar: async () => undefined })).motivo, "sem_migracao");
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_REMETENTE;
    }
  });

  test("post com destino salva normalmente (sem o destino) e avisa que falta a 0011", async () => {
    const accountId = await seedAccount(db!, { isDefault: true });
    const parsed = pkg.parsePostPackage({ accountId, publishType: "feed_image", mediaUrl: "https://midia.teste.invalid/uaiflow/a.jpg", destinoTipo: "so_valor" });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const { post } = await service.savePostPackage(parsed.value, false);
    assert.ok(post?.id);
    assert.equal(await service.packageWarning(parsed.value, post), service.DESTINO_COLUMN_MISSING_WARNING);
  });
});
