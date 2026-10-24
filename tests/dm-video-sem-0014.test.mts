import "./helpers/env.mjs";
import { comAfter } from "./helpers/escopo-next.mjs";
import { createHmac } from "node:crypto";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { BASE_URL, request } from "./helpers/http.mjs";
import { insertPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Supabase sem a 0014 (até a 0012): nada quebra. O post em modo vídeo segue a sequência da 0012 (mensagem 2, o link e o
 * lembrete); cadastrar vídeos responde 503 com a frase da 0014; a lista e o funil respondem com o aviso.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const MEDIA = "media-reel-sem-0014";
const REF = "proj-1:reel-sem-0014";

describe("sem a 0014", { skip: semBanco }, () => {
  let db: TestDatabase;
  after(async () => {
    meta.restore();
    await db?.close();
  });

  test("a sequência da v132 continua; as rotas novas avisam o que falta", async () => {
    db = await createTestDatabase({ ate: "0012" });
    const webhook = await import("@/app/api/webhook/route");
    const repos = await import("@/lib/db/repositories");
    const scheduler = await import("@/lib/content/scheduler");
    const rota = await import("@/app/api/molde/dmvideo/route");
    const funil = await import("@/app/api/molde/dmvideo/funil/route");
    const conta = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
    const postId = await insertPost(db, conta, {
      status: "published", published_media_id: MEDIA, published_at: new Date(Date.now() - 60_000), source: "molde", external_ref: REF,
      keyword: "SONO", dm_text: "Valeu por comentar no vídeo! O que te fez comentar?", link_url: "", first_comment: "",
      automation_options: JSON.stringify({ sequencia: { modo: "video", mensagem2: "Uma dica rápida.", mensagem3: "O método:", linkUrl: "https://loja.teste.invalid/metodo", lembrete: "Viu?" } }),
    });
    const [post] = await db.sql("select * from public.content_posts where id = $1", [postId]);
    assert.equal((await scheduler.afterPublish(post as never, await repos.getConfig(conta), MEDIA)).automation, true);

    const enviar = async (entry: Record<string, unknown>) => {
      const corpo = JSON.stringify({ object: "instagram", entry: [{ id: "1001", time: Date.now(), ...entry }] });
      const assinatura = `sha256=${createHmac("sha256", process.env.INSTAGRAM_APP_SECRET as string).update(corpo).digest("hex")}`;
      const pedido = new NextRequest(new URL("/api/webhook", BASE_URL), { method: "POST", body: corpo, headers: { "x-hub-signature-256": assinatura, "content-type": "application/json" } });
      assert.equal((await comAfter(() => webhook.POST(pedido))).status, 200);
    };
    await enviar({ changes: [{ field: "comments", value: { id: "c-1", text: "SONO", from: { id: "p1", username: "u_p1" }, media: { id: MEDIA } } }] });
    await enviar({ messaging: [{ sender: { id: "p1", username: "u_p1" }, recipient: { id: "1001" }, timestamp: Date.now(), message: { mid: "m-1", text: "acordo de madrugada" } }] });
    const passos = (await db.sql<{ passo: string }>("select payload ->> 'passo' as passo from public.queue where send_type = 'dm' order by available_at")).map((r) => r.passo);
    assert.deepEqual(passos, ["2", "3", "4"], "sem a 0014: a mensagem 2, o link e o lembrete, como na v132");

    const cadastro = await rota.POST(request("/api/molde/dmvideo", { headers: MOLDE, json: { externalRef: REF, videos: [{ chave: "geral", geral: true, videoUrl: "https://midia.teste.invalid/uaiflow/molde-dmvideos/g.mp4" }] } }));
    assert.equal(cadastro.status, 503);
    const erro = (await cadastro.json()) as { error: string; codigo: string };
    assert.equal(erro.codigo, "falta_0014");
    assert.match(erro.error, /0014/);
    const lista = (await (await rota.GET(request(`/api/molde/dmvideo?ref=${encodeURIComponent(REF)}`, { headers: MOLDE }))).json()) as { data: { videos: unknown[] }; aviso: string };
    assert.deepEqual(lista.data.videos, []);
    assert.match(lista.aviso, /0014/);
    const f = (await (await funil.GET(request(`/api/molde/dmvideo/funil?refs=${encodeURIComponent(REF)}`, { headers: MOLDE }))).json()) as { data: Array<{ comentarios: number; responderam: number; videos: number }>; aviso: string };
    assert.match(f.aviso, /0014/);
    assert.deepEqual([f.data[0].comentarios, f.data[0].responderam, f.data[0].videos], [1, 1, 0]);
  });
});
