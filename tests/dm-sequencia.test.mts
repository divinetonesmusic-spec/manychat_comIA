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
 * Sequência de DM por post (2-DM, 0012): comentou a palavra → 1ª mensagem (sem link); respondeu → passo 2 (valor), passo 3
 * (o link com ?de=dm) e o lembrete antes de fechar as 24 h; tocou no link ou escreveu de novo → o lembrete não sai.
 * E a contagem das DMs por post (GET /api/molde/dms/contagem). Webhook assinado como a Meta assina; Meta falsa.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const MEDIA = "media-reel-1";
const REF = "proj-1:reel-1";
// O banco antes de qualquer módulo do app (o pool lê DATABASE_URL ao carregar).
const banco: TestDatabase | null = semBanco ? null : await createTestDatabase();

describe("sequência de DM (sem banco)", () => {
  test("parseSequencia: padrões, limites e erros em português", async () => {
    const { parseSequencia } = await import("@/lib/db/dm-sequencias");
    assert.equal(parseSequencia(undefined), undefined);
    assert.equal(parseSequencia(null), null);
    assert.equal(parseSequencia({}), null, "sem nenhuma mensagem = sem sequência");
    assert.deepEqual(parseSequencia({ mensagem2: " Valor ", mensagem3: "O link", linkUrl: "https://u.teste/l/abc1234?de=dm", lembrete: "Lembrete", lembreteHoras: 30, linkAposSegundos: -5 }), {
      mensagem2: "Valor", mensagem3: "O link", linkUrl: "https://u.teste/l/abc1234?de=dm", linkLabel: "Abrir link", linkAposSegundos: 0, lembrete: "Lembrete", lembreteHoras: 23,
    });
    assert.match(String((parseSequencia({ mensagem2: "x", linkUrl: "http://inseguro" }) as { erro: string }).erro), /https/);
    assert.match(String((parseSequencia({ mensagem2: "x", linkUrl: "https://ok.teste" }) as { erro: string }).erro), /mensagem3/);
    assert.match(String((parseSequencia("texto") as { erro: string }).erro), /objeto/);
    assert.match(String((parseSequencia({ mensagem2: "a".repeat(1001) }) as { erro: string }).erro), /1000/);
  });

  test("o pacote do post: sequência errada → erro; certa vai em automationOptions.sequencia", async () => {
    const { parsePostPackage } = await import("@/lib/content/package");
    const base = { publishType: "reel", mediaUrl: "https://midia.teste.invalid/r.mp4", keyword: "ORACAO", dmText: "Valeu! O que te fez comentar?" };
    const ruim = parsePostPackage({ ...base, automationOptions: { sequencia: { mensagem2: "x", linkUrl: "ftp://x" } } });
    assert.equal(ruim.ok, false);
    const semPalavra = parsePostPackage({ ...base, keyword: "", automationOptions: { sequencia: { mensagem2: "x" } } });
    assert.equal(semPalavra.ok, false);
    const bom = parsePostPackage({ ...base, automationOptions: { quickReplyLabel: "Quero", sequencia: { mensagem2: "Dica", mensagem3: "Aqui", linkUrl: "https://u.teste/l/abc1234?de=dm", linkLabel: "Abrir", lembrete: "Oi de novo" } } });
    assert.ok(bom.ok);
    if (bom.ok) assert.equal(bom.value.automationOptions?.sequencia?.mensagem3, "Aqui");
  });
});

