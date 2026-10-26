import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/**
 * v135 · o orquestrador na fila única (0019): criar com a chave idempotente, pegar com prazo que vence sozinho, passo,
 * aprovação (o Telegram com os achados do revisor e Corrigir / Refazer / Publicar mesmo assim), a decisão do dono,
 * resultado, erro (tentar de novo até 2 vezes), soltar, a versão (409) e a convivência com a página e o Telegram da v134.
 */
const meta = installFakeMeta();

const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const ORQ_TOKEN = "token-falso-do-orquestrador-0123456789";
const ORQ = { authorization: `Bearer ${ORQ_TOKEN}` };
const SEGREDO = "segredo-falso-do-webhook-do-telegram-0123";
const CHAT = "42";
const TG = { "x-telegram-bot-api-secret-token": SEGREDO };

type Item = {
  id: string; chave: string; versao: number; projeto: string; avatar: string; estacao: string | null; tipo: string; estado: string; estadoPagina: string;
  origem: string; passos: Array<{ estacao: string; saida: Record<string, unknown> }>; aprovacao: null | { motivo: string; opcoes: string[]; achados: unknown[]; decisao: string | null; nota: string; custo: number | null };
  resultado: null | { saida: Record<string, unknown>; pecasParaGravar: Record<string, unknown> }; tentativas: number; pegoPor: string | null; pegoAte: string | null; prazoVencido: boolean;
  erro: string | null; rodada: number; custoEstimadoUsd: number; detalhes: Record<string, unknown>; entrada: Record<string, unknown> | null;
};
type Botao = { text: string; callback_data: string };

