import "./helpers/env.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/**
 * Supabase sem a 0013 (só até a 0012): nada do que existia quebra. As rotas do Molde do quiz, da entrega e da lista
 * respondem 503 com a frase «Falta colar a atualização 0013», e as páginas públicas /q/ e /e/ não abrem (não encontrada).
 */
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };

describe("sem a 0013", { skip: semBanco }, () => {
  let db: TestDatabase;
  after(async () => {
    await db?.close();
  });

  test("as rotas do Molde dizem o que falta e as páginas públicas não abrem", async () => {
    db = await createTestDatabase({ ate: "0012" });
    const { getQuizPublico, getEntregaPublica } = await import("@/lib/db/funil-molde");
    assert.equal(await getQuizPublico("qualquer-um"), null);
    assert.equal(await getEntregaPublica("qualquer-um"), null);
    const quiz = await import("@/app/api/molde/quiz/route");
    const entregas = await import("@/app/api/molde/entregas/route");
    const leads = await import("@/app/api/molde/leads/route");
    const evento = await import("@/app/q/[slug]/evento/route");
    for (const r of [
      await quiz.GET(request("/api/molde/quiz?molde=proj-1", { headers: MOLDE })),
      await entregas.GET(request("/api/molde/entregas?molde=proj-1", { headers: MOLDE })),
      await leads.GET(request("/api/molde/leads?molde=proj-1", { headers: MOLDE })),
      await entregas.POST(request("/api/molde/entregas", { headers: MOLDE, json: { molde: "proj-1", entrega: { titulo: "Guia" } } })),
    ]) {
      assert.equal(r.status, 503);
      const j = (await r.json()) as { error: string; codigo: string };
      assert.equal(j.codigo, "falta_0013");
      assert.match(j.error, /0013/);
    }
    const ev = await evento.POST(request("/q/qualquer-um/evento", { json: { acao: "inicio" } }), routeParams({ slug: "qualquer-um" }));
    assert.equal(ev.status, 404);
  });
});
