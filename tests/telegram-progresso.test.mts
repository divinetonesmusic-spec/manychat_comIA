import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import type { FilaRow } from "@/lib/molde/fila";

/**
 * v137 · G7: o Telegram mostra o progresso de cada vídeo numa mensagem só, editada a cada etapa (migração 0020).
 * Unidade (o grupo e o texto) e, com o banco de teste, o espelho da página → uma mensagem por vídeo, editada (no máximo 1×/s).
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const SEGREDO = "segredo-falso-do-webhook-do-telegram-0123";
const CHAT = "42";

function linha(extra: Partial<FilaRow>): FilaRow {
  const agora = new Date();
  return {
    id: "x", ref: "pedido:x", origem: "pagina", pedido_id: null, chave: null, projeto: "birdie", avatar: "Birdie", tipo: "reel_final",
    titulo: "", estado: "produzindo", etapa: null, nota: null, custo_estimado_usd: 0, previa: null, pedido: {}, rodada: 0, decisao: null,
    decisoes: [], decisao_aplicada_em: null, espera_motivo_em: null, confirmado_em: null, confirmado_via: null, telegram_msg_id: null,
    telegram_aviso_em: null, expira_em: null, criado_em: agora, atualizado_em: agora, ...extra,
  };
}

describe("v137 · G7 progresso do vídeo no Telegram (banco)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let filaRoute: typeof import("@/app/api/molde/fila/route");
  let webhookRoute: typeof import("@/app/api/telegram/webhook/route");
  let relogio: typeof import("@/lib/molde/relogio");
  let progresso: typeof import("@/lib/telegram/progresso");

  before(async () => {
    db = await createTestDatabase();
    filaRoute = await import("@/app/api/molde/fila/route");
    webhookRoute = await import("@/app/api/telegram/webhook/route");
    relogio = await import("@/lib/molde/relogio");
    progresso = await import("@/lib/telegram/progresso");
  });

  beforeEach(async () => {
    meta.reset();
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    process.env.TELEGRAM_CHAT_ID = CHAT;
    process.env.TELEGRAM_WEBHOOK_SECRET = SEGREDO;
    delete process.env.TELEGRAM_PROGRESSO;
    await db.sql("delete from public.molde_fila");
    await db.sql("delete from public.molde_fila_grupos");
  });

  after(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    meta.restore();
    await db?.close();
  });

  const mandar = async (itens: Array<Record<string, unknown>>) => {
    const r = await filaRoute.POST(request("/api/molde/fila", { method: "POST", json: { itens }, headers: MOLDE }));
    assert.equal(r.status, 200);
    return r.json() as Promise<{ data: Array<{ id: string }>; telegram: number; progresso: number }>;
  };
  const item = (ref: string, extra: Record<string, unknown>) => ({ ref, pedidoId: ref.slice(7), projeto: "birdie", avatar: "Birdie", custoEstimadoUsd: 0, ...extra });
  const edicoes = () => meta.telegramApi.filter((c) => c.method === "editMessageText");
  const progressoMsgs = () => meta.telegram.filter((m) => /^Reel «/.test(String(m.body.text)));
  /** Deixa a última edição «antiga» (o teste não espera o 1 s do Telegram). */
  const passarUmSegundo = () => db.sql("update public.molde_fila_grupos set editado_em = now() - interval '5 seconds'");

  test("as etapas do mesmo Reel viram UMA mensagem, editada a cada mudança (e não editada se nada mudou)", async () => {
    const c1 = await mandar([
      item("pedido:pv1", { tipo: "flow_video", titulo: "Vídeo do gerador · Oração da manhã", estado: "pronto" }),
      item("pedido:pv2", { tipo: "reel_final", titulo: "Vídeo final do Reel (edição) · Oração da manhã", estado: "produzindo", etapa: "Juntando as cenas" }),
    ]);
    assert.equal(c1.progresso, 1);
    assert.equal(meta.telegram.length, 1, "uma mensagem só para o vídeo");
    const primeira = String(meta.telegram[0].body.text);
    assert.match(primeira, /^Reel «Oração da manhã» · Birdie\n1 de 2 · Cenas do vídeo ✓ · Juntando as cenas…/);
    assert.match(primeira, /Atualizado às \d\d:\d\d\.$/);
    const [g] = await db.sql<{ grupo: string; telegram_msg_id: string }>("select grupo, telegram_msg_id from public.molde_fila_grupos");
    assert.equal(g.grupo, "t:birdie:oracao da manha");
    assert.equal(Number(g.telegram_msg_id), 1);

    await passarUmSegundo();
    await mandar([item("pedido:pv2", { tipo: "reel_final", titulo: "Vídeo final do Reel (edição) · Oração da manhã", estado: "produzindo", etapa: "Pondo a legenda" })]);
    assert.equal(meta.telegram.length, 1, "não manda outra mensagem");
    assert.equal(edicoes().length, 1);
    assert.equal(edicoes()[0].body.message_id, 1);
    assert.match(String(edicoes()[0].body.text), /1 de 2 · Cenas do vídeo ✓ · Pondo a legenda…/);

    // o mesmo espelho de novo: nada muda, nada é editado
    await passarUmSegundo();
    await mandar([item("pedido:pv2", { tipo: "reel_final", titulo: "Vídeo final do Reel (edição) · Oração da manhã", estado: "produzindo", etapa: "Pondo a legenda" })]);
    assert.equal(edicoes().length, 1);
  });

  test("mudanças rápidas respeitam 1 edição por segundo (a 2ª espera e junta)", async () => {
    await mandar([item("pedido:pr1", { tipo: "reel_final", titulo: "Vídeo final · Rápido", estado: "produzindo", etapa: "Etapa 1" })]);
    const inicio = Date.now();
    await mandar([item("pedido:pr1", { tipo: "reel_final", titulo: "Vídeo final · Rápido", estado: "produzindo", etapa: "Etapa 2" })]);
    assert.ok(Date.now() - inicio >= 900, "esperou o segundo do Telegram");
    assert.equal(edicoes().length, 1);
    assert.match(String(edicoes()[0].body.text), /Etapa 2…/);
    // sem esperar: fica pendente, e o relógio mostra depois
    await db.sql("update public.molde_fila set etapa = 'Etapa 3' where ref = 'pedido:pr1'");
    await db.sql("update public.molde_fila_grupos set pendente = true, editado_em = now()");
    const [{ grupo }] = await db.sql<{ grupo: string }>("select grupo from public.molde_fila_grupos");
    assert.equal(await progresso.mostrarGrupo(grupo, { esperar: false }), false);
    assert.equal(edicoes().length, 1);
    await passarUmSegundo();
    await relogio.runMoldeClock({ deadline: Date.now() + 8000, origin: "https://uaiflow.teste" });
    assert.equal(edicoes().length, 2);
    assert.match(String(edicoes()[1].body.text), /Etapa 3…/);
    assert.equal((await db.sql<{ pendente: boolean }>("select pendente from public.molde_fila_grupos"))[0].pendente, false);
  });

  test("o grupo explícito da página junta etapas de títulos diferentes e mostra «x de N» com os passos", async () => {
    await mandar([
      item("pedido:pg1", { tipo: "voz", titulo: "Voz (120 créditos)", estado: "pronto", grupo: "cal-77", passos: 6 }),
      item("heygen:vid1", { tipo: "heygen", titulo: "Vídeo do avatar falando", estado: "produzindo", etapa: "O HeyGen está fazendo o vídeo", grupo: "cal-77" }),
    ]);
    assert.equal(meta.telegram.length, 1);
    assert.match(String(meta.telegram[0].body.text), /1 de 6 · Voz ✓ · O HeyGen está fazendo o vídeo…/);
    // depois, sem o grupo no espelho, o item continua no grupo dele
    await passarUmSegundo();
    await mandar([item("heygen:vid1", { tipo: "heygen", titulo: "Vídeo do avatar falando", estado: "pronto" })]);
    assert.equal(meta.telegram.length, 1);
    assert.match(String(edicoes().at(-1)?.body.text), /2 de 6 · Vídeo do avatar ✓/);
  });

  test("aprovação: a mensagem de aprovar sai como antes; o progresso diz «esperando você aprovar» e mostra o «Aprovar» do Telegram", async () => {
    const r = await mandar([item("pedido:pa1", { tipo: "reel_final", titulo: "Vídeo final · Aprova", estado: "para_aprovar", previa: { video: "https://midia.teste.invalid/v.mp4" } })]);
    assert.equal(r.telegram, 1);
    assert.equal(meta.telegram.length, 2, "a aprovação (com botões) e o progresso");
    const aprovacao = meta.telegram.find((m) => (m.body.reply_markup as { inline_keyboard?: unknown[] } | undefined)?.inline_keyboard);
    assert.ok(aprovacao, "a mensagem de aprovação tem os botões");
    assert.match(String(progressoMsgs()[0].body.text), /0 de 1 · Vídeo final: esperando você aprovar/);
    const botoes = (aprovacao!.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard.flat();
    await passarUmSegundo();
    const toque = { update_id: 900, callback_query: { id: "cb-900", from: { id: 7, username: "nicolas" }, data: botoes[0].callback_data, message: { message_id: 1, chat: { id: Number(CHAT) }, text: "x" } } };
    assert.equal((await webhookRoute.POST(request("/api/telegram/webhook", { method: "POST", json: toque, headers: { "x-telegram-bot-api-secret-token": SEGREDO } }))).status, 200);
    const prog = edicoes().find((e) => /^Reel «Aprova»/.test(String(e.body.text)));
    assert.ok(prog, "a mensagem de progresso foi editada");
    assert.match(String(prog!.body.text), /1 de 1 · Vídeo final ✓ · Pronto ✓/);
  });

  test("o Telegram recusou (muitas mensagens): fica pendente e o relógio mostra depois", async () => {
    meta.telegramFails = { status: 429, description: "Too Many Requests: retry after 1" };
    await mandar([item("pedido:pt1", { tipo: "reel_final", titulo: "Vídeo final · Recusa", estado: "produzindo" })]);
    assert.equal((await db.sql<{ pendente: boolean }>("select pendente from public.molde_fila_grupos"))[0].pendente, true);
    meta.telegramFails = null;
    await passarUmSegundo();
    await relogio.runMoldeClock({ deadline: Date.now() + 8000, origin: "https://uaiflow.teste" });
    assert.equal(progressoMsgs().length, 1);
    assert.equal((await db.sql<{ pendente: boolean }>("select pendente from public.molde_fila_grupos"))[0].pendente, false);
  });

  test("fotos não ganham mensagem de progresso; TELEGRAM_PROGRESSO=0 desliga tudo", async () => {
    await mandar([item("pedido:pf1", { tipo: "fotos", titulo: "Fotos do avatar · Café", estado: "produzindo" })]);
    assert.equal(meta.telegram.length, 0);
    process.env.TELEGRAM_PROGRESSO = "0";
    const r = await mandar([item("pedido:pd1", { tipo: "reel_final", titulo: "Vídeo final · Desligado", estado: "produzindo" })]);
    assert.equal(r.progresso, 0);
    assert.equal(meta.telegram.length, 0);
    assert.equal((await db.sql("select 1 from public.molde_fila_grupos")).length, 0);
  });

  test("espelho com passos fora de 1 a 30: 400 com a frase", async () => {
    const r = await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { itens: [item("pedido:px", { tipo: "reel_final", estado: "produzindo", passos: 0 })] } }));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /passos/);
  });
});