describe("v135 · o orquestrador na fila única (0019)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let filaRoute: typeof import("@/app/api/molde/fila/route");
  let itemRoute: typeof import("@/app/api/molde/fila/[id]/route");
  let acaoRoute: typeof import("@/app/api/molde/fila/[id]/[acao]/route");
  let webhookRoute: typeof import("@/app/api/telegram/webhook/route");
  let relogio: typeof import("@/lib/molde/relogio");
  let callbackData: typeof import("@/lib/telegram/callback-data");
  let seq = 0;

  before(async () => {
    db = await createTestDatabase();
    filaRoute = await import("@/app/api/molde/fila/route");
    itemRoute = await import("@/app/api/molde/fila/[id]/route");
    acaoRoute = await import("@/app/api/molde/fila/[id]/[acao]/route");
    webhookRoute = await import("@/app/api/telegram/webhook/route");
    relogio = await import("@/lib/molde/relogio");
    callbackData = await import("@/lib/telegram/callback-data");
  });

  beforeEach(async () => {
    meta.reset();
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    process.env.TELEGRAM_CHAT_ID = CHAT;
    process.env.TELEGRAM_WEBHOOK_SECRET = SEGREDO;
    process.env.MOLDE_ORQUESTRADOR_TOKEN = ORQ_TOKEN;
    process.env.MOLDE_TETO_USD = "20";
    await db.sql("delete from public.molde_fila");
    await db.sql("delete from public.molde_avatares");
    await db.sql("insert into public.molde_avatares (projeto, nome, conta) values ('birdie', 'Birdie', 'birdie.lanier')");
  });

  after(async () => {
    for (const k of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_WEBHOOK_SECRET", "MOLDE_ORQUESTRADOR_TOKEN", "MOLDE_TETO_USD"]) delete process.env[k];
    meta.restore();
    await db?.close();
  });

  // ---------- ajudantes ----------
  const criar = (json: Record<string, unknown>, headers: Record<string, string> = ORQ) => filaRoute.POST(request("/api/molde/fila", { method: "POST", json, headers }));
  const listar = (consulta = "", headers: Record<string, string> = ORQ) => filaRoute.GET(request(`/api/molde/fila${consulta}`, { headers }));
  const ler = async (id: string, headers: Record<string, string> = ORQ) => (await (await itemRoute.GET(request(`/api/molde/fila/${id}`, { headers }), routeParams({ id }))).json()).item as Item;
  const acao = (id: string, nome: string, json: Record<string, unknown> = {}, headers: Record<string, string> = ORQ) =>
    acaoRoute.POST(request(`/api/molde/fila/${id}/${nome}`, { method: "POST", json, headers }), routeParams({ id, acao: nome }));
  const linha = async (id: string) => (await db.sql<Record<string, unknown>>("select * from public.molde_fila where id = $1", [id]))[0];
  const pedido = (extra: Record<string, unknown> = {}) => ({
    projeto: "birdie", estacao: "molde-roteirista", tipo: "legenda", titulo: "Legenda do Reel da oração", detalhes: { tema: "oração pela filha" },
    entrada: { pecas: { ficha: { nome: "Birdie" } }, pecasMarcas: { ficha: "h123" }, projeto: { mercado: "EUA", idioma: "en-US", moeda: "US$", garantiaDias: 7 } },
    chave: "k0123456789abcdef", ...extra,
  });
  async function novo(extra: Record<string, unknown> = {}) {
    const r = await criar(pedido(extra));
    assert.equal(r.status, 201);
    return (await r.json()).item as Item;
  }
  async function pegar(item: Item, quem = "orquestrador", extra: Record<string, unknown> = {}) {
    const r = await acao(item.id, "pegar", { versao: item.versao, quem, ...extra });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    return (await r.json()).item as Item;
  }
  async function ate(item: Item, nome: string, json: Record<string, unknown>) {
    const r = await acao(item.id, nome, { versao: item.versao, ...json });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    return (await r.json()).item as Item;
  }
  const ultima = () => meta.telegram.at(-1)?.body as { text?: string; reply_markup?: { inline_keyboard: Botao[][] } } | undefined;
  const botoes = (corpo = ultima()) => (corpo?.reply_markup?.inline_keyboard ?? []).flat();
  const chamadas = (metodo: string) => meta.telegramApi.filter((c) => c.method === metodo);
  function tocar(data: string) {
    seq += 1;
    const update = { update_id: seq, callback_query: { id: `cb-${seq}`, from: { id: 7, username: "nicolas" }, data, message: { message_id: 1, chat: { id: Number(CHAT) }, text: "Molde: mensagem" } } };
    return webhookRoute.POST(request("/api/telegram/webhook", { method: "POST", json: update, headers: TG }));
  }
  function escrever(texto: string) {
    seq += 1;
    const update = { update_id: seq, message: { message_id: 500 + seq, chat: { id: Number(CHAT) }, from: { id: 7, username: "nicolas" }, text: texto } };
    return webhookRoute.POST(request("/api/telegram/webhook", { method: "POST", json: update, headers: TG }));
  }
  const achados = [
    { lugar: "legenda, linha 2", trecho: "cura a ansiedade", porque: "promessa de saúde (política da Meta)", troca: "ajuda a acalmar a noite" },
    { lugar: "CTA", trecho: "garantido", porque: "promessa de resultado", troca: "experimente" },
  ];

  // ---------- criar ----------

  describe("criar e ler", () => {
    test("cria «novo» (201) com tudo; a mesma chave viva devolve o mesmo item (200, reaproveitado); o avatar vem da lista", async () => {
      const a = await novo();
      assert.equal(a.estado, "novo");
      assert.equal(a.estadoPagina, "na_fila");
      assert.equal(a.versao, 1);
      assert.equal(a.avatar, "Birdie");
      assert.equal(a.estacao, "molde-roteirista");
      assert.deepEqual(a.detalhes, { tema: "oração pela filha" });
      assert.equal((a.entrada as { projeto: { mercado: string } }).projeto.mercado, "EUA");
      const r = await criar(pedido({ detalhes: { outra: "coisa" } }));
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.equal(b.reaproveitado, true);
      assert.equal(b.item.id, a.id);
      assert.equal((await db.sql("select count(*)::int as n from public.molde_fila"))[0].n, 1);
      // ao mesmo tempo: um só
      const juntos = await Promise.all([criar(pedido({ chave: "kparalelo0000001" })), criar(pedido({ chave: "kparalelo0000001" }))]);
      const corpos = await Promise.all(juntos.map((x) => x.json()));
      assert.equal(corpos[0].item.id, corpos[1].item.id);
      assert.deepEqual(juntos.map((x) => x.status).sort(), [200, 201]);
    });

    test("chave de item pronto, cancelado ou de mais de 2 h cria outro; sem chave, a chave sai dos detalhes (a mesma em qualquer ordem)", async () => {
      const a = await novo();
      await db.sql("update public.molde_fila set estado = 'pronto' where id = $1", [a.id]);
      const b = await novo();
      assert.notEqual(b.id, a.id);
      await db.sql("update public.molde_fila set criado_em = now() - interval '3 hours' where id = $1", [b.id]);
      const c = await novo();
      assert.notEqual(c.id, b.id);
      const s1 = await (await criar(pedido({ chave: undefined, detalhes: { a: 1, b: 2 } }))).json();
      const s2 = await (await criar(pedido({ chave: undefined, detalhes: { b: 2, a: 1 } }))).json();
      assert.match(s1.item.chave, /^k[0-9a-f]{16}$/);
      assert.equal(s2.item.id, s1.item.id);
      assert.equal(s2.reaproveitado, true);
    });

    test("validação e token: 400 com {erro:{codigo,mensagem}}; 401 sem token; o x-molde-token também entra", async () => {
      const r = await criar(pedido({ estacao: "qualquer" }));
      assert.equal(r.status, 400);
      const corpo = await r.json();
      assert.equal(corpo.erro.codigo, "pedido_invalido");
      assert.match(corpo.erro.mensagem, /estacao/);
      assert.equal(corpo.error, corpo.erro.mensagem);
      assert.equal((await criar(pedido({ tipo: "Legenda!" }))).status, 400);
      assert.equal((await criar(pedido({ entrada: "texto" }))).status, 400);
      assert.equal((await criar(pedido(), {})).status, 401);
      assert.equal((await criar(pedido(), { authorization: "Bearer errado-errado-errado-errado" })).status, 401);
      assert.equal((await criar(pedido(), MOLDE)).status, 201);
      assert.equal((await acao("2b6c0d6e-8a51-4c41-9a39-7c1d1c1b0f10", "pegar", { versao: 1 })).status, 404);
      assert.equal((await itemRoute.GET(request("/api/molde/fila/nao-e-uuid", { headers: ORQ }), routeParams({ id: "nao-e-uuid" }))).status, 404);
    });

    test("listar: o token do orquestrador (ou ?formato=orquestrador, ou um estado novo) dá {itens}, os mais velhos primeiro, só os do orquestrador", async () => {
      const a = await novo({ chave: "kaaaaaaaaaaaaaaaa" });
      const b = await novo({ chave: "kbbbbbbbbbbbbbbbb", estacao: "molde-fotografo", tipo: "fotos" });
      await db.sql("update public.molde_fila set criado_em = now() - interval '1 minute' where id = $1", [a.id]);
      // um espelho da página (sem estação) não aparece para o orquestrador
      await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { itens: [{ ref: "pedido:p1", tipo: "fotos", estado: "na_fila", projeto: "birdie" }] } }));
      const l = await (await listar("?estado=novo,aprovado,refazer&limite=5")).json();
      assert.deepEqual(l.itens.map((x: Item) => x.id), [a.id, b.id]);
      assert.equal(l.data, undefined);
      const porMolde = await (await listar("?estado=novo", MOLDE)).json();
      assert.equal(porMolde.itens.length, 2);
      assert.equal((await (await listar("?formato=orquestrador&estacao=molde-fotografo", MOLDE)).json()).itens[0].id, b.id);
      assert.equal((await (await listar("?formato=orquestrador&todos=1", MOLDE)).json()).itens.length, 3);
      // a página continua com o formato dela (data, estados de sempre)
      const pagina = await (await listar("?estado=na_fila", MOLDE)).json();
      assert.equal(pagina.data.length, 3);
      assert.ok(pagina.data.every((x: { estado: string; estadoOrquestrador: string }) => x.estado === "na_fila" && x.estadoOrquestrador === "novo"));
      assert.equal((await listar("?estado=voando")).status, 400);
      assert.equal((await ler(a.id)).id, a.id);
    });
  });

  // ---------- o ciclo ----------

  describe("o ciclo do orquestrador", () => {
    test("pegar → passo → revisor reprova → aprovacao: Telegram com os achados e Corrigir / Refazer / Publicar mesmo assim / Cancelar", async () => {
      let a = await novo();
      a = await pegar(a, "orquestrador", { prazoSeg: 600 });
      assert.equal(a.estado, "na-estacao");
      assert.equal(a.pegoPor, "orquestrador");
      assert.ok(new Date(a.pegoAte!).getTime() - Date.now() > 590_000);
      assert.equal(a.versao, 2);
      a = await ate(a, "passo", { estacao: "molde-roteirista", saida: { estacao: "molde-roteirista", pedido: a.id, status: "ok", legenda: "Ore pela sua filha" } });
      assert.equal(a.estado, "na-estacao");
      a = await ate(a, "passo", { estacao: "molde-revisor", saida: { estacao: "molde-revisor", status: "reprovado" } });
      assert.equal(a.estado, "na-revisao");
      assert.equal(a.estadoPagina, "produzindo", "a página vê «produzindo»");
      assert.deepEqual(a.passos.map((p) => p.estacao), ["molde-roteirista", "molde-revisor"]);
      // o orquestrador manda só Corrigir e Refazer: «Publicar mesmo assim» entra sempre (decisão 21), e «Cancelar»
      a = await ate(a, "aprovacao", { motivo: "revisor", pergunta: "O revisor reprovou a legenda.", opcoes: ["Corrigir", "Refazer"], achados, resumo: "2 promessas proibidas" });
      assert.equal(a.estado, "esperando-dono");
      assert.equal(a.estadoPagina, "para_aprovar");
      assert.equal(a.rodada, 1);
      assert.equal(a.pegoPor, null, "a posse acaba no pedido de aprovação");
      assert.deepEqual(a.aprovacao?.opcoes, ["corrigir", "refazer", "publicar", "cancelar"]);
      assert.equal(a.aprovacao?.achados.length, 2);
      const msg = ultima();
      assert.match(String(msg?.text), /«Legenda do Reel da oração» de Birdie: o revisor reprovou/);
      assert.match(String(msg?.text), /O revisor achou 2 problemas:/);
      assert.match(String(msg?.text), /1\. legenda, linha 2: «cura a ansiedade» — promessa de saúde/);
      assert.match(String(msg?.text), /Troca: «ajuda a acalmar a noite»/);
      assert.deepEqual(botoes().map((b) => b.text), ["Corrigir", "Refazer", "Publicar mesmo assim", "Cancelar"]);
      assert.deepEqual(callbackData.verifyCallback(botoes()[2].callback_data), { kind: "f", action: "p", id: a.id, version: 1 });
      assert.ok(botoes().every((b) => Buffer.byteLength(b.callback_data) <= 64));
      assert.ok((await linha(a.id)).telegram_msg_id, "o número da mensagem fica guardado");
      // a mensagem não muda a versão: quem leu antes ainda decide com a mesma
      assert.equal((await ler(a.id)).versao, a.versao);
      // a página do Molde (formato dela) vê para_aprovar, mas não como decisão para ela aplicar
      const pend = await (await listar("?decisoes=pendentes", MOLDE)).json();
      assert.equal(pend.data.length, 0);
    });

    test("«Publicar mesmo assim» no Telegram: aprovado com a decisão; o orquestrador pega de novo, vê a decisão e grava o resultado", async () => {
      let a = await pegar(await novo());
      a = await ate(a, "aprovacao", { motivo: "revisor", achados });
      const publicar = botoes().find((b) => b.text === "Publicar mesmo assim")!;
      const r = await tocar(publicar.callback_data);
      assert.equal((await r.json()).acao, "publicar");
      assert.match(String(chamadas("editMessageText").at(-1)?.body.text), /Publicar mesmo assim \(escolha do dono\) às \d{2}:\d{2} \(pelo Telegram\)/);
      assert.equal((await (await tocar(publicar.callback_data)).json()).acao, "repetido", "dois toques = uma decisão");
      let b = await ler(a.id);
      assert.equal(b.estado, "aprovado");
      assert.equal(b.aprovacao?.decisao, "publicar");
      const l = await (await listar("?estado=novo,aprovado,refazer")).json();
      assert.deepEqual(l.itens.map((x: Item) => x.id), [a.id]);
      b = await pegar(b);
      assert.equal(b.estado, "na-estacao");
      assert.equal(b.aprovacao?.decisao, "publicar", "a decisão continua no item para o orquestrador aplicar");
      assert.ok((await linha(a.id)).decisao_aplicada_em, "pegar o item decidido conta como aplicada");
      b = await ate(b, "resultado", { saida: { legenda: "Ore pela sua filha" }, pecasParaGravar: { oferta: { palavra: "REZAR" } } });
      assert.equal(b.estado, "pronto");
      assert.deepEqual(b.resultado, { saida: { legenda: "Ore pela sua filha" }, pecasParaGravar: { oferta: { palavra: "REZAR" } } });
      assert.equal(b.pegoPor, null);
    });

    test("«Refazer» no Telegram pergunta o motivo; a mensagem seguinte decide; «Corrigir» e «Cancelar» pela rota decisao (com a versão)", async () => {
      let a = await pegar(await novo());
      a = await ate(a, "aprovacao", { motivo: "revisor", achados });
      const refazer = botoes().find((b) => b.text === "Refazer")!;
      assert.equal((await (await tocar(refazer.callback_data)).json()).acao, "motivo");
      assert.equal((await ler(a.id)).estado, "esperando-dono");
      assert.equal((await (await escrever("Tire a promessa e fale do ritual da noite")).json()).acao, "refazer");
      const b = await ler(a.id);
      assert.equal(b.estado, "refazer");
      assert.equal(b.aprovacao?.decisao, "refazer");
      assert.equal(b.aprovacao?.nota, "Tire a promessa e fale do ritual da noite");

      // outro item: a página decide pela rota decisao (o contrato do ORQUESTRADOR.md)
      let c = await pegar(await novo({ chave: "koutro0000000001" }));
      c = await ate(c, "aprovacao", { motivo: "revisor", achados });
      assert.equal((await acao(c.id, "decisao", { versao: c.versao - 1, decisao: "corrigir" }, MOLDE)).status, 409, "versão velha");
      const sem = await acao(c.id, "decisao", { versao: c.versao, decisao: "gravar" }, MOLDE);
      assert.equal(sem.status, 400);
      assert.equal((await sem.json()).erro.codigo, "opcao");
      assert.equal((await acao(c.id, "decisao", { versao: c.versao, decisao: "refazer" }, MOLDE)).status, 400, "refazer sem nota");
      const ok = await acao(c.id, "decisao", { versao: c.versao, decisao: "corrigir", por: "@nicolas" }, MOLDE);
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).item.estado, "aprovado");
      assert.match(String(chamadas("editMessageText").at(-1)?.body.text), /Pedido para corrigir .* \(pela página\)/);
      const dup = await acao(c.id, "decisao", { decisao: "cancelar" }, MOLDE);
      assert.equal(dup.status, 409);
      assert.equal((await dup.json()).erro.codigo, "ja_decidido");

      let d = await pegar(await novo({ chave: "kcancelar0000001" }));
      d = await ate(d, "aprovacao", { motivo: "publico", previa: { texto: "Legenda final", imagem: "https://midia.teste.invalid/capa.png" } });
      assert.deepEqual(botoes().map((x) => x.text), ["Aprovar", "Refazer", "Cancelar"]);
      assert.match(String(ultima()?.text), /vai a público/);
      assert.match(String(ultima()?.text), /Prévia: https:\/\/midia\.teste\.invalid\/capa\.png/);
      assert.equal((await (await tocar(botoes().at(-1)!.callback_data)).json()).acao, "cancelar");
      assert.equal((await ler(d.id)).estado, "cancelado");
    });

    test("gasto: o custo e o gasto do mês na mensagem; «Aprovar o gasto · US$ 0,40» confirma o custo (entra no gasto do mês)", async () => {
      let a = await pegar(await novo({ estacao: "molde-fotografo", tipo: "fotos" }));
      a = await ate(a, "aprovacao", { motivo: "gasto", custo: 0.4, pergunta: "Gerar 4 fotos do ensaio?" });
      assert.match(String(ultima()?.text), /Custo: ≈ US\$ 0,40\. Gasto do mês até agora: US\$ 0,00 de US\$ 20,00\./);
      assert.deepEqual(botoes().map((x) => x.text), ["Aprovar o gasto · US$ 0,40", "Cancelar"]);
      assert.equal(Number((await linha(a.id)).custo_estimado_usd), 0, "pedir aprovação não gasta");
      assert.equal((await (await tocar(botoes()[0].callback_data)).json()).acao, "aprovar");
      const l = await linha(a.id);
      assert.equal(Number(l.custo_estimado_usd), 0.4);
      assert.ok(l.confirmado_em);
      assert.equal(l.confirmado_via, "telegram");
    });

    test("faltam dados: só Cancelar no Telegram (completar é na página); a página decide «completar»", async () => {
      let a = await pegar(await novo());
      a = await ate(a, "aprovacao", { motivo: "faltam-dados", pergunta: "Falta o preço da oferta da Birdie. Quer completar agora?" });
      assert.deepEqual(botoes().map((x) => x.text), ["Cancelar"]);
      assert.match(String(ultima()?.text), /Abra a página do Molde para completar/);
      const r = await acao(a.id, "decisao", { versao: a.versao, decisao: "completar" }, MOLDE);
      assert.equal(r.status, 200);
      assert.equal((await r.json()).item.estado, "aprovado");
    });

    test("o relógio manda de novo a aprovação do orquestrador que não saiu na hora", async () => {
      meta.telegramFails = "rede";
      let a = await pegar(await novo());
      a = await ate(a, "aprovacao", { motivo: "revisor", achados });
      assert.equal((await linha(a.id)).telegram_msg_id, null);
      meta.telegramFails = null;
      await db.sql("update public.molde_fila set atualizado_em = now() - interval '5 minutes', telegram_aviso_em = now() - interval '11 minutes' where id = $1", [a.id]);
      await relogio.runMoldeClock({ deadline: Date.now() + 8000, origin: "https://uaiflow.teste" });
      assert.ok((await linha(a.id)).telegram_msg_id);
      // o relógio pode mandar outros avisos junto: a mensagem do item é a que tem os botões
      const doItem = meta.telegram.map((m) => m.body as { text?: string; reply_markup?: { inline_keyboard: Botao[][] } }).filter((m) => m.reply_markup).at(-1);
      assert.deepEqual(botoes(doItem).map((x) => x.text), ["Corrigir", "Refazer", "Publicar mesmo assim", "Cancelar"]);
    });
  });

  // ---------- posse, versão, erro ----------

  describe("a posse com prazo e a versão", () => {
    test("já pego por outro e no prazo: 409 pego; o mesmo quem renova; o prazo vence sozinho e o item volta ao estado de antes", async () => {
      const a0 = await novo();
      const a = await pegar(a0, "orq-1");
      const outro = await acao(a.id, "pegar", { versao: a.versao, quem: "orq-2" });
      assert.equal(outro.status, 409);
      assert.equal((await outro.json()).erro.codigo, "pego");
      const renovado = await pegar(a, "orq-1");
      assert.equal(renovado.pegoPor, "orq-1");
      // o prazo vence (o orquestrador caiu): sem relógio, o item já aparece como «novo» para o próximo ciclo
      await db.sql("update public.molde_fila set pego_ate = now() - interval '1 second' where id = $1", [a.id]);
      const vencido = await ler(a.id);
      assert.equal(vencido.estado, "novo");
      assert.equal(vencido.prazoVencido, true);
      assert.equal(vencido.pegoPor, null);
      const l = await (await listar("?estado=novo")).json();
      assert.deepEqual(l.itens.map((x: Item) => x.id), [a.id]);
      const b = await pegar(vencido, "orq-2");
      assert.equal(b.pegoPor, "orq-2");
      assert.equal(b.estado, "na-estacao");
      // o orq-1 voltou do nada: a versão dele é velha
      const velho = await acao(a.id, "passo", { versao: renovado.versao, estacao: "molde-roteirista", saida: { x: 1 }, quem: "orq-1" });
      assert.equal(velho.status, 409);
      const corpo = await velho.json();
      assert.equal(corpo.erro.codigo, "versao");
      assert.equal(corpo.item.versao, b.versao, "o 409 traz o item atual para reler");
    });

    test("um item aprovado cujo prazo venceu volta a «aprovado» (não perde a decisão)", async () => {
      let a = await pegar(await novo());
      a = await ate(a, "aprovacao", { motivo: "publico" });
      await acao(a.id, "decisao", { versao: a.versao, decisao: "aprovar" }, MOLDE);
      const b = await pegar(await ler(a.id), "orq-1");
      await db.sql("update public.molde_fila set pego_ate = now() - interval '1 second' where id = $1", [b.id]);
      const c = await ler(a.id);
      assert.equal(c.estado, "aprovado");
      assert.deepEqual((await (await listar("?estado=aprovado")).json()).itens.map((x: Item) => x.id), [a.id]);
    });

    test("versão errada em cada escrita: 409 versao; sem versão: 400; estado errado: 409 estado; espelho da página: 409 pagina", async () => {
      const a = await novo();
      for (const nome of ["passo", "aprovacao", "resultado", "soltar"]) {
        const r = await acao(a.id, nome, { versao: a.versao, estacao: "molde-roteirista", saida: { x: 1 }, motivo: "publico" });
        assert.equal(r.status, 409, nome);
        assert.equal((await r.json()).erro.codigo, "estado", `${nome} antes de pegar`);
      }
      assert.equal((await acao(a.id, "pegar", { quem: "orq" })).status, 400);
      const p = await pegar(a);
      for (const nome of ["pegar", "passo", "aprovacao", "resultado", "erro", "soltar"]) {
        const r = await acao(a.id, nome, { versao: p.versao + 5, estacao: "molde-roteirista", saida: { x: 1 }, motivo: nome === "erro" ? "x" : "publico" });
        assert.equal(r.status, 409, nome);
        assert.equal((await r.json()).erro.codigo, "versao", nome);
      }
      const espelho = await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { itens: [{ ref: "pedido:p9", tipo: "fotos", estado: "na_fila" }] } }));
      const idEspelho = (await espelho.json()).data[0].id;
      const v = (await ler(idEspelho)).versao;
      const r = await acao(idEspelho, "pegar", { versao: v });
      assert.equal(r.status, 409);
      assert.equal((await r.json()).erro.codigo, "pagina");
      // e a página não muda um item do orquestrador pelo espelho
      const tentativa = await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { itens: [{ id: a.id, ref: "pedido:px", tipo: "fotos", estado: "pronto" }] } }));
      assert.match(JSON.stringify((await tentativa.json()).data[0]), /é do orquestrador/);
    });

    test("erro com tentarDeNovo volta a «novo» 2 vezes; na 3ª fica «erro» e o Telegram avisa; sem tentarDeNovo, «erro» na hora", async () => {
      let a = await novo();
      for (let i = 1; i <= 2; i++) {
        a = await pegar(a);
        const r = await acao(a.id, "erro", { versao: a.versao, motivo: "A skill devolveu um JSON sem status", tentarDeNovo: true });
        const corpo = await r.json();
        assert.equal(corpo.item.estado, "novo");
        assert.equal(corpo.item.tentativas, i);
        assert.equal(corpo.tentaDeNovo, true);
        a = corpo.item;
      }
      const n = meta.telegram.length;
      a = await pegar(a);
      const r = await acao(a.id, "erro", { versao: a.versao, motivo: "A skill devolveu um JSON sem status", tentarDeNovo: true });
      const corpo = await r.json();
      assert.equal(corpo.item.estado, "erro");
      assert.equal(corpo.tentaDeNovo, false);
      assert.equal(meta.telegram.length, n + 1);
      assert.match(String(ultima()?.text), /parou com erro: A skill devolveu um JSON sem status/);
      assert.equal((await acao(a.id, "erro", { versao: corpo.item.versao, motivo: "de novo" })).status, 409, "erro de item em erro");
      const b = await novo({ chave: "kerro00000000001" });
      const r2 = await acao(b.id, "erro", { versao: b.versao, motivo: "Faltou o Mac" });
      assert.equal((await r2.json()).item.estado, "erro");
      assert.equal((await acao(b.id, "erro", { versao: 99 })).status, 400, "sem motivo");
    });

    test("soltar devolve sem contar tentativa (ex.: «Esperando o Mac ligar»)", async () => {
      const a = await pegar(await novo());
      const s = await ate(a, "soltar", { nota: "Esperando o Mac ligar" });
      assert.equal(s.estado, "novo");
      assert.equal(s.tentativas, 0);
      assert.equal((await linha(a.id)).etapa, "Esperando o Mac ligar");
    });

    test("o diário guarda os 40 passos mais novos e cada passo renova o prazo", async () => {
      let a = await pegar(await novo(), "orquestrador", { prazoSeg: 60 });
      await db.sql("update public.molde_fila set pego_ate = now() + interval '5 seconds' where id = $1", [a.id]);
      a = await ler(a.id);
      for (let i = 0; i < 42; i++) a = await ate(a, "passo", { estacao: "molde-roteirista", saida: { i } });
      assert.equal(a.passos.length, 40);
      assert.deepEqual(a.passos[0].saida, { i: 2 });
      assert.ok(new Date(a.pegoAte!).getTime() - Date.now() > 50_000);
    });
  });

  describe("a migração 0019", () => {
    test("pode ser colada de novo: nada muda nos itens; a versão só sobe com mudança de verdade", async () => {
      let a = await pegar(await novo());
      a = await ate(a, "passo", { estacao: "molde-roteirista", saida: { ok: true } });
      const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/0019_orquestrador.sql"), "utf8");
      await db.sql(sql);
      await db.sql(sql);
      const b = await ler(a.id);
      assert.equal(b.versao, a.versao);
      assert.deepEqual(b.passos, a.passos);
      // o número da mensagem do Telegram não é mudança do item; o estado é
      await db.sql("update public.molde_fila set telegram_msg_id = 99, telegram_aviso_em = now() where id = $1", [a.id]);
      assert.equal((await ler(a.id)).versao, a.versao);
      await db.sql("update public.molde_fila set etapa = 'outra' where id = $1", [a.id]);
      assert.equal((await ler(a.id)).versao, a.versao + 1);
      await assert.rejects(db.sql("update public.molde_fila set estado = 'voando' where id = $1", [a.id]), /molde_fila_estado_check/);
    });
  });

  describe("a página e o Telegram de sempre continuam iguais", () => {
    test("um espelho «para_aprovar» da página ainda manda só Aprovar / Refazer, e a decisão continua «pendente» para a página", async () => {
      const r = await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { itens: [{ ref: "pedido:pab", pedidoId: "pab", tipo: "fotos", estado: "para_aprovar", projeto: "birdie", avatar: "Birdie", titulo: "Fotos", previa: { texto: "3 fotos" } }] } }));
      const id = (await r.json()).data[0].id;
      assert.deepEqual(botoes().map((x) => x.text), ["Aprovar", "Refazer"]);
      // as letras novas não valem para o espelho
      const corrigir = callbackData.signCallback({ kind: "f", action: "k", id, version: 1 })!;
      assert.equal((await (await tocar(corrigir)).json()).acao, "fechado");
      assert.equal((await (await tocar(botoes()[0].callback_data)).json()).acao, "aprovar");
      const pend = await (await listar("?decisoes=pendentes", MOLDE)).json();
      assert.deepEqual(pend.data.map((x: { id: string }) => x.id), [id]);
      const l = await ler(id);
      assert.equal(l.estado, "aprovado");
      assert.equal(l.estacao, null);
    });
  });
});
