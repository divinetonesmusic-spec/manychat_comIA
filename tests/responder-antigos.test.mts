import "./helpers/env.mjs";
import { comAfter } from "./helpers/escopo-next.mjs";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta, metaTimestamp, type FakeComment } from "./helpers/fake-meta.mjs";
import { BASE_URL, request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/**
 * «Responder quem já comentou neste post»: a contagem (simulação) antes de mandar, a mesma regra de palavra-chave do
 * webhook, quem já foi respondido (pelo webhook ou por uma rodada anterior), o limite de 7 dias da Meta, o ritmo de
 * 200 por hora e rodar duas vezes sem mandar duas vezes. Meta falsa (tests/helpers/fake-meta.mts).
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const MEDIA = "17900000000000001";
const DONO = "1001";
const banco: TestDatabase | null = semBanco ? null : await createTestDatabase();

const HORA = 3600_000;
const DIA = 24 * HORA;
const ha = (ms: number) => metaTimestamp(new Date(Date.now() - ms));
const comentario = (id: string, texto: string, de: string, idade: number, replies?: FakeComment[]): FakeComment => ({
  id, text: texto, timestamp: ha(idade), from: { id: de, username: `u_${de}` }, ...(replies ? { replies } : {}),
});

describe("responder quem já comentou (sem banco)", () => {
  test("a regra de palavra-chave é a mesma do webhook (automationMatches)", async () => {
    const { automationMatches } = await import("@/lib/db/repositories");
    const base = { active: true, triggers: ["comments"], keywords: ["QUÉRO"], match_type: "contains", post_id: MEDIA, account_id: "a" } as never;
    assert.equal(automationMatches(base, { accountId: "a", trigger: "comments", text: "eu quero!", postId: MEDIA }), true);
    assert.equal(automationMatches(base, { accountId: "a", trigger: "comments", text: "eu quero!", postId: "outro" }), false, "outro post");
    assert.equal(automationMatches(base, { accountId: "a", trigger: "comments", text: "oi", postId: MEDIA }), false);
    assert.equal(automationMatches({ ...(base as object), match_type: "exact" } as never, { accountId: "a", trigger: "comments", text: "eu quero", postId: MEDIA }), false);
    assert.equal(automationMatches({ ...(base as object), active: false } as never, { accountId: "a", trigger: "comments", text: "quero", postId: MEDIA }), false);
  });

  test("o link do post e o tempo estimado", async () => {
    const { codigoDoLink, duracao } = await import("@/lib/responder-antigos");
    assert.equal(codigoDoLink("https://www.instagram.com/reel/DAbc_12-x/?igsh=xyz"), "DAbc_12-x");
    assert.equal(codigoDoLink("https://instagram.com/conta.x/p/ABC123/"), "ABC123");
    assert.equal(codigoDoLink("https://www.instagram.com/reels/ZZZ/"), "ZZZ");
    assert.equal(codigoDoLink("https://exemplo.com/reel/ABC"), null);
    assert.equal(duracao(4 / 200), "cerca de 2 min");
    assert.equal(duracao(300 / 200), "cerca de 1 h 30 min");
    assert.equal(duracao(12000 / 200), "cerca de 3 dias");
  });
});

describe("responder quem já comentou (com banco)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let webhook: typeof import("@/app/api/webhook/route");
  let rota: typeof import("@/app/api/molde/responder-antigos/route");
  let rotaTela: typeof import("@/app/api/automations/[id]/responder-antigos/route");
  let lib: typeof import("@/lib/responder-antigos");
  let repos: typeof import("@/lib/db/repositories");
  let conta: string;
  let automacao: string;

  before(async () => {
    db = banco!;
    webhook = await import("@/app/api/webhook/route");
    rota = await import("@/app/api/molde/responder-antigos/route");
    rotaTela = await import("@/app/api/automations/[id]/responder-antigos/route");
    lib = await import("@/lib/responder-antigos");
    repos = await import("@/lib/db/repositories");
  });

  beforeEach(async () => {
    meta.reset();
    for (const tabela of ["queue", "events", "contacts", "automations", "app_status", "profile_settings", "instagram_accounts"]) await db.sql(`delete from public.${tabela}`);
    conta = await seedAccount(db, { username: "conta_a", userId: DONO, token: "IGAA-TESTE-A" });
    const criada = await repos.createAutomation({
      account_id: conta, name: "Reel viral", triggers: ["comments"], keywords: ["QUERO"], match_type: "contains", post_id: MEDIA,
      public_replies: ["Te mandei no direct!"], welcome_dm: "Oi! Aqui está o que você pediu.",
    });
    automacao = criada.id;
    meta.feed.push({ id: MEDIA, caption: "Reel", timestamp: ha(3 * DIA), permalink: "https://www.instagram.com/reel/VIRAL123/" });
    const enchimento = Array.from({ length: 60 }, (_, i) => comentario(`f${i}`, "que lindo", `f${i}`, 2.5 * DIA + i * 1000));
    meta.comments.set(MEDIA, [
      comentario("c1", "QUERO!", "p1", 1 * DIA),
      comentario("c7", "quero", "p8", 1.2 * DIA),
      comentario("c2", "eu quero", "p2", 2 * DIA, [
        comentario("r1", "quero tbm", "p3", 1.9 * DIA),
        comentario("r2", "legal", "p4", 1.85 * DIA),
        comentario("r3", "Quero", "p5", 1.8 * DIA),
      ]),
      ...enchimento,
      comentario("c3", "quero de novo", "p1", 2.6 * DIA),
      comentario("c4", "oi", "p6", 2.7 * DIA),
      comentario("c6", "QUERO", DONO, 2.8 * DIA),
      comentario("c5", "quero", "p7", 8 * DIA),
    ]);
    // O c7 chegou pelo webhook (a automação já existia para ele): ele já foi respondido.
    await webhookComentario("c7", "quero", "p8");
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  async function webhookComentario(id: string, texto: string, de: string) {
    const corpo = JSON.stringify({ object: "instagram", entry: [{ id: DONO, time: Date.now(), changes: [{ field: "comments", value: { id, text: texto, from: { id: de, username: `u_${de}` }, media: { id: MEDIA } } }] }] });
    const assinatura = `sha256=${createHmac("sha256", process.env.INSTAGRAM_APP_SECRET as string).update(corpo).digest("hex")}`;
    const pedido = new NextRequest(new URL("/api/webhook", BASE_URL), { method: "POST", body: corpo, headers: { "x-hub-signature-256": assinatura, "content-type": "application/json" } });
    const resposta = await comAfter(() => webhook.POST(pedido));
    assert.equal(resposta.status, 200);
  }

  type Vista = import("@/lib/responder-antigos").VistaResponder;
  async function contar(post = "https://www.instagram.com/reel/VIRAL123/?igsh=abc", novo = false) {
    let data: Vista | null = null;
    for (let i = 0; i < 10; i += 1) {
      const search = new URLSearchParams({ automationId: automacao, post, ...(novo && i === 0 ? { novo: "1" } : {}) });
      const resposta = await rota.GET(request(`/api/molde/responder-antigos?${search}`, { headers: MOLDE }));
      const json = (await resposta.json()) as { data: Vista; error?: string };
      assert.equal(resposta.status, 200, JSON.stringify(json));
      data = json.data;
      if (data.estado !== "lendo") break;
    }
    return data!;
  }
  async function confirmar(paraEnviar: number, post = MEDIA) {
    const resposta = await rota.POST(request("/api/molde/responder-antigos", { headers: MOLDE, json: { automationId: automacao, post, paraEnviar } }));
    return { status: resposta.status, json: (await resposta.json()) as { data: Vista; error?: string } };
  }
  const filaDoBackfill = () => db.sql<{ instagram_comment_id: string; send_type: string; available_at: Date; payload: Record<string, unknown> }>(
    "select instagram_comment_id, send_type, available_at, payload from public.queue where payload ->> 'origem' = 'responder_antigos' order by available_at",
  );

  test("a contagem vem antes e nada sai; os números batem", async () => {
    const data = await contar();
    assert.equal(data.estado, "pronto");
    assert.equal(data.mediaId, MEDIA, "o link virou o id da mídia");
    assert.deepEqual(data.numeros, { lidos: 70, combinam: 7, jaRespondidos: 1, repetidos: 1, velhos: 1, semTempo: 0, paraEnviar: 4 });
    assert.match(data.mensagem, /4 pessoas podem receber agora/);
    assert.equal(data.tempoEstimado, "cerca de 2 min");
    assert.equal((await filaDoBackfill()).length, 0, "a simulação não põe ninguém na fila");
    assert.equal(meta.count("/comments", "GET"), 2, "60+ comentários = 2 páginas de 50");
    assert.equal(meta.count("/c2/replies", "GET"), 1, "a 3ª resposta veio pela paginação das respostas");
    assert.equal(meta.count("/messages", "POST"), 0);
  });

  test("confirmar: o número precisa ser o que o dono viu; depois entra na fila como o webhook, no ritmo de 200/h", async () => {
    await contar();
    const errado = await confirmar(5);
    assert.equal(errado.status, 409);
    assert.match(String(errado.json.error), /agora são 4 pessoas/);

    const certo = await confirmar(4);
    assert.equal(certo.status, 200, JSON.stringify(certo.json));
    assert.equal(certo.json.data.estado, "concluido");
    assert.equal(certo.json.data.enfileirados, 4);
    assert.match(certo.json.data.mensagem, /0 de 4 enviadas/);

    const fila = await filaDoBackfill();
    const privadas = fila.filter((j) => j.send_type === "private_reply");
    const publicas = fila.filter((j) => j.send_type === "public_reply");
    // Do comentário mais antigo para o mais novo (o que vence primeiro sai primeiro), 18 s entre um e outro.
    assert.deepEqual(privadas.map((j) => j.instagram_comment_id), ["c2", "r1", "r3", "c1"]);
    assert.deepEqual(publicas.map((j) => j.instagram_comment_id).sort(), ["c1", "c2", "r1", "r3"]);
    const passos = privadas.slice(1).map((j, i) => (j.available_at.getTime() - privadas[i].available_at.getTime()) / 1000);
    for (const s of passos) assert.ok(Math.abs(s - 18) < 2, `espaço de ~18 s (veio ${s})`);
    assert.equal(privadas[0].payload.text, "Oi! Aqui está o que você pediu.", "a mesma 1ª mensagem do webhook");
    assert.ok(privadas.every((j) => typeof j.payload.comentarioEm === "string"));
  });

  test("rodar de novo nunca manda duas vezes (e conta os já respondidos)", async () => {
    await contar();
    await confirmar(4);
    const antes = (await filaDoBackfill()).length;

    const deNovo = await contar(MEDIA, true);
    assert.equal(deNovo.estado, "pronto");
    assert.equal(deNovo.numeros.paraEnviar, 0);
    assert.equal(deNovo.numeros.jaRespondidos, 6, "os 4 de antes + o do webhook + o repetido da mesma pessoa");
    const fim = await confirmar(0);
    assert.equal(fim.status, 200);
    assert.equal((await filaDoBackfill()).length, antes);

    // Mesmo se a contagem for refeita do zero «à força» e confirmada, a marca de cada comentário segura.
    await db.sql("delete from public.queue where payload ->> 'origem' = 'responder_antigos' and send_type = 'public_reply'");
    await db.sql("delete from public.app_status");
    const forcado = await contar(MEDIA);
    assert.equal(forcado.numeros.paraEnviar, 0, "o comentário com marca conta como já respondido");
    const [{ total }] = await db.sql<{ total: string }>("select count(*) as total from public.queue where send_type = 'private_reply'");
    assert.equal(Number(total), 5, "4 do backfill + 1 do webhook, nenhum repetido");
  });

  test("dois pedidos ao mesmo tempo: cada comentário entra na fila uma vez só", async () => {
    await contar();
    const [a, b] = await Promise.all([confirmar(4), confirmar(4)]);
    assert.ok([a.status, b.status].includes(200));
    // O segundo pedido pode chegar com a posse ocupada; chamar de novo termina o que faltar.
    for (let i = 0; i < 3; i += 1) await confirmar(4);
    const privadas = (await filaDoBackfill()).filter((j) => j.send_type === "private_reply");
    assert.equal(privadas.length, 4);
    assert.equal(new Set(privadas.map((j) => j.instagram_comment_id)).size, 4);
  });

  test("a fila pula o que passou de 7 dias (regra da Meta), só para o que veio daqui", async () => {
    await db.sql(
      `insert into public.queue (account_id, instagram_comment_id, instagram_recipient_id, send_type, payload, status)
       values ($1, 'velho', 'pv', 'private_reply', $2, 'pending'), ($1, 'velho', 'pv', 'public_reply', $2, 'pending'),
              ($1, 'novo', 'pn', 'private_reply', $3, 'pending'), ($1, 'webhook', 'pw', 'private_reply', '{"text":"oi"}', 'pending')`,
      [conta, JSON.stringify({ text: "oi", origem: "responder_antigos", comentarioEm: new Date(Date.now() - 7 * DIA - HORA).toISOString() }), JSON.stringify({ text: "oi", origem: "responder_antigos", comentarioEm: new Date(Date.now() - DIA).toISOString() })],
    );
    await repos.markExpiredDmsSkipped();
    const linhas = await db.sql<{ instagram_comment_id: string; send_type: string; status: string; last_error: string | null }>("select instagram_comment_id, send_type, status, last_error from public.queue where instagram_comment_id in ('velho','novo','webhook') order by 1, 2");
    assert.deepEqual(linhas.map((l) => `${l.instagram_comment_id}:${l.send_type}:${l.status}`), ["novo:private_reply:pending", "velho:private_reply:skipped", "velho:public_reply:skipped", "webhook:private_reply:pending"]);
    assert.equal(linhas.find((l) => l.status === "skipped")?.last_error, repos.RESPONDER_ANTIGOS_VENCEU);
  });

  test("quem não daria tempo de receber dentro dos 7 dias no ritmo de 200/h não entra", async () => {
    // O próximo horário livre (de uma rodada anterior) só abre daqui a 5 dias e 12 h: o c2 (2 dias) e as respostas dele
    // vencem antes; o c1 (1 dia) ainda dá.
    await db.sql(
      "insert into public.app_status (chave, valor) values ($1, $2)",
      [`responder_antigos:${automacao}:${MEDIA}`, JSON.stringify({ estado: "concluido", proximoHorario: new Date(Date.now() + 5.5 * DIA).toISOString() })],
    );
    const data = await contar(MEDIA, true);
    assert.equal(data.numeros.semTempo, 3);
    assert.equal(data.numeros.paraEnviar, 1);
  });

  test("o relógio continua a contagem e o envio sozinho; a Meta pedindo para esperar não quebra", async () => {
    const parcial = await lib.simular({ automationId: automacao, post: MEDIA }, 0);
    assert.equal(parcial.estado, "lendo");
    assert.equal(parcial.numeros.lidos, 0);

    meta.commentsFailure = { status: 400, error: { message: "Application request limit reached", code: 4 } };
    await lib.runResponderAntigosClock({ deadline: Date.now() + 8000 });
    const esperando = await lib.simular({ automationId: automacao, post: MEDIA }, 0);
    assert.equal(esperando.estado, "lendo");
    assert.match(String(esperando.erro), /Meta pediu para esperar/);

    meta.commentsFailure = null;
    await db.sql(`update public.app_status set valor = valor || '{"esperarAte": null}'::jsonb where chave like 'responder\\_antigos:%'`);
    await lib.runResponderAntigosClock({ deadline: Date.now() + 8000 });
    const pronto = await lib.simular({ automationId: automacao, post: MEDIA }, 0);
    assert.equal(pronto.estado, "pronto");
    assert.equal(pronto.numeros.paraEnviar, 4);

    // Confirmado pela tela sem tempo de enviar nada: o relógio põe o resto na fila.
    const tela = await rotaTela.POST(request(`/api/automations/${automacao}/responder-antigos`, { json: { post: MEDIA, paraEnviar: 4 } }), routeParams({ id: automacao }));
    assert.equal(tela.status, 200);
    await lib.runResponderAntigosClock({ deadline: Date.now() + 8000 });
    const fim = await lib.simular({ automationId: automacao, post: MEDIA }, 0);
    assert.equal(fim.estado, "concluido");
    assert.equal((await filaDoBackfill()).filter((j) => j.send_type === "private_reply").length, 4);
  });

  test("a Meta travando nos comentários: o erro aparece, a posse é solta, a página diminui e para com erro depois de 6 tentativas", async () => {
    process.env.META_TIMEOUT_MS = "150";
    meta.hang = /\/comments$/;
    try {
      const primeira = await lib.simular({ automationId: automacao, post: MEDIA }, 3000);
      assert.equal(primeira.estado, "lendo");
      assert.match(String(primeira.erro), /Meta demorou/, "o erro não é engolido");
      assert.equal(primeira.leitura?.limite, 50);
      assert.ok(primeira.leitura?.erro);
      const [{ valor }] = await db.sql<{ valor: { posse: string | null; limite: number } }>("select valor from public.app_status where chave like 'responder\\_antigos:%'");
      assert.equal(valor.posse, null, "a posse foi solta");
      assert.equal(valor.limite, 25, "a próxima página pede a metade");

      let ultima = primeira;
      for (let i = 0; i < 5; i += 1) ultima = await lib.simular({ automationId: automacao, post: MEDIA }, 3000);
      assert.equal(ultima.estado, "erro");
      assert.match(String(ultima.erro), /6 tentativas/);
    } finally {
      meta.hang = null;
      delete process.env.META_TIMEOUT_MS;
    }
    // Com a Meta de volta, recomeçar (novo=1) conta tudo.
    const deNovo = await contar(MEDIA, true);
    assert.equal(deNovo.estado, "pronto");
    assert.equal(deNovo.numeros.paraEnviar, 4);
  });

  test("a Meta devolvendo páginas vazias com replies{…}: a sonda descobre e a leitura segue sem as respostas", async () => {
    meta.commentsEmptyWithReplies = true;
    const data = await contar(MEDIA);
    assert.equal(data.estado, "pronto");
    assert.equal(data.semRespostas, true);
    assert.ok(data.sonda && data.sonda.semRespostas > 0 && data.sonda.completo === 0, JSON.stringify(data.sonda));
    assert.ok(data.numeros.lidos > 0, "os comentários aparecem pedindo sem as respostas");
    assert.equal(data.paginasVazias, 1);
    assert.match(data.mensagem, /páginas sem nenhum comentário/);
  });

  test("novo=1 recomeça uma contagem «lendo» presa que não leu nada (e não mexe na que já avançou)", async () => {
    const chave = `responder_antigos:${automacao}:${MEDIA}`;
    await db.sql("insert into public.app_status (chave, valor) values ($1, $2)", [
      chave,
      JSON.stringify({ versao: 1, accountId: conta, automationId: automacao, mediaId: MEDIA, permalink: null, estado: "lendo", cursor: "x", respostasPendentes: [], respostasCursor: null, lidos: 0, combinam: 0, jaRespondidos: 0, repetidos: 0, velhos: 0, semTempo: 0, paraEnviar: 0, enfileirados: 0, puladosNoEnvio: 0, partes: 0, envioParte: 0, envioPos: 0, pessoas: [], proximoHorario: null, iniciadoEm: "2026-01-01T00:00:00.000Z", confirmadoEm: null, concluidoEm: null, esperarAte: null, erro: null, posse: new Date(Date.now() + 30_000).toISOString() }),
    ]);
    const presa = await lib.simular({ automationId: automacao, post: MEDIA }, 3000);
    assert.equal(presa.iniciadoEm, "2026-01-01T00:00:00.000Z", "sem novo=1 continua a mesma");
    const nova = await contar(MEDIA, true);
    assert.notEqual(nova.iniciadoEm, "2026-01-01T00:00:00.000Z");
    assert.equal(nova.estado, "pronto");
    assert.equal(nova.numeros.lidos, 70);
  });

  test("erros claros: automação desligada, post de outra automação, link desconhecido, sem token do Molde", async () => {
    const semToken = await rota.GET(request(`/api/molde/responder-antigos?automationId=${automacao}&post=${MEDIA}`));
    assert.equal(semToken.status, 401);
    const outro = await rota.GET(request(`/api/molde/responder-antigos?automationId=${automacao}&post=17900000000000999`, { headers: MOLDE }));
    assert.equal(outro.status, 400);
    assert.match(String(((await outro.json()) as { error: string }).error), /não está ligada a este post/);
    const link = await rota.GET(request(`/api/molde/responder-antigos?automationId=${automacao}&post=${encodeURIComponent("https://www.instagram.com/reel/NAOEXISTE/")}`, { headers: MOLDE }));
    assert.equal(link.status, 404);
    await db.sql("update public.automations set active = false");
    const desligada = await rota.GET(request(`/api/molde/responder-antigos?automationId=${automacao}&post=${MEDIA}`, { headers: MOLDE }));
    assert.equal(desligada.status, 400);
    assert.match(String(((await desligada.json()) as { error: string }).error), /desligada/);
  });
});
