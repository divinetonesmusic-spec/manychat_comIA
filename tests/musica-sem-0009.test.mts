import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Supabase sem a 0009 (música do Instagram): o UaiFlow segue igual. O pacote com música é aceito, mas a música não é
 * guardada (com aviso), o post sai pelo caminho de sempre, e a busca e a conexão pelo Facebook pedem a 0009.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };

describe("música do Instagram sem a migração 0009", { skip: semBanco }, () => {
  let db: TestDatabase;
  let accountId: string;
  let ADMIN: Record<string, string>;
  let scheduler: typeof import("@/lib/content/scheduler");
  let moldeRoute: typeof import("@/app/api/molde/posts/route");
  let audioRoute: typeof import("@/app/api/molde/audio/route");
  let fbLoginRoute: typeof import("@/app/api/oauth/facebook/login/route");
  let service: typeof import("@/lib/content/service");

  before(async () => {
    db = await createTestDatabase({ ate: "0008" });
    scheduler = await import("@/lib/content/scheduler");
    moldeRoute = await import("@/app/api/molde/posts/route");
    audioRoute = await import("@/app/api/molde/audio/route");
    fbLoginRoute = await import("@/app/api/oauth/facebook/login/route");
    service = await import("@/lib/content/service");
    const auth = await import("@/lib/auth");
    ADMIN = { [auth.getAdminCookieName()]: (await auth.createAdminSessionValue()) as string };
  });

  beforeEach(async () => {
    meta.reset();
    await db.sql("delete from public.content_posts");
    await db.sql("delete from public.instagram_accounts");
    accountId = await seedAccount(db);
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  test("Molde manda Reel com música: cria o post, avisa que a música não foi guardada", async () => {
    const response = await moldeRoute.POST(request("/api/molde/posts", { json: { accountId, externalRef: "s-1", publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/r.mp4", musica: { audioId: "777" } }, headers: MOLDE }));
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.warning, service.MUSIC_COLUMN_MISSING_WARNING);
    assert.equal(body.data.warning, service.MUSIC_COLUMN_MISSING_WARNING);
    assert.equal(body.data.musica, null);
  });

  test("post sem a 0009 publica pelo caminho de sempre", async () => {
    const id = await insertPost(db, accountId);
    for (let round = 0; round < 3; round += 1) await scheduler.runContentCycle(8000);
    assert.equal((await readPost(db, id)).status, "published");
    assert.deepEqual([...new Set(meta.calls.map((call) => call.host))], ["graph.instagram.com"]);
  });

  test("busca de música e conexão pelo Facebook pedem a 0009 (sem chamar a Meta)", async () => {
    const busca = await audioRoute.GET(request(`/api/molde/audio?conta=${accountId}`, { headers: MOLDE }));
    assert.equal(busca.status, 503);
    assert.equal((await busca.json()).codigo, "falta_0009");
    const login = await fbLoginRoute.GET(request(`/api/oauth/facebook/login?conta=${accountId}`, { cookies: ADMIN }));
    const destino = new URL(login.headers.get("location") as string);
    assert.match(destino.searchParams.get("facebook_error") ?? "", /0009/);
    assert.equal(meta.calls.length, 0);
  });
});
