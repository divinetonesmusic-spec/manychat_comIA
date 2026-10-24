import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Sem a 0015 colada: publicar pelo Molde continua funcionando (só sem o registro das referências). */
const meta = installFakeMeta();

describe("Reel do Molde sem a 0015", { skip: semBanco }, () => {
  let db: TestDatabase;
  before(async () => {
    db = await createTestDatabase({ ate: "0014" });
  });
  after(async () => {
    meta.restore();
    await db?.close();
  });

  test("publica 1 vez e as consultas do registro respondem 'pode seguir'", async () => {
    const accountId = await seedAccount(db);
    const moldeRoute = await import("@/app/api/molde/posts/route");
    const scheduler = await import("@/lib/content/scheduler");
    const refs = await import("@/lib/db/refs-publicadas");
    const response = await moldeRoute.POST(request("/api/molde/posts", {
      headers: { "x-molde-token": process.env.MOLDE_API_TOKEN as string },
      json: { externalRef: "sem-0015", publishType: "reel", mediaUrl: "https://midia.teste.invalid/uaiflow/reel.mp4", caption: "Reel", publishNow: true, accountId },
    }));
    assert.equal(response.status, 201);
    for (let i = 0; i < 3; i += 1) await scheduler.runContentCycle(8000);
    assert.equal(meta.count("/media_publish"), 1);
    assert.equal(await refs.findRefPublicada(accountId, "sem-0015"), null);
    assert.deepEqual(await refs.reservarRefParaPublicar({ id: "x", account_id: accountId, external_ref: "sem-0015" }), { ok: true });
  });
});