describe("sequência de DM (com banco)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let webhook: typeof import("@/app/api/webhook/route");
  let drain: typeof import("@/lib/queue/drain");
  let repos: typeof import("@/lib/db/repositories");
  let seqLib: typeof import("@/lib/db/dm-sequencias");
  let contagem: typeof import("@/app/api/molde/dms/contagem/route");
  let dmsItem: typeof import("@/app/api/molde/dms/[id]/route");
  let links: typeof import("@/app/api/molde/links/route");
  let redirecionar: typeof import("@/app/l/[slug]/route");
  let scheduler: typeof import("@/lib/content/scheduler");
  let conta: string;
  let automacaoId: string;
  let linkSlug: string;
  let n = 0;

  before(async () => {
    db = banco!;
    webhook = await import("@/app/api/webhook/route");
    drain = await import("@/lib/queue/drain");
    repos = await import("@/lib/db/repositories");
    seqLib = await import("@/lib/db/dm-sequencias");
    contagem = await import("@/app/api/molde/dms/contagem/route");
    dmsItem = await import("@/app/api/molde/dms/[id]/route");
    links = await import("@/app/api/molde/links/route");
    redirecionar = await import("@/app/l/[slug]/route");
    scheduler = await import("@/lib/content/scheduler");
  });

  beforeEach(async () => {
    meta.reset();
    n = 0;
    for (const tabela of ["dm_sequencias", "dm_pending", "queue", "events", "contacts", "content_posts", "automations", "tracked_links", "profile_settings", "instagram_accounts"]) await db.sql(`delete from public.${tabela}`);
    conta = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
    const link = await links.POST(request("/api/molde/links", { headers: MOLDE, json: { accountId: conta, externalRef: REF, destino: "https://loja.teste.invalid/ebook" } }));
    const linkJson = (await link.json()) as { data: { slug: string } };
    assert.ok(linkJson.data, JSON.stringify(linkJson));
    linkSlug = linkJson.data.slug;
    // O post publicado do Molde e a automação que o UaiFlow cria depois de publicar (scheduler.afterPublish).
    const postId = await insertPost(db, conta, {
      status: "published", published_media_id: MEDIA, published_at: new Date(Date.now() - 60_000), source: "molde", external_ref: REF,
      keyword: "ORACAO", dm_text: "Valeu por comentar! O que te fez comentar?", link_url: "", first_comment: "",
      automation_options: JSON.stringify({
        quickReplyLabel: "Quero",
        sequencia: { mensagem2: "Uma dica: reze 3 minutos antes de dormir.", mensagem3: "Aqui está o guia completo:", linkUrl: `${BASE_URL}/l/${linkSlug}?de=dm`, linkLabel: "Abrir o guia", linkAposSegundos: 60, lembrete: "Passando para lembrar do guia 🙏", lembreteHoras: 22 },
      }),
    });
    const [post] = await db.sql("select * from public.content_posts where id = $1", [postId]);
    const config = await repos.getConfig(conta);
    const feito = await scheduler.afterPublish(post as never, config, MEDIA);
    assert.equal(feito.automation, true);
    [{ id: automacaoId }] = await db.sql<{ id: string }>("select id from public.automations");
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  async function webhookPost(entry: Record<string, unknown>) {
    const corpo = JSON.stringify({ object: "instagram", entry: [{ id: "1001", time: Date.now(), ...entry }] });
    const assinatura = `sha256=${createHmac("sha256", process.env.INSTAGRAM_APP_SECRET as string).update(corpo).digest("hex")}`;
    const pedido = new NextRequest(new URL("/api/webhook", BASE_URL), { method: "POST", body: corpo, headers: { "x-hub-signature-256": assinatura, "content-type": "application/json" } });
    const resposta = await comAfter(() => webhook.POST(pedido));
    assert.equal(resposta.status, 200);
  }
  const comentar = (de: string, texto = "ORACAO") => webhookPost({ changes: [{ field: "comments", value: { id: `c-${de}-${++n}`, text: texto, from: { id: de, username: `u_${de}` }, media: { id: MEDIA } } }] });
  const mensagem = (de: string, message: Record<string, unknown>) => webhookPost({ messaging: [{ sender: { id: de, username: `u_${de}` }, recipient: { id: "1001" }, timestamp: Date.now(), message: { mid: `m-${de}-${++n}`, ...message } }] });
  const tocarBotao = (de: string) => mensagem(de, { text: "Quero", quick_reply: { payload: `automation:${automacaoId}` } });
  const escrever = (de: string, texto: string) => mensagem(de, { text: texto });

  const fila = () => db.sql<{ id: string; send_type: string; status: string; available_at: Date; payload: Record<string, unknown>; last_error: string | null }>(
    "select id, send_type, status, available_at, payload, last_error from public.queue order by available_at, created_at",
  );
  const sequencias = () => db.sql<{ etapa: string; chave: string; respondeu_em: Date | null; clicou_em: Date | null; respondeu_depois_em: Date | null; lembrete_queue_id: string | null }>("select * from public.dm_sequencias");
  /** Faz os envios que já venceram (como o relógio), e conta as mensagens que saíram para a Meta. */
  async function relogio() {
    await drain.drainQueue(40, 20_000);
  }

  test("depois de publicar, a sequência fica na automação do post; a 1ª mensagem sai sem link", async () => {
    const [automacao] = await db.sql<{ sequencia: Record<string, unknown>; welcome_dm: string; link_url: string }>("select sequencia, welcome_dm, link_url from public.automations");
    assert.equal(automacao.sequencia.mensagem3, "Aqui está o guia completo:");
    assert.equal(automacao.link_url, "");
    await comentar("pessoa1");
    const [primeira] = (await fila()).filter((job) => job.send_type === "private_reply");
    assert.equal(primeira.payload.text, "Valeu por comentar! O que te fez comentar?");
    assert.equal(primeira.payload.url, undefined, "sem link na 1ª mensagem");
    assert.deepEqual((await sequencias()).map((s) => s.etapa), ["aguardando_resposta"]);
  });

  test("tocou no botão: passo 2 agora, passo 3 (o link com ?de=dm e a chave da pessoa) 60 s depois, lembrete 22 h depois; toque repetido não manda de novo", async () => {
    await comentar("pessoa1");
    await relogio();
    await tocarBotao("pessoa1");
    await tocarBotao("pessoa1");
    const dms = (await fila()).filter((job) => job.send_type === "dm");
    assert.deepEqual(dms.map((job) => job.payload.passo), [2, 3, 4]);
    const [passo2, passo3, lembrete] = dms;
    const [seq] = await sequencias();
    assert.equal(seq.etapa, "em_andamento");
    assert.equal(passo2.payload.text, "Uma dica: reze 3 minutos antes de dormir.");
    assert.equal(passo2.payload.url, undefined);
    assert.equal(passo3.payload.type, "link");
    assert.equal(passo3.payload.url, `${BASE_URL}/l/${linkSlug}?de=dm&s=${seq.chave}`);
    assert.equal(passo3.payload.buttonLabel, "Abrir o guia");
    const delta = (job: { available_at: Date }) => new Date(job.available_at).getTime() - new Date(passo2.available_at).getTime();
    assert.ok(Math.abs(delta(passo3) - 60_000) < 5_000, "o link sai 60 s depois do valor");
    assert.ok(Math.abs(delta(lembrete) - 22 * 3_600_000) < 5_000, "o lembrete sai 22 h depois (dentro das 24 h)");
    assert.equal(seq.lembrete_queue_id, lembrete.id);

    await relogio(); // só o passo 2 já venceu
    const depois = await fila();
    assert.deepEqual(depois.filter((job) => job.send_type === "dm").map((job) => job.status), ["sent", "pending", "pending"]);
  });

  test("tocou no link do passo 3 (/l/...&s=chave): conta o clique da DM e o lembrete não sai", async () => {
    await comentar("pessoa1");
    await tocarBotao("pessoa1");
    const [seq] = await sequencias();
    const ida = await redirecionar.GET(request(`/l/${linkSlug}?de=dm&s=${seq.chave}`, { headers: { "user-agent": "Mozilla/5.0 Instagram" } }), routeParams({ slug: linkSlug }));
    assert.equal(ida.status, 302);
    const [depois] = await sequencias();
    assert.ok(depois.clicou_em);
    assert.equal(depois.etapa, "concluida");
    const lembrete = (await fila()).find((job) => job.payload.passo === 4)!;
    assert.equal(lembrete.status, "skipped");
    assert.match(String(lembrete.last_error), /tocou no link/);
    const [clique] = await db.sql<{ origin: string }>("select origin from public.link_clicks");
    assert.equal(clique.origin, "dm");
  });

  test("respondeu escrevendo (sem tocar no botão): a sequência segue; escreveu de novo: o lembrete sai da fila e a mensagem vai para o Molde", async () => {
    await comentar("pessoa2");
    await escrever("pessoa2", "Comentei porque não consigo dormir");
    assert.deepEqual((await fila()).filter((job) => job.send_type === "dm").map((job) => job.payload.passo), [2, 3, 4]);
    assert.equal((await db.sql("select * from public.dm_pending")).length, 0, "a resposta que segue a sequência não vira DM sem resposta");
    await escrever("pessoa2", "E tem para criança?");
    const lembrete = (await fila()).find((job) => job.payload.passo === 4)!;
    assert.equal(lembrete.status, "skipped");
    assert.match(String(lembrete.last_error), /respondeu de novo/);
    assert.equal((await db.sql("select * from public.dm_pending")).length, 1, "a pergunta nova espera a resposta do Molde");
  });

  test("quem não respondeu não recebe nada além da 1ª mensagem (a Meta não deixa)", async () => {
    await comentar("pessoa3");
    await relogio();
    assert.deepEqual((await fila()).map((job) => job.send_type), ["private_reply"]);
  });

  test("pediu para parar: o resto da sequência não sai", async () => {
    await comentar("pessoa4");
    await tocarBotao("pessoa4");
    await escrever("pessoa4", "parar");
    await relogio();
    const dms = (await fila()).filter((job) => job.send_type === "dm" && job.payload.origem === "sequencia_dm");
    assert.ok(dms.every((job) => job.status === "skipped"), JSON.stringify(dms.map((job) => job.status)));
  });

  test("comentou de novo no mesmo dia: não reinicia a sequência que já andou", async () => {
    await comentar("pessoa5");
    await tocarBotao("pessoa5");
    await comentar("pessoa5");
    assert.deepEqual((await sequencias()).map((s) => s.etapa), ["em_andamento"]);
  });

  test("post sem sequência: o toque no botão segue o caminho antigo (link e lembrete da automação)", async () => {
    await db.sql("update public.automations set sequencia = '{}'::jsonb, link_url = 'https://loja.teste.invalid/x', link_text = 'Link:'");
    await repos.syncFollowups((await repos.getAutomation(automacaoId))!);
    await comentar("pessoa6");
    assert.equal((await sequencias()).length, 0);
    await tocarBotao("pessoa6");
    const dms = (await fila()).filter((job) => job.send_type === "dm");
    assert.equal(dms[0].payload.url, "https://loja.teste.invalid/x");
    assert.ok(dms.every((job) => job.payload.origem !== "sequencia_dm"));
  });

  test("GET /api/molde/dms/contagem: DMs disparadas (que saíram) e toques no botão por post; exige o token; antes da rota /dms/<id>", async () => {
    await comentar("pessoa1");
    await comentar("pessoa2");
    await comentar("pessoa3");
    await relogio();
    await tocarBotao("pessoa1");
    await tocarBotao("pessoa1");
    await tocarBotao("pessoa2");
    const refs = `${encodeURIComponent(REF)},${encodeURIComponent("sem-post")}`;
    assert.equal((await contagem.GET(request(`/api/molde/dms/contagem?refs=${refs}`))).status, 401);
    const resposta = await contagem.GET(request(`/api/molde/dms/contagem?refs=${refs}`, { headers: MOLDE }));
    assert.equal(resposta.status, 200);
    const { data } = (await resposta.json()) as { data: Array<Record<string, unknown>> };
    assert.deepEqual(data, [{ ref: REF, disparadas: 3, botao: 2, responderam: 2, clicaram: 0 }]);
    // /api/molde/dms/<id> continua só com POST (a pasta estática "contagem" vem antes dela)
    assert.equal(typeof (dmsItem as Record<string, unknown>).GET, "undefined");
  });

  test("tirar a sequência da automação: fica {} (como antes, só a 1ª mensagem)", async () => {
    assert.equal(await seqLib.salvarSequenciaNaAutomacao(automacaoId, null), true);
    const [automacao] = await db.sql<{ sequencia: Record<string, unknown> }>("select sequencia from public.automations");
    assert.deepEqual(automacao.sequencia, {});
  });
});
