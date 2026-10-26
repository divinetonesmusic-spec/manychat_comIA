import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/**
 * v134 · N1 Fila única e F-MCP parte 1: o espelho dos pedidos da página (/api/molde/fila), aprovar pelo Telegram (com o
 * motivo do «Refazer» em texto) e pedir pelo Telegram («/reel», «/fotos», «/status») com o 2º toque «Confirmar · US$ X».
 * Banco de teste com a 0016; Telegram falso.
 */
const meta = installFakeMeta();

const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const SEGREDO = "segredo-falso-do-webhook-do-telegram-0123";
const CHAT = "42";
const TG = { "x-telegram-bot-api-secret-token": SEGREDO };

type Item = { id: string; ref: string; estado: string; rodada: number; origem: string; pedidoId: string | null; chave: string | null; custoEstimadoUsd: number; decisao: { decisao: string; nota: string | null; via: string; rodada: number } | null; decisaoPendente: boolean; projeto: string; avatar: string; tipo: string; titulo: string; pedido: Record<string, unknown> };
type Botao = { text: string; callback_data: string };

describe("v134 · fila única e Telegram para aprovar e pedir", { skip: semBanco }, () => {
  let db: TestDatabase;
  let filaRoute: typeof import("@/app/api/molde/fila/route");
  let acaoRoute: typeof import("@/app/api/molde/fila/[id]/[acao]/route");
  let webhookRoute: typeof import("@/app/api/telegram/webhook/route");
  let relogio: typeof import("@/lib/molde/relogio");
  let callbackData: typeof import("@/lib/telegram/callback-data");
  let telegramFila: typeof import("@/lib/telegram/fila");
  let seq = 0;

  before(async () => {
    db = await createTestDatabase();
    filaRoute = await import("@/app/api/molde/fila/route");
    acaoRoute = await import("@/app/api/molde/fila/[id]/[acao]/route");
    webhookRoute = await import("@/app/api/telegram/webhook/route");
    relogio = await import("@/lib/molde/relogio");
    callbackData = await import("@/lib/telegram/callback-data");
    telegramFila = await import("@/lib/telegram/fila");
  });

  beforeEach(async () => {
    meta.reset();
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    process.env.TELEGRAM_CHAT_ID = CHAT;
    process.env.TELEGRAM_WEBHOOK_SECRET = SEGREDO;
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    await db.sql("delete from public.molde_fila");
    await db.sql("delete from public.molde_avatares");
  });

  after(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    meta.restore();
    await db?.close();
  });

  // ---------- ajudantes ----------
  const mandar = (json: Record<string, unknown>, headers: Record<string, string> = MOLDE) =>
    filaRoute.POST(request("/api/molde/fila", { method: "POST", json, headers }));
  const listar = (consulta = "") => filaRoute.GET(request(`/api/molde/fila${consulta}`, { headers: MOLDE }));
  const acao = (id: string, nome: string, json: Record<string, unknown> = {}) =>
    acaoRoute.POST(request(`/api/molde/fila/${id}/${nome}`, { method: "POST", json, headers: MOLDE }), routeParams({ id, acao: nome }));
  const linha = async (id: string) => (await db.sql<Record<string, unknown>>("select * from public.molde_fila where id = $1", [id]))[0];
  const espelho = (extra: Record<string, unknown> = {}) => ({
    ref: "pedido:pab12", pedidoId: "pab12", chave: "k0123456789abcdef", projeto: "birdie", avatar: "Birdie", tipo: "fotos",
    titulo: "Fotos do ensaio", estado: "produzindo", custoEstimadoUsd: 0.12, ...extra,
  });
  async function registrar(extra: Record<string, unknown> = {}) {
    const r = await mandar({ itens: [espelho(extra)] });
    assert.equal(r.status, 200);
    const corpo = await r.json();
    return corpo.data[0] as { id: string; estado: string; rodada: number; avisar: boolean; criado: boolean; mudou: boolean };
  }
  function escrever(texto: string, opcoes: { chat?: string | number; de?: number } = {}) {
    seq += 1;
    const update = { update_id: seq, message: { message_id: 500 + seq, chat: { id: opcoes.chat ?? Number(CHAT) }, from: { id: opcoes.de ?? 7, username: "nicolas" }, text: texto } };
    return webhookRoute.POST(request("/api/telegram/webhook", { method: "POST", json: update, headers: TG }));
  }
  function tocar(data: string, opcoes: { chat?: string | number; messageId?: number } = {}) {
    seq += 1;
    const update = { update_id: seq, callback_query: { id: `cb-${seq}`, from: { id: 7, username: "nicolas" }, data, message: { message_id: opcoes.messageId ?? 1, chat: { id: opcoes.chat ?? Number(CHAT) }, text: "Molde: mensagem antiga" } } };
    return webhookRoute.POST(request("/api/telegram/webhook", { method: "POST", json: update, headers: TG }));
  }
  const ultima = () => meta.telegram.at(-1)?.body as { text?: string; reply_markup?: { inline_keyboard: Botao[][] } } | undefined;
  const botoes = (corpo = ultima()) => (corpo?.reply_markup?.inline_keyboard ?? []).flat();
  const chamadas = (metodo: string) => meta.telegramApi.filter((c) => c.method === metodo);
  const avatares = (lista = [{ projeto: "birdie", nome: "Birdie", conta: "birdie.lanier" }, { projeto: "dell", nome: "Dell", conta: "" }], precos: Record<string, number> = { foto: 0.04, reel: 1.2 }) =>
    mandar({ avatares: lista, precos });

  // ---------- o espelho ----------

  describe("o espelho dos pedidos da página", () => {
    test("sem o x-molde-token: 401; com ele cria, e o mesmo espelho de novo não muda nada", async () => {
      assert.equal((await mandar({ itens: [espelho()] }, {})).status, 401);
      const a = await registrar();
      assert.equal(a.criado, true);
      assert.equal(a.estado, "produzindo");
      const b = await registrar();
      assert.equal(b.id, a.id);
      assert.equal(b.mudou, false);
      const r = await listar("?projeto=birdie");
      const corpo = await r.json();
      assert.equal(corpo.data.length, 1);
      assert.equal(corpo.data[0].chave, "k0123456789abcdef");
      assert.equal(corpo.contagem.birdie.estados.produzindo, 1);
      assert.equal(meta.telegram.length, 0, "produzindo não manda nada no Telegram");
    });

    test("validação: estado, ref e lote grandes demais são recusados com a frase", async () => {
      assert.equal((await mandar({ itens: [espelho({ estado: "rascunho" })] })).status, 400);
      assert.equal((await mandar({ itens: [espelho({ ref: "qualquer" })] })).status, 400);
      assert.equal((await mandar({ itens: [espelho({ previa: { video: "http://inseguro.teste/x.mp4" } })] })).status, 400);
      assert.equal((await mandar({ itens: Array.from({ length: 51 }, (_, i) => espelho({ ref: `pedido:p${i}`, pedidoId: `p${i}` })) })).status, 400);
      const r = await mandar({});
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /itens/);
    });

    test("«para aprovar» manda a prévia com «Aprovar» / «Refazer» (botões assinados, tipo f, a rodada)", async () => {
      const a = await registrar({ estado: "para_aprovar", previa: { imagem: "https://midia.teste.invalid/foto.png", texto: "3 fotos" } });
      assert.equal(a.rodada, 1);
      const msg = ultima();
      assert.match(String(msg?.text), /as fotos «Fotos do ensaio» de Birdie está pronto para aprovar/);
      assert.match(String(msg?.text), /https:\/\/midia\.teste\.invalid\/foto\.png/);
      const [aprovar, refazer] = botoes();
      assert.deepEqual([aprovar.text, refazer.text], ["Aprovar", "Refazer"]);
      assert.ok(Buffer.byteLength(aprovar.callback_data) <= 64);
      assert.deepEqual(callbackData.verifyCallback(aprovar.callback_data), { kind: "f", action: "a", id: a.id, version: 1 });
      assert.equal(Number((await linha(a.id)).telegram_msg_id), meta.telegram.length);
      // o mesmo espelho de novo não manda outra mensagem
      await registrar({ estado: "para_aprovar", previa: { imagem: "https://midia.teste.invalid/foto.png", texto: "3 fotos" } });
      assert.equal(meta.telegram.length, 1);
    });

    test("«Aprovar» no Telegram: aprovado e pendente para a página; o espelho atrasado não desfaz; «aplicada» fecha", async () => {
      const previa = { imagem: "https://midia.teste.invalid/foto.png" };
      const a = await registrar({ estado: "para_aprovar", previa });
      const [aprovar] = botoes();
      const r = await tocar(aprovar.callback_data);
      assert.equal((await r.json()).acao, "aprovar");
      assert.equal((await linha(a.id)).estado, "aprovado");
      assert.match(String(chamadas("editMessageText").at(-1)?.body.text), /Aprovado às \d{2}:\d{2} \(pelo Telegram\)/);
      // dois toques = uma ação
      assert.equal((await (await tocar(aprovar.callback_data)).json()).acao, "repetido");
      // a página ainda não aplicou: um espelho atrasado com a mesma prévia não volta para «para aprovar»
      const b = await registrar({ estado: "para_aprovar", previa });
      assert.equal(b.estado, "aprovado");
      const pend = await (await listar("?decisoes=pendentes")).json();
      assert.deepEqual(pend.data.map((x: Item) => [x.id, x.decisao?.decisao, x.decisaoPendente]), [[a.id, "aprovar", true]]);
      assert.equal((await acao(a.id, "aplicada", { rodada: 2 })).status, 409, "rodada errada");
      assert.equal((await acao(a.id, "aplicada", { rodada: 1 })).status, 200);
      assert.equal((await (await listar("?decisoes=pendentes")).json()).data.length, 0);
      // depois de aplicada, a página manda «aprovado» e nada muda; uma aba com outro projeto aberto (sem ver a decisão) que
      // ainda manda «para aprovar» com a mesma prévia também não reabre nem manda a mensagem de novo
      assert.equal((await registrar({ estado: "aprovado", previa })).estado, "aprovado");
      const n = meta.telegram.length;
      assert.equal((await registrar({ estado: "para_aprovar", previa })).estado, "aprovado");
      assert.equal(meta.telegram.length, n);
    });

    test("«Refazer» pede o motivo em texto; a próxima mensagem do dono vira a nota; outra conversa não conta", async () => {
      const a = await registrar({ estado: "para_aprovar", previa: { imagem: "https://midia.teste.invalid/foto.png" } });
      const [, refazer] = botoes();
      const r = await tocar(refazer.callback_data);
      assert.equal((await r.json()).acao, "motivo");
      assert.equal((await linha(a.id)).estado, "para_aprovar", "só o toque não decide nada");
      assert.match(String(ultima()?.text), /O que você quer mudar em «Fotos do ensaio»/);
      // mensagem de outra conversa: ignorada, sem resposta
      const antes = meta.telegram.length;
      const fora = await escrever("pode apagar tudo", { chat: 999 });
      assert.equal((await fora.json()).ignorado, true);
      assert.equal(meta.telegram.length, antes);
      assert.equal((await linha(a.id)).estado, "para_aprovar");
      // a do dono vira o motivo
      const m = await escrever("Mais luz no rosto e sem óculos");
      assert.equal((await m.json()).acao, "refazer");
      const depois = await linha(a.id);
      assert.equal(depois.estado, "refazer");
      assert.equal((depois.decisao as { nota: string }).nota, "Mais luz no rosto e sem óculos");
      assert.match(String(chamadas("editMessageText").at(-1)?.body.text), /Pedido para refazer às .*«Mais luz no rosto e sem óculos»/);
      // a página refez: nova prévia → rodada 2 e mensagem nova; o botão da rodada 1 não decide a 2
      await acao(a.id, "aplicada", { rodada: 1 });
      await registrar({ estado: "produzindo", previa: null });
      const v2 = await registrar({ estado: "para_aprovar", previa: { imagem: "https://midia.teste.invalid/foto-2.png" } });
      assert.equal(v2.rodada, 2);
      assert.equal((await (await tocar(refazer.callback_data)).json()).acao, "antigo");
    });

    test("decidir pela página: aprovar reflete no Telegram; refazer sem a nota é recusado", async () => {
      const a = await registrar({ estado: "para_aprovar", previa: { link: "https://midia.teste.invalid/ebook.pdf" } });
      assert.equal((await acao(a.id, "decidir", { decisao: "refazer" })).status, 400);
      const r = await acao(a.id, "decidir", { decisao: "aprovar", rodada: 1 });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).data.decisao.via, "pagina");
      assert.match(String(chamadas("editMessageText").at(-1)?.body.text), /Aprovado às .*\(pela página\)/);
      assert.equal((await acao(a.id, "decidir", { decisao: "aprovar", rodada: 1 })).status, 409);
    });

    test("o relógio manda de novo a aprovação que não saiu na hora (e só uma vez a cada 10 min)", async () => {
      meta.telegramFails = "rede";
      const a = await registrar({ estado: "para_aprovar", previa: { imagem: "https://midia.teste.invalid/foto.png" } });
      assert.equal((await linha(a.id)).telegram_msg_id, null);
      meta.telegramFails = null;
      await db.sql("update public.molde_fila set atualizado_em = now() - interval '5 minutes', telegram_aviso_em = now() - interval '11 minutes' where id = $1", [a.id]);
      await relogio.runMoldeClock({ deadline: Date.now() + 8000, origin: "https://uaiflow.teste" });
      assert.ok((await linha(a.id)).telegram_msg_id, "a mensagem saiu pelo relógio");
      const n = meta.telegram.length;
      await relogio.runMoldeClock({ deadline: Date.now() + 8000, origin: "https://uaiflow.teste" });
      assert.equal(meta.telegram.length, n);
    });
  });

  // ---------- pedir pelo Telegram ----------

  describe("pedir pelo Telegram", () => {
    test("os comandos em português", () => {
      assert.deepEqual(telegramFila.lerComando("/novo reel 3 erros da poupança"), { comando: "reel", resto: "3 erros da poupança" });
      assert.deepEqual(telegramFila.lerComando("/reel@MoldeBot café"), { comando: "reel", resto: "café" });
      assert.deepEqual(telegramFila.lerComando("/fotos 3 na praia"), { comando: "fotos", resto: "na praia", n: 3 });
      assert.deepEqual(telegramFila.lerComando("/foto na praia"), { comando: "fotos", resto: "na praia", n: 1 });
      assert.equal(telegramFila.lerComando("oi")?.comando, undefined);
      assert.equal(telegramFila.lerComando("/xyz")?.comando, "ajuda");
      assert.equal(telegramFila.lerComando("/status")?.comando, "status");
    });

    test("sem avatares: pede para abrir a página; /ajuda e /start explicam os comandos", async () => {
      await escrever("/reel tema");
      assert.match(String(ultima()?.text), /abra a página do Molde uma vez/);
      await escrever("/ajuda");
      assert.match(String(ultima()?.text), /\/reel <tema>/);
      assert.match(String(ultima()?.text), /Nada gasta com 1 toque/);
    });

    test("/fotos com 2 avatares: botões de cada um → o custo → só o 2º toque «Confirmar · US$ 0,08» põe na fila", async () => {
      assert.equal((await avatares()).status, 200);
      const r = await escrever("/fotos 2 tomando café na varanda");
      const corpo = await r.json();
      assert.equal(corpo.acao, "rascunho");
      assert.match(String(ultima()?.text), /Para qual avatar\?/);
      const nomes = botoes().map((b) => b.text);
      assert.deepEqual(nomes, ["Birdie (@birdie.lanier)", "Dell", "Cancelar"]);
      // o rascunho não aparece na fila da página e a página não consegue mudar ele
      assert.equal((await (await listar()).json()).data.length, 0);
      const bloqueado = await mandar({ itens: [espelho({ id: corpo.id, ref: `telegram:${corpo.id}`, estado: "produzindo" })] });
      assert.match(JSON.stringify((await bloqueado.json()).data[0]), /ainda não foi confirmado/);

      const v = await tocar(botoes()[0].callback_data, { messageId: 77 });
      assert.equal((await v.json()).acao, "avatar");
      const edit = chamadas("editMessageText").at(-1)?.body as { text: string; reply_markup: { inline_keyboard: Botao[][] } };
      assert.match(edit.text, /2 fotos para Birdie \(@birdie\.lanier\)/);
      assert.match(edit.text, /≈ US\$ 0,08/);
      const [confirmar, cancelar] = edit.reply_markup.inline_keyboard.flat();
      assert.equal(confirmar.text, "Confirmar · US$ 0,08");
      assert.equal(cancelar.text, "Cancelar");
      assert.equal((await linha(corpo.id)).estado, "rascunho", "escolher o avatar (1º toque) não põe na fila");

      const c = await tocar(confirmar.callback_data);
      assert.equal((await c.json()).acao, "confirmado");
      const l = await linha(corpo.id);
      assert.equal(l.estado, "na_fila");
      assert.equal(l.projeto, "birdie");
      assert.equal(Number(l.custo_estimado_usd), 0.08);
      assert.equal(l.confirmado_via, "telegram");
      assert.equal((await (await tocar(confirmar.callback_data)).json()).acao, "repetido", "dois toques = um pedido");

      // a página pega os confirmados que ainda não criou
      const pendentes = (await (await listar("?origem=telegram&estado=na_fila&semPedido=1")).json()).data as Item[];
      assert.deepEqual(pendentes.map((x) => [x.id, x.pedido.comando, x.pedido.n, x.pedido.texto]), [[corpo.id, "fotos", 2, "tomando café na varanda"]]);
      // e liga o pedido dela à linha (pelo id): some dos pendentes, o estado segue o da página
      const lig = await mandar({ itens: [espelho({ id: corpo.id, ref: "pedido:pxyz", pedidoId: "pxyz", estado: "produzindo" })] });
      assert.equal((await lig.json()).data[0].id, corpo.id);
      assert.equal((await linha(corpo.id)).pedido_id, "pxyz");
      assert.equal((await (await listar("?origem=telegram&estado=na_fila&semPedido=1")).json()).data.length, 0);
      // o espelho seguinte (pela ref do pedido) acha a mesma linha
      const seguinte = await mandar({ itens: [espelho({ ref: "pedido:pxyz", pedidoId: "pxyz", estado: "pronto" })] });
      assert.equal((await seguinte.json()).data[0].id, corpo.id);
    });

    test("/reel com 1 avatar: direto ao custo (US$ 0,00 agora, o vídeo depois com outra confirmação); «Cancelar» não pede nada", async () => {
      await avatares([{ projeto: "birdie", nome: "Birdie", conta: "" }]);
      const r = await escrever("/novo reel 3 erros de quem guarda dinheiro");
      const corpo = await r.json();
      assert.match(String(ultima()?.text), /Reel novo para Birdie sobre «3 erros de quem guarda dinheiro»/);
      assert.match(String(ultima()?.text), /Produzir o vídeo depois custa ≈ US\$ 1,20/);
      const [confirmar, cancelar] = botoes();
      assert.equal(confirmar.text, "Confirmar · US$ 0,00");
      assert.equal((await (await tocar(cancelar.callback_data)).json()).acao, "cancelado");
      assert.equal((await linha(corpo.id)).estado, "cancelado");
      assert.equal((await (await tocar(confirmar.callback_data)).json()).acao, "repetido");
      assert.equal((await linha(corpo.id)).estado, "cancelado", "cancelado não volta");
    });

    test("o rascunho vence em 30 min; o relógio apaga os de mais de 1 dia", async () => {
      await avatares([{ projeto: "birdie", nome: "Birdie", conta: "" }]);
      const corpo = await (await escrever("/fotos praia")).json();
      const [confirmar] = botoes();
      await db.sql("update public.molde_fila set expira_em = now() - interval '1 minute', criado_em = now() - interval '2 days' where id = $1", [corpo.id]);
      assert.equal((await (await tocar(confirmar.callback_data)).json()).acao, "fechado");
      assert.equal((await linha(corpo.id)).estado, "rascunho");
      await relogio.runMoldeClock({ deadline: Date.now() + 8000, origin: "https://uaiflow.teste" });
      assert.equal(await linha(corpo.id), undefined);
    });

    test("/status mostra a fila por avatar; TELEGRAM_ALLOWED_USER_IDS barra outra pessoa da conversa", async () => {
      await registrar({ estado: "produzindo" });
      await registrar({ ref: "pedido:p2", pedidoId: "p2", estado: "para_aprovar", previa: { texto: "pronto" } });
      await escrever("/status");
      assert.match(String(ultima()?.text), /Birdie: 1 produzindo, 1 para aprovar/);
      process.env.TELEGRAM_ALLOWED_USER_IDS = "7";
      const antes = meta.telegram.length;
      const outro = await escrever("/status", { de: 8 });
      assert.equal((await outro.json()).ignorado, true);
      assert.equal(meta.telegram.length, antes);
    });

    test("a página manda os avatares e os preços; quem saiu da lista sai do Telegram", async () => {
      await avatares();
      await avatares([{ projeto: "dell", nome: "Dell", conta: "dell.rivers" }], { foto: 0.1 });
      const corpo = await (await listar()).json();
      assert.deepEqual(corpo.avatares, [{ projeto: "dell", nome: "Dell", conta: "dell.rivers" }]);
      await escrever("/fotos 3 no escritório");
      assert.equal(botoes()[0].text, "Confirmar · US$ 0,30");
    });
  });
});
