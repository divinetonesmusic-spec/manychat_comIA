import "./helpers/env.mjs";
import { comAfter } from "./helpers/escopo-next.mjs";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { BASE_URL, request, routeParams } from "./helpers/http.mjs";
import { insertPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Roteiro de DM com vídeo do avatar (Molde v133, K-DMVIDEO, 0014): comentou a palavra → a 1ª mensagem pergunta por quê;
 * respondeu → as palavras escolhem o vídeo (sem casar, o geral); o vídeo sai em até 15 min, o link só depois; o Nicolas recebe
 * o aviso no Telegram; o funil por post (comentários → respondeu → vídeo enviado → clique → compra) e o gargalo.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const MEDIA = "media-reel-sono";
const REF = "proj-1:reel-sono";
const VIDEO = (nome: string) => `https://midia.teste.invalid/uaiflow/molde-dmvideos/2026-10/${nome}.mp4`;
const VIDEOS = [
  { chave: "acorda-de-madrugada", titulo: "Acorda de madrugada", palavras: ["madrugada", "acordo", "3h", "acordar no meio da noite"], texto: "Entendi! Gravei isto para você:", videoUrl: VIDEO("madrugada"), tamanho: 18_000_000, duracaoSeg: 118 },
  { chave: "nao-consegue-pegar-no-sono", titulo: "Não consegue pegar no sono", palavras: ["pegar no sono", "insonia", "demoro", "deito"], videoUrl: VIDEO("pegar") },
  { chave: "geral", titulo: "O método em 2 minutos", palavras: [], geral: true, texto: "Olha este vídeo curto:", videoUrl: VIDEO("geral") },
];
const banco: TestDatabase | null = semBanco ? null : await createTestDatabase();

describe("DM com vídeo (sem banco)", () => {
  test("escolherVideo: palavra, raiz da palavra, expressão, acento e o geral quando nada casa", async () => {
    const { escolherVideo, parseVideos } = await import("@/lib/db/dm-videos");
    const lidos = parseVideos(VIDEOS);
    assert.ok(!("erro" in lidos));
    if ("erro" in lidos) return;
    const v = lidos.videos;
    assert.equal(escolherVideo("Eu ACORDO toda madrugada às 3h", v)?.video.chave, "acorda-de-madrugada");
    assert.equal(escolherVideo("sofro de insônia faz anos", v)?.video.chave, "nao-consegue-pegar-no-sono", "sem acento e com a raiz");
    assert.equal(escolherVideo("demorando muito pra pegar no sono", v)?.video.chave, "nao-consegue-pegar-no-sono", "expressão vale 2");
    const geral = escolherVideo("quero saber mais", v);
    assert.equal(geral?.video.chave, "geral");
    assert.equal(geral?.motivo, "geral");
    assert.equal(escolherVideo("Quero", v.filter((x) => !x.geral)), null, "sem geral e sem casar: null (segue o modo de sempre)");
  });

  test("parseVideos: regras e frases em português (25 MB da Meta, https .mp4/.mov, um geral só, palavras)", async () => {
    const { parseVideos } = await import("@/lib/db/dm-videos");
    const erro = (x: unknown) => { const r = parseVideos(x); return "erro" in r ? r.erro : ""; };
    assert.match(erro([]), /1 a 6/);
    assert.match(erro([{ ...VIDEOS[0], tamanho: 30 * 1024 * 1024 }]), /25 MB/);
    assert.match(erro([{ ...VIDEOS[0], videoUrl: "http://x.teste/a.mp4" }]), /https/);
    assert.match(erro([{ ...VIDEOS[0], videoUrl: "https://x.teste/a.avi" }]), /\.mp4 ou \.mov/);
    assert.match(erro([{ ...VIDEOS[0], palavras: [] }]), /palavras/);
    assert.match(erro([VIDEOS[2], { ...VIDEOS[2], chave: "outro" }]), /Só um vídeo pode ser o geral/);
    assert.match(erro([VIDEOS[0], VIDEOS[0]]), /mesma chave/);
    assert.match(erro(new Array(7).fill(VIDEOS[0])), /No máximo 6/);
    const ok = parseVideos([{ ...VIDEOS[0], chave: "Acorda de Madrugada!", palavras: ["Madrugada", "madrugada", " "] }]);
    assert.ok(!("erro" in ok) && ok.videos[0].chave === "acorda-de-madrugada" && ok.videos[0].palavras.join() === "madrugada");
  });

  test("gargaloFunil: tráfego, conversa (resposta, vídeo, clique), página e nenhum", async () => {
    const { gargaloFunil } = await import("@/lib/db/dm-videos");
    assert.equal(gargaloFunil({ comentarios: 0, responderam: 0, videos: 0, cliques: 0, compras: 0 }).tipo, "trafego");
    assert.equal(gargaloFunil({ comentarios: 8, responderam: 6, videos: 6, cliques: 3, compras: 1 }).etapa, "comentarios");
    assert.equal(gargaloFunil({ comentarios: 40, responderam: 30, videos: 30, cliques: 10, compras: 1, views: 50_000 }).tipo, "trafego", "menos de 3 comentários por mil views");
    const resposta = gargaloFunil({ comentarios: 100, responderam: 10, videos: 10, cliques: 3, compras: 0 });
    assert.deepEqual([resposta.etapa, resposta.tipo], ["resposta", "conversa"]);
    assert.match(resposta.frase, /10 %/);
    assert.equal(gargaloFunil({ comentarios: 100, responderam: 50, videos: 20, cliques: 10, compras: 1 }).etapa, "video");
    assert.equal(gargaloFunil({ comentarios: 100, responderam: 50, videos: 50, cliques: 4, compras: 1 }).etapa, "clique");
    const pagina = gargaloFunil({ comentarios: 200, responderam: 100, videos: 100, cliques: 50, compras: 0 });
    assert.deepEqual([pagina.etapa, pagina.tipo], ["compra", "pagina"]);
    assert.equal(gargaloFunil({ comentarios: 100, responderam: 50, videos: 50, cliques: 20, compras: 2 }).tipo, "nenhum");
    const pouca = gargaloFunil({ comentarios: 25, responderam: 9, videos: 9, cliques: 0, compras: 0 });
    assert.deepEqual([pouca.etapa, pouca.tipo], [null, "nenhum"], "36 % de resposta passa; o vídeo e o clique têm menos de 10 pessoas: não são julgados");
  });

  test("o pacote do post: modo vídeo vale mesmo sem mensagens; modo errado → erro; videoAposMinutos até 15", async () => {
    const { parseSequencia } = await import("@/lib/db/dm-sequencias");
    const s = parseSequencia({ modo: "video", videoAposMinutos: 40 });
    assert.ok(s && !("erro" in s));
    if (s && !("erro" in s)) {
      assert.equal(s.modo, "video");
      assert.equal(s.videoAposMinutos, 15);
    }
    assert.match(String((parseSequencia({ modo: "audio", mensagem2: "x" }) as { erro: string }).erro), /link.*video/);
    const padrao = parseSequencia({ mensagem2: "x" });
    assert.ok(padrao && !("erro" in padrao) && padrao.modo === "link" && padrao.videoAposMinutos === 3);
  });

  test("alertaTexto: quem, o post, o que respondeu, qual vídeo e a hora de Brasília", async () => {
    const { alertaTexto } = await import("@/lib/db/dm-videos");
    const t = alertaTexto({ username: "maria", post: "Durma em 10 min", resposta: "acordo às 3h", titulo: "Acorda de madrugada", chave: "x", sai_em: new Date("2026-10-24T22:03:00Z") });
    assert.match(t, /@maria respondeu no post «Durma em 10 min»: "acordo às 3h"/);
    assert.match(t, /«Acorda de madrugada» às 19:03 \(horário de Brasília\)/);
    assert.match(t, /até 15 min/);
  });
});

describe("DM com vídeo (com banco)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let webhook: typeof import("@/app/api/webhook/route");
  let drain: typeof import("@/lib/queue/drain");
  let repos: typeof import("@/lib/db/repositories");
  let rota: typeof import("@/app/api/molde/dmvideo/route");
  let funil: typeof import("@/app/api/molde/dmvideo/funil/route");
  let links: typeof import("@/app/api/molde/links/route");
  let redirecionar: typeof import("@/app/l/[slug]/route");
  let scheduler: typeof import("@/lib/content/scheduler");
  let videosLib: typeof import("@/lib/db/dm-videos");
  let r2: typeof import("@/lib/content/r2");
  let conta: string;
  let linkSlug: string;
  let n = 0;

  before(async () => {
    db = banco!;
    webhook = await import("@/app/api/webhook/route");
    drain = await import("@/lib/queue/drain");
    repos = await import("@/lib/db/repositories");
    rota = await import("@/app/api/molde/dmvideo/route");
    funil = await import("@/app/api/molde/dmvideo/funil/route");
    links = await import("@/app/api/molde/links/route");
    redirecionar = await import("@/app/l/[slug]/route");
    scheduler = await import("@/lib/content/scheduler");
    videosLib = await import("@/lib/db/dm-videos");
    r2 = await import("@/lib/content/r2");
  });

  beforeEach(async () => {
    meta.reset();
    n = 0;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    for (const tabela of ["vendas", "dm_videos", "dm_sequencias", "dm_pending", "queue", "events", "contacts", "content_posts", "automations", "tracked_links", "profile_settings", "instagram_accounts"]) await db.sql(`delete from public.${tabela}`);
    conta = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
    const link = await links.POST(request("/api/molde/links", { headers: MOLDE, json: { accountId: conta, externalRef: REF, destino: "https://loja.teste.invalid/metodo-sono" } }));
    linkSlug = ((await link.json()) as { data: { slug: string } }).data.slug;
    const postId = await insertPost(db, conta, {
      status: "published", published_media_id: MEDIA, published_at: new Date(Date.now() - 60_000), source: "molde", external_ref: REF, title: "Durma em 10 min",
      keyword: "SONO", dm_text: "Valeu por comentar no vídeo! O que te fez comentar?", link_url: "", first_comment: "",
      automation_options: JSON.stringify({
        quickReplyLabel: "",
        sequencia: { modo: "video", videoAposMinutos: 3, mensagem2: "Gravei um vídeo para você:", mensagem3: "Se fizer sentido, o método completo está aqui:", linkUrl: `${BASE_URL}/l/${linkSlug}?de=dm`, linkLabel: "Ver o método", linkAposSegundos: 150, lembrete: "Conseguiu ver o vídeo?", lembreteHoras: 22 },
      }),
    });
    const [post] = await db.sql("select * from public.content_posts where id = $1", [postId]);
    const feito = await scheduler.afterPublish(post as never, await repos.getConfig(conta), MEDIA);
    assert.equal(feito.automation, true);
  });

  after(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    meta.restore();
    await db?.close();
  });

  async function webhookPost(entry: Record<string, unknown>) {
    const corpo = JSON.stringify({ object: "instagram", entry: [{ id: "1001", time: Date.now(), ...entry }] });
    const assinatura = `sha256=${createHmac("sha256", process.env.INSTAGRAM_APP_SECRET as string).update(corpo).digest("hex")}`;
    const pedido = new NextRequest(new URL("/api/webhook", BASE_URL), { method: "POST", body: corpo, headers: { "x-hub-signature-256": assinatura, "content-type": "application/json" } });
    assert.equal((await comAfter(() => webhook.POST(pedido))).status, 200);
  }
  const comentar = (de: string) => webhookPost({ changes: [{ field: "comments", value: { id: `c-${de}-${++n}`, text: "SONO", from: { id: de, username: `u_${de}` }, media: { id: MEDIA } } }] });
  const escrever = (de: string, texto: string) => webhookPost({ messaging: [{ sender: { id: de, username: `u_${de}` }, recipient: { id: "1001" }, timestamp: Date.now(), message: { mid: `m-${de}-${++n}`, text: texto } }] });
  const fila = () => db.sql<{ id: string; send_type: string; status: string; available_at: Date; payload: Record<string, unknown>; contact_id: string }>(
    "select id, send_type, status, available_at, payload, contact_id from public.queue order by available_at, created_at",
  );
  const cadastrar = (json: Record<string, unknown>) => rota.POST(request("/api/molde/dmvideo", { headers: MOLDE, json }));

  test("POST/GET /api/molde/dmvideo: exige o token, guarda por post, troca a lista e recusa o que a Meta não aceita", async () => {
    assert.equal((await rota.GET(request(`/api/molde/dmvideo?ref=${encodeURIComponent(REF)}`))).status, 401);
    const ok = await cadastrar({ accountId: conta, externalRef: REF, videos: VIDEOS });
    assert.equal(ok.status, 200, await ok.clone().text());
    const lidos = (await (await rota.GET(request(`/api/molde/dmvideo?ref=${encodeURIComponent(REF)}&accountId=${conta}`, { headers: MOLDE }))).json()) as { data: { videos: Array<{ chave: string; geral: boolean }> } };
    assert.deepEqual(lidos.data.videos.map((v) => v.chave), ["acorda-de-madrugada", "nao-consegue-pegar-no-sono", "geral"]);
    const [linha] = await db.sql<{ r2_key: string }>("select r2_key from public.dm_videos where chave = 'geral'");
    assert.equal(linha.r2_key, "uaiflow/molde-dmvideos/2026-10/geral.mp4");
    assert.equal(r2.isProtectedKey(linha.r2_key), true, "o vídeo de resposta nunca sai junto com a mídia de um post");
    await cadastrar({ accountId: conta, externalRef: REF, videos: [VIDEOS[0], VIDEOS[2]] });
    assert.equal((await db.sql("select * from public.dm_videos")).length, 2, "a lista nova troca a de antes");
    const grande = await cadastrar({ externalRef: REF, videos: [{ ...VIDEOS[0], tamanho: 26 * 1024 * 1024 }] });
    assert.equal(grande.status, 400);
    assert.match(((await grande.json()) as { error: string }).error, /25 MB/);
    assert.equal((await cadastrar({ videos: VIDEOS })).status, 400, "sem post nem palavra");
  });

  test("respondeu: o vídeo escolhido pela resposta sai em 3 min (sem o passo 2 de texto), o link 150 s depois do vídeo, o lembrete 22 h depois", async () => {
    await cadastrar({ accountId: conta, externalRef: REF, videos: VIDEOS });
    await comentar("p1");
    const [primeira] = (await fila()).filter((j) => j.send_type === "private_reply");
    assert.equal(primeira.payload.text, "Valeu por comentar no vídeo! O que te fez comentar?");
    assert.equal(primeira.payload.url, undefined, "a 1ª mensagem não leva link");
    const antes = Date.now();
    await escrever("p1", "Acordo toda madrugada e não durmo mais");
    const dms = (await fila()).filter((j) => j.send_type === "dm");
    assert.deepEqual(dms.map((j) => j.payload.passo), ["video", 3, 4]);
    const [video, link, lembrete] = dms;
    assert.equal(video.payload.type, "media");
    assert.equal(video.payload.mediaType, "video");
    assert.equal(video.payload.mediaUrl, VIDEO("madrugada"));
    assert.equal(video.payload.videoChave, "acorda-de-madrugada");
    assert.equal(video.payload.text, "Entendi! Gravei isto para você:", "a frase do vídeo vale mais que a mensagem 2");
    const minutos = (new Date(video.available_at).getTime() - antes) / 60_000;
    assert.ok(minutos > 2.9 && minutos < 3.2, `o vídeo sai 3 min depois (${minutos})`);
    assert.ok(Math.abs(new Date(link.available_at).getTime() - new Date(video.available_at).getTime() - 150_000) < 3_000, "o link só depois do vídeo");
    const [seq] = await db.sql<{ chave: string; resposta_texto: string; video_chave: string; video_queue_id: string }>("select * from public.dm_sequencias");
    assert.equal(link.payload.url, `${BASE_URL}/l/${linkSlug}?de=dm&s=${seq.chave}`);
    assert.ok(Math.abs(new Date(lembrete.available_at).getTime() - antes - 22 * 3_600_000) < 10_000);
    assert.equal(seq.resposta_texto, "Acordo toda madrugada e não durmo mais");
    assert.equal(seq.video_chave, "acorda-de-madrugada");
    assert.equal(seq.video_queue_id, video.id);
    assert.equal((await db.sql("select * from public.dm_pending")).length, 0, "a resposta seguiu o roteiro: não vira DM sem resposta");

    // o relógio manda o vídeo quando vence: a Meta recebe o texto e o anexo de vídeo (attachment type video, payload.url)
    await db.sql("update public.queue set available_at = now() - interval '1 second' where id = $1", [video.id]);
    await drain.drainQueue(40, 20_000);
    const enviados = meta.calls.filter((c) => c.path.endsWith("/messages") && c.method === "POST").map((c) => c.body.message as Record<string, unknown>);
    const anexo = enviados.find((m) => (m.attachment as { type?: string } | undefined)?.type === "video") as { attachment: { payload: { url: string } } };
    assert.equal(anexo.attachment.payload.url, VIDEO("madrugada"));
  });

  test("nada casou: vai o vídeo geral; sem vídeos cadastrados: segue o modo de sempre (passo 2, o link e o lembrete)", async () => {
    await cadastrar({ accountId: conta, externalRef: REF, videos: VIDEOS });
    await comentar("p2");
    await escrever("p2", "quero entender melhor");
    assert.equal((await fila()).find((j) => j.payload.passo === "video")?.payload.videoChave, "geral");

    await db.sql("delete from public.dm_videos");
    await comentar("p3");
    await escrever("p3", "acordo de madrugada");
    const passos = (await db.sql<{ passo: string }>(
      "select q.payload ->> 'passo' as passo from public.queue q join public.contacts c on c.id = q.contact_id where c.instagram_user_id = 'p3' and q.send_type = 'dm' order by q.available_at",
    )).map((r) => r.passo);
    assert.deepEqual(passos, ["2", "3", "4"]);
  });

  test("os vídeos da palavra valem para os posts sem vídeos próprios", async () => {
    await cadastrar({ accountId: conta, keyword: "sono", videos: VIDEOS });
    const [linha] = await db.sql<{ keyword: string; external_ref: string }>("select keyword, external_ref from public.dm_videos limit 1");
    assert.deepEqual([linha.keyword, linha.external_ref], ["SONO", ""]);
    await comentar("p4");
    await escrever("p4", "tenho insônia");
    assert.equal((await fila()).find((j) => j.payload.passo === "video")?.payload.videoChave, "nao-consegue-pegar-no-sono");
  });

  test("aviso no Telegram: uma vez por resposta, com o que ela escreveu e qual vídeo sai; sem Telegram, nada", async () => {
    await cadastrar({ accountId: conta, externalRef: REF, videos: VIDEOS });
    await comentar("p5");
    await escrever("p5", "acordo às 3h");
    assert.deepEqual(await videosLib.avisarRespostasVideo(), { sent: 0, skipped: "sem_telegram" });
    process.env.TELEGRAM_BOT_TOKEN = "123:TOKEN-FALSO";
    process.env.TELEGRAM_CHAT_ID = "42";
    assert.deepEqual(await videosLib.avisarRespostasVideo(), { sent: 1 });
    assert.deepEqual(await videosLib.avisarRespostasVideo(), { sent: 0 }, "não repete");
    const texto = String(meta.telegram[0].body.text);
    assert.match(texto, /@u_p5 respondeu no post «Durma em 10 min»: "acordo às 3h"/);
    assert.match(texto, /«Acorda de madrugada» às \d{2}:\d{2} \(horário de Brasília\)/);
  });

  test("GET /api/molde/dmvideo/funil: comentários → responderam → vídeo enviado → clique → compra, o sinal de visto e o gargalo", async () => {
    await cadastrar({ accountId: conta, externalRef: REF, videos: VIDEOS });
    for (const p of ["a", "b", "c"]) await comentar(p);
    await escrever("a", "acordo de madrugada");
    await escrever("b", "nada");
    await db.sql("update public.queue set available_at = now() - interval '1 second' where payload ->> 'passo' = 'video'");
    await drain.drainQueue(40, 20_000);
    const [seqA] = await db.sql<{ chave: string }>("select s.chave from public.dm_sequencias s join public.contacts c on c.id = s.contact_id where c.instagram_user_id = 'a'");
    await new Promise((ok) => setTimeout(ok, 20));
    const ida = await redirecionar.GET(request(`/l/${linkSlug}?de=dm&s=${seqA.chave}`, { headers: { "user-agent": "Mozilla/5.0 Instagram" } }), routeParams({ slug: linkSlug }));
    assert.equal(ida.status, 302);
    // a venda que voltou com a origem do post (0012) conta como compra; a de teste e a reembolsada não
    await db.sql("update public.tracked_links set origem = 'mo1sono' where external_ref = $1", [REF]);
    await db.sql(`insert into public.vendas (plataforma, raw_id, valor, moeda, status, origem, teste) values
      ('stripe', 'v1', 27, 'USD', 'paga', 'mo1sono', false), ('stripe', 'v2', 27, 'USD', 'paga', 'mo1sono', true), ('stripe', 'v3', 27, 'USD', 'reembolsada', 'mo1sono', false)`);
    assert.equal((await funil.GET(request(`/api/molde/dmvideo/funil?refs=${encodeURIComponent(REF)}`))).status, 401);
    const resposta = await funil.GET(request(`/api/molde/dmvideo/funil?refs=${encodeURIComponent(REF)},sem-post&views=1000`, { headers: MOLDE }));
    assert.equal(resposta.status, 200);
    const corpo = ((await resposta.json()) as { data: { posts: Array<Record<string, unknown>>; nota: string; aviso?: string } }).data;
    assert.equal(corpo.aviso, undefined);
    assert.match(corpo.nota, /não informa se a pessoa assistiu/);
    const [x, vazio] = corpo.posts as Array<{ comentarios: number; responderam: number; videos: number; cliques: number; compras: number; views: number; comSinalDeVisto: number; porVideo: Array<{ chave: string; enviados: number; cliques: number }>; gargalo: { tipo: string } }>;
    assert.deepEqual([x.comentarios, x.responderam, x.videos, x.cliques, x.compras, x.views], [3, 2, 2, 1, 1, 1000]);
    assert.equal(x.comSinalDeVisto, 1, "tocou no link depois do vídeo");
    assert.deepEqual(x.porVideo.sort((a, b) => a.chave.localeCompare(b.chave)), [{ chave: "acorda-de-madrugada", enviados: 1, cliques: 1 }, { chave: "geral", enviados: 1, cliques: 0 }]);
    assert.equal(x.gargalo.tipo, "trafego", "3 comentários: o gargalo é o tráfego");
    assert.equal((vazio as { comentarios: number }).comentarios, 0);
  });
});