// Os testes de unidade vêm depois dos de banco: o módulo abre a conexão ao carregar, e o banco de teste precisa vir antes.
let grupoDoItem: typeof import("@/lib/telegram/progresso").grupoDoItem;
let temaDoTitulo: typeof import("@/lib/telegram/progresso").temaDoTitulo;
let textoDoProgresso: typeof import("@/lib/telegram/progresso").textoDoProgresso;

describe("v137 · G7 progresso do vídeo (unidade)", () => {
  before(async () => {
    ({ grupoDoItem, temaDoTitulo, textoDoProgresso } = await import("@/lib/telegram/progresso"));
  });
  test("o tema sai do título da página («Nome · tema») e do Telegram («Reel: tema»)", () => {
    assert.deepEqual(temaDoTitulo("Vídeo final do Reel (edição) · Oração da manhã"), { nome: "Vídeo final do Reel (edição)", tema: "Oração da manhã" });
    assert.deepEqual(temaDoTitulo("Reel: Oração da manhã"), { nome: "Reel", tema: "Oração da manhã" });
    assert.deepEqual(temaDoTitulo("Vídeo do avatar falando"), { nome: "Vídeo do avatar falando", tema: null });
  });

  test("o grupo: explícito, pelo tema (sem acento e maiúsculas), sozinho, ou nenhum", () => {
    const base = { projeto: "birdie", ref: "pedido:a", estado: "produzindo" as const };
    assert.equal(grupoDoItem({ ...base, tipo: "fotos", titulo: "Fotos" }, "cal-9"), "g:birdie:cal-9");
    assert.equal(grupoDoItem({ ...base, tipo: "reel_final", titulo: "Vídeo final · Oração da Manhã" }), "t:birdie:oracao da manha");
    assert.equal(grupoDoItem({ ...base, tipo: "reel", titulo: "Reel: oração da manhã" }), "t:birdie:oracao da manha");
    assert.equal(grupoDoItem({ ...base, tipo: "heygen", titulo: "Vídeo do avatar falando" }), "r:pedido:a");
    assert.equal(grupoDoItem({ ...base, tipo: "fotos", titulo: "Fotos · Oração" }), null, "fotos não é vídeo");
    assert.equal(grupoDoItem({ ...base, tipo: "reel_final", titulo: "x · y", estacao: "molde-roteirista" }), null, "orquestrador não");
    assert.equal(grupoDoItem({ ...base, tipo: "reel", titulo: "Reel: y", estado: "rascunho" }), null, "rascunho não");
  });

  test("o texto: «Reel «tema» · avatar», «3 de 6 · Voz ✓ · Fazendo o vídeo…» e uma linha por etapa", () => {
    const t0 = Date.now();
    const itens = [
      linha({ tipo: "reel", titulo: "Reel: Oração da manhã", estado: "pronto", atualizado_em: new Date(t0 - 3000) }),
      linha({ tipo: "flow_video", titulo: "Vídeo do gerador · Oração da manhã", estado: "aprovado", atualizado_em: new Date(t0 - 2000) }),
      linha({ tipo: "voz", titulo: "Voz · Oração da manhã", estado: "pronto", atualizado_em: new Date(t0 - 1000) }),
      linha({ tipo: "reel_final", titulo: "Vídeo final · Oração da manhã", estado: "produzindo", etapa: "Fazendo o vídeo" }),
    ];
    const texto = textoDoProgresso(itens, 6);
    const [cabeca, resumo, , ...etapas] = texto.split("\n");
    assert.equal(cabeca, "Reel «Oração da manhã» · Birdie");
    assert.equal(resumo, "3 de 6 · Voz ✓ · Fazendo o vídeo…");
    assert.deepEqual(etapas, ["✓ Roteiro", "✓ Cenas do vídeo", "✓ Voz", "… Vídeo final: Fazendo o vídeo"]);
    // a aprovação vem primeiro; o fim mostra «Pronto ✓»
    itens[3] = linha({ tipo: "reel_final", titulo: "Vídeo final · Oração da manhã", estado: "para_aprovar" });
    assert.match(textoDoProgresso(itens, 6), /3 de 6 · Voz ✓ · Vídeo final: esperando você aprovar\n/);
    itens[3] = linha({ tipo: "reel_final", titulo: "Vídeo final · Oração da manhã", estado: "aprovado" });
    assert.match(textoDoProgresso(itens), /^Reel «Oração da manhã» · Birdie\n4 de 4 · Vídeo final ✓ · Pronto ✓/);
  });
});
