import "./helpers/env.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { request } from "./helpers/http.mjs";
import { insertPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Supabase sem a 0017 (só até a 0015): nada do que existia quebra. As rotas do desafio respondem 503 «Falta colar a
 * atualização 0017», o post com o desafio publica com a DM de sempre (e a nota no post), o botão e o relógio não fazem nada.
 */
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };

describe("sem a 0017", { skip: semBanco }, () => {
  let db: TestDatabase;
  after(async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_REMETENTE;
    await db?.close();
  });

  test("as rotas dizem o que falta; o post sai sem o desafio; o botão e o relógio não quebram", async () => {
    db = await createTestDatabase({ ate: "0015" });
    const rota = await import("@/app/api/molde/desafio/route");
    for (const r of [
      await rota.GET(request("/api/molde/desafio?molde=proj-1", { headers: MOLDE })),
      await rota.POST(request("/api/molde/desafio", { headers: MOLDE, json: { molde: "proj-1", desafio: { titulo: "x", oferta: { url: "https://x.teste" }, variantes: { A: [1, 2, 3, 4, 5].map((n) => ({ texto: `t${n}`, tarefa: `f${n}` })) } } } })),
    ]) {
      assert.equal(r.status, 503);
      const j = (await r.json()) as { error: string; codigo: string };
      assert.equal(j.codigo, "falta_0017");
      assert.match(j.error, /0017/);
    }
    const { runDesafioClock, tocarDesafio } = await import("@/lib/db/desafios");
    process.env.RESEND_API_KEY = "re_falsa";
    process.env.EMAIL_REMETENTE = "x@uaiflow.teste";
    assert.equal((await runDesafioClock({ deadline: Date.now() + 10_000 })).motivo, "sem_migracao");
    assert.equal(await tocarDesafio({ accountId: null, contactId: "00000000-0000-0000-0000-000000000000", instagramRecipientId: "x", eventId: null, payload: "desafio:abc:comecar" }), false);

    const conta = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
    const postId = await insertPost(db, conta, {
      status: "published", published_media_id: "m1", published_at: new Date(), source: "molde", external_ref: "proj-1:r1", title: "Post",
      keyword: "SONO", dm_text: "Oi! Toque abaixo.", link_url: "", first_comment: "",
      automation_options: JSON.stringify({ desafio: { id: "11111111-2222-3333-4444-555555555555" } }),
    });
    const [post] = await db.sql("select * from public.content_posts where id = $1", [postId]);
    const repos = await import("@/lib/db/repositories");
    const scheduler = await import("@/lib/content/scheduler");
    const feito = await scheduler.afterPublish(post as never, await repos.getConfig(conta), "m1");
    assert.equal(feito.automation, true);
    const [auto] = await db.sql<{ welcome_dm: string }>("select welcome_dm from public.automations");
    assert.equal(auto.welcome_dm, "Oi! Toque abaixo.", "sem a 0017 a DM sai como antes");
    const [nota] = await db.sql<{ last_error: string | null }>("select last_error from public.content_posts where id = $1", [postId]);
    assert.match(String(nota.last_error), /0017/);
  });
});
