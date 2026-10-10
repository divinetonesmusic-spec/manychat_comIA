import "./helpers/env.mjs";
import { comAfter } from "./helpers/escopo-next.mjs";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { BASE_URL, request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/**
 * DMs sem resposta esperando o Molde: quando entram na fila (webhook), o contrato das duas rotas e o envio pela fila normal.
 * Webhook assinado como a Meta assina; Meta falsa; banco de teste com a 0006.
 */
const meta = installFakeMeta();

const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const HORA = 3600_000;

type Item = {
  id: string; accountId: string; username: string | null; instagramUserId: string;
  mensagens: { texto: string; em: string }[]; ultimaEm: string; prazoAte: string | null; status: string;
  resposta: string | null; nota: string | null; conversa: { de: string; texto: string; em: string }[];
};

describe("DMs sem resposta para o Molde", { skip: semBanco }, () => {
  let db: TestDatabase;
  let webhook: typeof import("@/app/api/webhook/route");
  let listar: typeof import("@/app/api/molde/dms/route");
  let item: typeof import("@/app/api/molde/dms/[id]/route");
  let drain: typeof import("@/lib/queue/drain");
  let repos: typeof import("@/lib/db/repositories");
  let contaA: string;
  let contaB: string;
  let seq = 0;

  before(async () => {
    db = await createTestDatabase();
    webhook = await import("@/app/api/webhook/route");
    listar = await import("@/app/api/molde/dms/route");
    item = await import("@/app/api/molde/dms/[id]/route");
    drain = await import("@/lib/queue/drain");
    repos = await import("@/lib/db/repositories");
  });

  beforeEach(async () => {
    meta.reset();
    seq = 0;
    for (const tabela of ["dm_pending", "queue", "events", "contacts", "automations", "profile_settings", "instagram_accounts"]) await db.sql(`delete from public.${tabela}`);
    contaA = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A", isDefault: true });
    contaB = await seedAccount(db, { username: "conta_b", userId: "1002", token: "IGAA-TESTE-B", isDefault: false });
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  // ---------- ajudantes ----------

  /** Manda um evento de mensagem ao webhook, assinado. Devolve a resposta HTTP. */
  async function enviarAoWebhook(evento: Record<string, unknown>, perfil = "1001") {
    const corpo = JSON.stringify({ object: "instagram", entry: [{ id: perfil, time: Date.now(), messaging: [{ recipient: { id: perfil }, timestamp: Date.now(), ...evento }] }] });
    const assinatura = `sha256=${createHmac("sha256", process.env.INSTAGRAM_APP_SECRET as string).update(corpo).digest("hex")}`;
    const pedido = new NextRequest(new URL("/api/webhook", BASE_URL), { method: "POST", body: corpo, headers: { "x-hub-signature-256": assinatura, "content-type": "application/json" } });
    return comAfter(() => webhook.POST(pedido));
  }

  /** Uma DM de texto da pessoa `de` (id do Instagram dela). */
  async function dm(de: string, texto: string, extra: Record<string, unknown> = {}, perfil = "1001") {
    seq += 1;
    return enviarAoWebhook({ sender: { id: de, username: `user_${de}` }, message: { mid: `mid-${de}-${seq}`, text: texto, ...extra } }, perfil);
  }

  const pendentes = () => db.sql<{ id: string; status: string; messages: { texto: string; em: string; eventId: string }[]; contact_id: string; account_id: string; last_message_at: Date; username: string | null }>(
    "select * from public.dm_pending order by created_at, id",
  );

  const GET = (consulta = "", headers: Record<string, string> = MOLDE) => listar.GET(request(`/api/molde/dms${consulta}`, { headers }));
  const itens = async (consulta = "") => {
    const response = await GET(consulta);
    assert.equal(response.status, 200);
    return (await response.json()).data as Item[];
  };
  const POST = (id: string, json: unknown, headers: Record<string, string> = MOLDE) => item.POST(request(`/api/molde/dms/${id}`, { method: "POST", json, headers }), routeParams({ id }));

  async function contatoDe(instagramUserId: string, conta = contaA) {
    const [c] = await db.sql<{ id: string; last_response_at: Date | null; human_paused_at: Date | null }>("select id, last_response_at, human_paused_at from public.contacts where account_id = $1 and instagram_user_id = $2", [conta, instagramUserId]);
    return c;
  }

  /** Cria uma DM sem resposta e devolve o item. */
  async function umaPendente(de = "pessoa1", texto = "Oi, queria saber mais") {
    assert.equal((await dm(de, texto)).status, 200);
    const [pendente] = await itens();
    return pendente;
  }

  const filaDe = (id: string) => db.sql<{ id: string; status: string; send_type: string; payload: Record<string, unknown>; attempts: number; available_at: Date; last_error: string | null; instagram_recipient_id: string; event_id: string | null; contact_id: string }>("select * from public.queue where id = $1", [id]);
  const filaTudo = () => db.sql<{ id: string; status: string; payload: Record<string, unknown>; last_error: string | null }>("select * from public.queue order by created_at");

  async function automacao(campos: Record<string, unknown>) {
    return repos.createAutomation({ account_id: contaA, name: "Automação de teste", ...campos });
  }

  async function configurar(campos: Record<string, unknown>) {
    const colunas = Object.keys(campos);
    await db.sql(
      `insert into public.profile_settings (id, account_id, ${colunas.join(", ")}) values (true, $1, ${colunas.map((_, i) => `$${i + 2}`).join(", ")})
       on conflict (account_id) do update set ${colunas.map((c) => `${c} = excluded.${c}`).join(", ")}`,
      [contaA, ...Object.values(campos)],
    );
  }

  // ---------- quando a DM entra na fila ----------

  describe("quando a DM entra na fila", () => {
    test("DM sem palavra-chave e sem automação padrão: 1 item aguardando, com o texto, o usuário e o evento", async () => {
      const resposta = await dm("pessoa1", "Oi, queria saber mais");
      assert.equal(resposta.status, 200);
      const linhas = await pendentes();
      assert.equal(linhas.length, 1);
      const [linha] = linhas;
      assert.equal(linha.status, "aguardando");
      assert.equal(linha.account_id, contaA);
      assert.equal(linha.contact_id, (await contatoDe("pessoa1")).id);
      assert.equal(linha.username, "user_pessoa1");
      assert.equal(linha.messages.length, 1);
      assert.equal(linha.messages[0].texto, "Oi, queria saber mais");
      const [evento] = await db.sql<{ id: string; instagram_event_id: string }>("select id, instagram_event_id from public.events");
      assert.equal(linha.messages[0].eventId, evento.id);
      assert.ok(Math.abs(new Date(linha.messages[0].em).getTime() - Date.now()) < 10_000, "a hora é a da mensagem");
      assert.equal((await filaTudo()).length, 0, "nada foi enviado");
    });

    test("a 2ª DM do mesmo contato entra no mesmo item", async () => {
      await dm("pessoa1", "primeira");
      await dm("pessoa1", "segunda");
      const linhas = await pendentes();
      assert.equal(linhas.length, 1);
      assert.deepEqual(linhas[0].messages.map((m) => m.texto), ["primeira", "segunda"]);
      await dm("pessoa2", "outra pessoa");
      assert.equal((await pendentes()).length, 2, "outro contato tem o seu item");
    });

    test("11 DMs: ficam as 10 mais novas, em ordem", async () => {
      for (let i = 1; i <= 11; i += 1) await dm("pessoa1", `mensagem ${i}`);
      const linhas = await pendentes();
      assert.equal(linhas.length, 1);
      assert.deepEqual(linhas[0].messages.map((m) => m.texto), Array.from({ length: 10 }, (_, i) => `mensagem ${i + 2}`));
    });

    test("a mesma mensagem entregue duas vezes pela Meta não entra duas vezes", async () => {
      const evento = { sender: { id: "pessoa1", username: "user_pessoa1" }, message: { mid: "mid-repetido", text: "oi" } };
      await enviarAoWebhook(evento);
      await enviarAoWebhook(evento);
      const linhas = await pendentes();
      assert.equal(linhas.length, 1);
      assert.equal(linhas[0].messages.length, 1);
    });

    test("responder a um story também entra", async () => {
      await dm("pessoa1", "amei esse story!", { reply_to: { story: { id: "story-1" } } });
      const linhas = await pendentes();
      assert.equal(linhas.length, 1);
      assert.equal(linhas[0].messages[0].texto, "amei esse story!");
    });

    test("DM que casa uma palavra-chave: nada entra (a automação responde)", async () => {
      await automacao({ name: "Preço", triggers: ["dm"], keywords: ["preço"], match_type: "contains", welcome_dm: "Custa pouco!" });
      await dm("pessoa1", "Qual o preço?");
      assert.equal((await pendentes()).length, 0);
      const fila = await filaTudo();
      assert.equal(fila.length, 1, "a automação enfileirou a resposta dela");
    });

    test("automação padrão ativa: nada entra; padrão desligada: entra", async () => {
      const padrao = await automacao({ name: "Padrão", triggers: ["dm"], match_type: "contains", keywords: ["zzz-nunca"], welcome_dm: "Oi! Já te respondo." });
      await configurar({ default_automation_id: padrao.id });
      await dm("pessoa1", "bom dia");
      assert.equal((await pendentes()).length, 0);
      assert.equal((await filaTudo()).length, 1);

      await db.sql("update public.automations set active = false where id = $1", [padrao.id]);
      await dm("pessoa2", "boa tarde");
      assert.equal((await pendentes()).length, 1, "padrão desligada não responde, então a DM espera o Molde");
    });

    test("palavras de sair e de voltar (parar / começar): nada entra", async () => {
      await dm("pessoa1", "parar");
      await dm("pessoa2", "Começar");
      assert.equal((await pendentes()).length, 0);
      const [saiu] = await db.sql<{ opted_out_at: Date | null }>("select opted_out_at from public.contacts where instagram_user_id = 'pessoa1'");
      assert.ok(saiu.opted_out_at, "o contato saiu da lista (o webhook tratou a palavra)");
    });

    test("reação, eco, leitura, entrega, edição e DM sem texto (foto): nada entra", async () => {
      const pessoa = { sender: { id: "pessoa1", username: "user_pessoa1" } };
      await enviarAoWebhook({ ...pessoa, reaction: { mid: "m1", action: "react", reaction: "love" } });
      await enviarAoWebhook({ ...pessoa, message: { mid: "m2", text: "eco", is_echo: true } });
      await enviarAoWebhook({ ...pessoa, read: { mid: "m3" } });
      await enviarAoWebhook({ ...pessoa, delivery: { mids: ["m4"] } });
      await enviarAoWebhook({ ...pessoa, message_edit: { mid: "m5" } });
      await enviarAoWebhook({ ...pessoa, message: { mid: "m6", attachments: [{ type: "image", payload: { url: "https://x.invalid/a.jpg" } }] } });
      await enviarAoWebhook({ ...pessoa, message: { mid: "m7", text: "   " } });
      assert.equal((await pendentes()).length, 0);
    });

    test("mensagem do próprio perfil e botão (postback ou resposta rápida): nada entra", async () => {
      await enviarAoWebhook({ sender: { id: "1001" }, message: { mid: "m1", text: "eu mesma" } });
      await enviarAoWebhook({ sender: { id: "pessoa1" }, postback: { payload: "qualquer-coisa", title: "Botão" } });
      await enviarAoWebhook({ sender: { id: "pessoa2" }, message: { mid: "m2", text: "Quero", quick_reply: { payload: "sem-prefixo" } } });
      assert.equal((await pendentes()).length, 0);
    });

    test("canal desligado: nada entra", async () => {
      await configurar({ channel_active: false });
      await dm("pessoa1", "alguém aí?");
      assert.equal((await pendentes()).length, 0);
    });

    test("depois de enviada a resposta, uma mensagem nova abre outro item", async () => {
      const primeiro = await umaPendente();
      assert.equal((await POST(primeiro.id, { acao: "enviar", texto: "Oi!" })).status, 200);
      await dm("pessoa1", "obrigada, e o preço?");
      const linhas = await pendentes();
      assert.equal(linhas.length, 2);
      assert.deepEqual(linhas.map((l) => l.status).sort(), ["aguardando", "na_fila"]);
    });
  });

  // ---------- rodada de correções 1 ----------

  describe("mensagem reentregue, quem pediu para sair e a limpeza", () => {
    const evento = (de: string, mid: string, texto: string) => ({ sender: { id: de, username: `user_${de}` }, message: { mid, text: texto } });

    test("a Meta reentrega a mensagem depois de descartada, enviada ou expirada: não nasce outro 'aguardando'", async () => {
      for (const [de, fechar] of [
        ["p-descartada", async (id: string) => POST(id, { acao: "descartar" })],
        ["p-enviada", async (id: string) => POST(id, { acao: "enviar", texto: "Oi!" })],
        ["p-expirada", async (id: string) => { await db.sql("update public.dm_pending set status = 'expirada' where id = $1", [id]); }],
      ] as const) {
        await enviarAoWebhook(evento(de, `mid-${de}`, "oi"));
        const [antes] = await db.sql<{ id: string }>("select id from public.dm_pending where instagram_user_id = $1", [de]);
        await fechar(antes.id);
        const reenvio = await enviarAoWebhook(evento(de, `mid-${de}`, "oi"));
        assert.equal(reenvio.status, 200);
        const linhas = await db.sql<{ status: string }>("select status from public.dm_pending where instagram_user_id = $1", [de]);
        assert.equal(linhas.length, 1, `${de}: continua uma linha só`);
        assert.notEqual(linhas[0].status, "aguardando", `${de}: nada reabriu`);
      }
      assert.equal((await filaTudo()).length, 1, "só a resposta aprovada de verdade está na fila");
      // Uma mensagem NOVA (outro mid) da mesma pessoa abre item normalmente.
      await enviarAoWebhook(evento("p-descartada", "mid-nova", "e agora?"));
      assert.equal((await db.sql("select 1 from public.dm_pending where instagram_user_id = 'p-descartada' and status = 'aguardando'")).length, 1);
    });

    test("a mesma mensagem entregue duas vezes AO MESMO TEMPO não duplica (corrida no 'on conflict')", async () => {
      for (let rodada = 0; rodada < 5; rodada += 1) {
        const de = `corrida${rodada}`;
        await enviarAoWebhook(evento(de, `mid-a-${de}`, "primeira"));
        const repetida = evento(de, `mid-b-${de}`, "segunda");
        await Promise.all([enviarAoWebhook(repetida), enviarAoWebhook(repetida), enviarAoWebhook(repetida)]);
        const [linha] = await db.sql<{ messages: { texto: string }[] }>("select messages from public.dm_pending where instagram_user_id = $1", [de]);
        assert.deepEqual(linha.messages.map((m) => m.texto), ["primeira", "segunda"], `rodada ${rodada}`);
      }
    });

    test("pediu 'parar' com item aguardando: o item é descartado com a frase e a resposta aprovada não sai", async () => {
      const pendente = await umaPendente();
      assert.equal((await dm("pessoa1", "Parar")).status, 200);
      const [linha] = await db.sql<{ status: string; status_note: string }>("select status, status_note from public.dm_pending");
      assert.equal(linha.status, "descartada");
      assert.equal(linha.status_note, "A pessoa pediu para não receber mensagens.");
      const resposta = await POST(pendente.id, { acao: "enviar", texto: "Oi!" });
      assert.equal(resposta.status, 409);
      assert.equal((await filaTudo()).length, 0);
      const [visto] = await itens();
      assert.equal(visto.status, "descartada");
      assert.equal(visto.nota, "A pessoa pediu para não receber mensagens.");
    });

    test("aprovou, a resposta está na fila e a pessoa manda 'parar': a resposta do Molde não sai, o item fecha com a frase e a confirmação sai", async () => {
      const saida = await automacao({ name: "Saída", triggers: ["dm"], keywords: ["zzz-nunca"], match_type: "contains", welcome_dm: "Pronto, você não vai mais receber mensagens." });
      await configurar({ opt_out_automation_id: saida.id });
      const pendente = await umaPendente();
      const aprovada = await POST(pendente.id, { acao: "enviar", texto: "Oi! O ebook custa R$ 29." });
      assert.equal(aprovada.status, 200);
      assert.equal((await aprovada.json()).data.status, "na_fila");
      const [{ queue_id: filaId }] = await db.sql<{ queue_id: string }>("select queue_id from public.dm_pending");

      assert.equal((await dm("pessoa1", "parar")).status, 200);
      const [job] = await filaDe(filaId);
      assert.equal(job.status, "skipped", "a resposta do Molde foi segurada na fila");
      assert.equal(job.last_error, "A pessoa pediu para não receber mensagens.");
      const [linha] = await db.sql<{ status: string; status_note: string }>("select status, status_note from public.dm_pending");
      assert.equal(linha.status, "nao_enviada");
      assert.equal(linha.status_note, "A pessoa pediu para não receber mensagens.");

      const resultado = await drain.drainQueue(40, 20_000);
      assert.equal(resultado.sent, 1, "só a confirmação de saída");
      const envios = meta.calls.filter((call) => call.path.endsWith("/messages")).map((call) => (call.body.message as { text: string }).text);
      assert.deepEqual(envios, ["Pronto, você não vai mais receber mensagens."], "0 respostas do Molde; a confirmação saiu");

      const [visto] = await itens();
      assert.equal(visto.status, "nao_enviada");
      assert.equal(visto.nota, "A pessoa pediu para não receber mensagens.");
      assert.equal(visto.resposta, "Oi! O ebook custa R$ 29.");
    });

    test("'parar' só segura a resposta do Molde daquela pessoa: as de outras pessoas e as automações seguem", async () => {
      const a = await umaPendente("pessoa1", "oi");
      const b = await umaPendente("pessoa2", "olá");
      assert.equal((await POST(a.id, { acao: "enviar", texto: "Para a pessoa 1" })).status, 200);
      assert.equal((await POST(b.id, { acao: "enviar", texto: "Para a pessoa 2" })).status, 200);
      await dm("pessoa1", "parar");
      const fila = await db.sql<{ status: string; texto: string }>("select status, payload ->> 'text' as texto from public.queue order by created_at");
      assert.deepEqual(fila.map((f) => [f.texto, f.status]), [["Para a pessoa 1", "skipped"], ["Para a pessoa 2", "pending"]]);
      await drain.drainQueue(40, 20_000);
      const envios = meta.calls.filter((call) => call.path.endsWith("/messages")).map((call) => (call.body.message as { text: string }).text);
      assert.deepEqual(envios, ["Para a pessoa 2"]);
    });

    test("resposta que entrou na fila depois do 'parar' (no meio do caminho): o drain não manda e o item fecha com a frase", async () => {
      const pendente = await umaPendente();
      assert.equal((await POST(pendente.id, { acao: "enviar", texto: "Oi!" })).status, 200);
      // O opt-out chegou por outro caminho, sem passar pelo webhook (ou a fila aceitou a resposta logo depois do "parar").
      await db.sql("update public.contacts set opted_out_at = now() where instagram_user_id = 'pessoa1'");
      const resultado = await drain.drainQueue(40, 20_000);
      assert.equal(resultado.sent, 0);
      assert.equal(meta.count("/messages"), 0);
      const [fila] = await filaTudo();
      assert.equal(fila.status, "skipped");
      assert.equal(fila.last_error, "A pessoa pediu para não receber mensagens.");
      const [visto] = await itens();
      assert.equal(visto.status, "nao_enviada");
      assert.equal(visto.nota, "A pessoa pediu para não receber mensagens.");
    });

    test("contato marcado como 'não quer receber' por outro caminho: enviar recusa (409 com a frase) e o GET fecha o item", async () => {
      const a = await umaPendente("pessoa1", "oi");
      const b = await umaPendente("pessoa2", "olá");
      await db.sql("update public.contacts set opted_out_at = now() where instagram_user_id = 'pessoa1'");
      const recusa = await POST(a.id, { acao: "enviar", texto: "Oi!" });
      assert.equal(recusa.status, 409);
      assert.equal((await recusa.json()).error, "Esta pessoa pediu para não receber mensagens.");
      assert.equal((await db.sql<{ status: string }>("select status from public.dm_pending where id = $1", [a.id]))[0].status, "descartada");
      assert.equal((await filaTudo()).length, 0);

      await db.sql("update public.contacts set opted_out_at = now() where instagram_user_id = 'pessoa2'");
      const lista = await itens();
      assert.equal(lista.find((i) => i.id === b.id)?.status, "descartada", "o GET também fecha");
    });

    test("quem pediu para sair e manda outra mensagem: não entra na fila; depois de 'começar' volta a entrar", async () => {
      await dm("pessoa1", "parar");
      await dm("pessoa1", "mas e o preço?");
      assert.equal((await pendentes()).length, 0);
      await dm("pessoa1", "começar");
      await dm("pessoa1", "agora sim, e o preço?");
      assert.equal((await pendentes()).length, 1);
    });

    test("limpeza: apaga fechadas com mais de 90 dias (e aguardando paradas há 90), mantém o resto; 500 por rodada; a cada 6 h", async () => {
      const dms = await import("@/lib/db/dm-pending");
      await dm("pessoa1", "a");
      const [{ contact_id: contato, account_id: conta }] = await pendentes();
      await db.sql("delete from public.dm_pending");
      const linha = (status: string, dias: number, ultima = dias) => db.sql(
        `insert into public.dm_pending (account_id, contact_id, instagram_user_id, status, updated_at, last_message_at)
         values ($1, $2, 'x', $3, now() - make_interval(days => $4), now() - make_interval(days => $5))`,
        [conta, contato, status, dias, ultima],
      );
      // fechadas velhas (somem), fechadas recentes (ficam), na_fila velha (fica: ainda acompanha o envio), aguardando velha (some) e recente (fica)
      for (const status of ["enviada", "nao_enviada", "expirada", "descartada"]) { await linha(status, 91); await linha(status, 89); }
      await linha("na_fila", 200);
      await linha("aguardando", 5, 91);
      const antes = (await db.sql("select 1 from public.dm_pending")).length;
      assert.equal(antes, 10);

      dms.resetCleanupThrottle();
      assert.equal(await dms.cleanupOldPending(), 5, "4 fechadas velhas + 1 aguardando parada");
      const restam = await db.sql<{ status: string; dias: number }>("select status, round(extract(epoch from now() - updated_at) / 86400)::int as dias from public.dm_pending order by status, dias");
      assert.equal(restam.length, 5);
      assert.deepEqual(restam.map((r) => r.status).sort(), ["descartada", "enviada", "expirada", "na_fila", "nao_enviada"]);
      assert.ok(restam.filter((r) => r.status !== "na_fila").every((r) => r.dias === 89));

      // Não é a hora de novo: nada a fazer, mesmo havendo velhas.
      await linha("enviada", 120);
      assert.equal(await dms.cleanupOldPending(), 0);
      assert.equal(await dms.cleanupOldPending({ force: true }), 1);
    });

    test("o drain dispara a limpeza (e sem a tabela ou com erro ele não quebra)", async () => {
      const dms = await import("@/lib/db/dm-pending");
      await dm("pessoa1", "a");
      const [{ contact_id: contato, account_id: conta }] = await pendentes();
      await db.sql("delete from public.dm_pending");
      await db.sql("insert into public.dm_pending (account_id, contact_id, instagram_user_id, status, updated_at) values ($1, $2, 'x', 'enviada', now() - interval '100 days')", [conta, contato]);
      dms.resetCleanupThrottle();
      await drain.drainQueue(40, 20_000);
      assert.equal((await db.sql("select 1 from public.dm_pending")).length, 0);
    });

    test("limpeza em lotes de 500", async () => {
      const dms = await import("@/lib/db/dm-pending");
      await dm("pessoa1", "a");
      const [{ contact_id: contato, account_id: conta }] = await pendentes();
      await db.sql("delete from public.dm_pending");
      await db.sql(
        `insert into public.dm_pending (account_id, contact_id, instagram_user_id, status, updated_at)
         select $1, $2, 'x', 'descartada', now() - interval '120 days' from generate_series(1, 650)`,
        [conta, contato],
      );
      assert.equal(await dms.cleanupOldPending({ force: true }), 500);
      assert.equal(await dms.cleanupOldPending({ force: true }), 150);
    });
  });

  // ---------- GET ----------

  describe("GET /api/molde/dms", () => {
    test("devolve o item no formato do contrato, com a conversa recente e o prazo", async () => {
      // Conversa antiga: a pessoa escreveu, o perfil respondeu (enviado), e agora uma DM nova sem resposta.
      const contato = await repos.upsertContact({ accountId: contaA, instagramUserId: "pessoa1", instagramUsername: "user_pessoa1", markResponse: true });
      const evento = (texto: string, minutos: number) => db.sql(
        `insert into public.events (account_id, event_type, instagram_event_id, instagram_user_id, payload, received_at)
         values ($1, 'message', $2, 'pessoa1', $3, now() - make_interval(mins => $4))`,
        [contaA, `antigo-${minutos}`, JSON.stringify({ event: { message: { text: texto } } }), minutos],
      );
      await evento("olá, tudo bem?", 50);
      await db.sql(
        `insert into public.queue (account_id, contact_id, send_type, status, instagram_recipient_id, payload, attempts, sent_at)
         values ($1, $2, 'dm', 'sent', 'pessoa1', '{"text":"Tudo ótimo! Como posso ajudar?"}'::jsonb, 1, now() - interval '45 minutes')`,
        [contaA, contato],
      );
      await db.sql(
        `insert into public.queue (account_id, contact_id, send_type, status, instagram_recipient_id, payload, attempts, sent_at)
         values ($1, $2, 'dm', 'sent', 'pessoa1', '{"type":"media","mediaUrl":"https://x.invalid/a.jpg"}'::jsonb, 1, now() - interval '44 minutes')`,
        [contaA, contato],
      );
      await dm("pessoa1", "queria o valor do ebook");

      const lista = await itens();
      assert.equal(lista.length, 1);
      const [primeiro] = lista;
      assert.deepEqual(Object.keys(primeiro).sort(), ["accountId", "conversa", "id", "instagramUserId", "mensagens", "nota", "prazoAte", "resposta", "status", "ultimaEm", "username"]);
      assert.equal(primeiro.accountId, contaA);
      assert.equal(primeiro.username, "user_pessoa1");
      assert.equal(primeiro.instagramUserId, "pessoa1");
      assert.equal(primeiro.status, "aguardando");
      assert.equal(primeiro.resposta, null);
      assert.equal(primeiro.nota, null);
      assert.deepEqual(primeiro.mensagens.map((m) => m.texto), ["queria o valor do ebook"]);
      assert.deepEqual(Object.keys(primeiro.mensagens[0]).sort(), ["em", "texto"]);
      assert.deepEqual(primeiro.conversa.map((l) => [l.de, l.texto]), [
        ["pessoa", "olá, tudo bem?"],
        ["perfil", "Tudo ótimo! Como posso ajudar?"],
        ["pessoa", "queria o valor do ebook"],
      ]);
      assert.ok(primeiro.conversa.every((l) => Object.keys(l).sort().join() === "de,em,texto"));
      const emOrdem = primeiro.conversa.map((l) => l.em);
      assert.deepEqual([...emOrdem].sort(), emOrdem, "da mais antiga para a mais nova");

      const contatoRow = await contatoDe("pessoa1");
      const esperado = (contatoRow.last_response_at as Date).getTime() + 24 * HORA - 10 * 60_000;
      assert.equal(new Date(primeiro.prazoAte as string).getTime(), esperado, "prazoAte = última fala + 24 h - 10 min");
      assert.equal(primeiro.ultimaEm, new Date(primeiro.mensagens[0].em).toISOString());
    });

    test("a conversa tem no máximo as 6 últimas falas", async () => {
      for (let i = 1; i <= 8; i += 1) await dm("pessoa1", `fala ${i}`);
      const [primeiro] = await itens();
      assert.equal(primeiro.conversa.length, 6);
      assert.deepEqual(primeiro.conversa.map((l) => l.texto), ["fala 3", "fala 4", "fala 5", "fala 6", "fala 7", "fala 8"]);
    });

    test("só os aguardando e o que mudou nas últimas 48 h; filtra por perfil", async () => {
      await dm("pessoa1", "a");
      await dm("pessoa2", "b");
      await dm("pessoa3", "c");
      const [a, b, c] = (await pendentes()).map((l) => l.id);
      await db.sql("update public.dm_pending set status = 'descartada', updated_at = now() - interval '50 hours' where id = $1", [a]);
      await db.sql("update public.dm_pending set status = 'descartada', updated_at = now() - interval '47 hours' where id = $1", [b]);
      assert.deepEqual((await itens()).map((i) => i.id).sort(), [b, c].sort());

      await dm("outra_pessoa", "mensagem em outro perfil", {}, "1002");
      assert.equal((await itens()).length, 3);
      assert.equal((await itens(`?accountId=${contaB}`)).length, 1);
      assert.equal((await itens(`?accountId=${contaA}`)).length, 2);
    });

    test("sem token, 401; token errado, 401; accountId que não é id, 400", async () => {
      assert.equal((await GET("", {})).status, 401);
      assert.equal((await GET("", { "x-molde-token": "errado" })).status, 401);
      const ruim = await GET("?accountId=abc");
      assert.equal(ruim.status, 400);
      assert.equal((await ruim.json()).error, "accountId inválido.");
    });

    test("contato que passou de 24 h sem falar: o GET marca expirada com a frase", async () => {
      await dm("pessoa1", "oi");
      await dm("pessoa2", "olá");
      await db.sql("update public.contacts set last_response_at = now() - interval '25 hours' where instagram_user_id = 'pessoa1'");
      const lista = await itens();
      const velha = lista.find((i) => i.instagramUserId === "pessoa1") as Item;
      const nova = lista.find((i) => i.instagramUserId === "pessoa2") as Item;
      assert.equal(velha.status, "expirada");
      assert.equal(velha.nota, "Passou o prazo de 24 h do Instagram.");
      assert.equal(nova.status, "aguardando");
    });
  });

  // ---------- POST enviar / descartar ----------

  describe("POST /api/molde/dms/<id>", () => {
    test("enviar: entra um job dm na fila com origem molde_ia e o drain manda 1 mensagem com o texto exato", async () => {
      const pendente = await umaPendente();
      const texto = "Oi {{nome}}! Sou eu, {{first_name}} - {{ username }}. Segue o link: {{profile_url}}";
      const resposta = await POST(pendente.id, { acao: "enviar", texto });
      assert.equal(resposta.status, 200);
      const { data } = await resposta.json();
      assert.equal(data.id, pendente.id);
      assert.equal(data.status, "na_fila");
      assert.equal(data.resposta, texto);

      const [linha] = await db.sql<{ status: string; reply_text: string; queue_id: string }>("select * from public.dm_pending");
      assert.equal(linha.status, "na_fila");
      assert.equal(linha.reply_text, texto);
      const [job] = await filaDe(linha.queue_id);
      assert.equal(job.send_type, "dm");
      assert.equal(job.status, "pending");
      assert.equal(job.payload.origem, "molde_ia");
      assert.equal(job.payload.text, texto);
      assert.equal(job.instagram_recipient_id, "pessoa1");
      const [{ id: contatoId }] = [await contatoDe("pessoa1")];
      assert.equal(job.contact_id, contatoId);
      const [{ eventId }] = [(await pendentes())[0].messages.at(-1) as { eventId: string }];
      assert.equal(job.event_id, eventId, "o evento é o da última mensagem");
      assert.ok(Math.abs(job.available_at.getTime() - Date.now()) < 10_000);

      const resultado = await drain.drainQueue(40, 20_000);
      assert.equal(resultado.sent, 1);
      const envios = meta.calls.filter((call) => call.path.endsWith("/messages"));
      assert.equal(envios.length, 1);
      assert.deepEqual((envios[0].body.message as { text: string }).text, texto, "o texto sai exatamente como foi aprovado, {{marcações}} incluídas");
      assert.deepEqual(envios[0].body.recipient, { id: "pessoa1" });

      const [depois] = await itens();
      assert.equal(depois.status, "enviada");
      assert.equal(depois.nota, null);
      assert.equal(depois.resposta, texto);
    });

    test("as mensagens de automação continuam trocando as variáveis (só a resposta do Molde é literal)", async () => {
      const auto = await automacao({ name: "Boas-vindas", triggers: ["dm"], keywords: ["oi"], match_type: "contains", welcome_dm: "Olá {{first_name}}!" });
      await dm("pessoa1", "oi");
      assert.ok(auto.id);
      await drain.drainQueue(40, 20_000);
      const envios = meta.calls.filter((call) => call.path.endsWith("/messages"));
      assert.equal(envios.length, 1);
      assert.match((envios[0].body.message as { text: string }).text, /^Olá user_pessoa1!$/);
    });

    test("enviar não liga a pausa de atendimento humano", async () => {
      const pendente = await umaPendente();
      assert.equal((await POST(pendente.id, { acao: "enviar", texto: "Oi!" })).status, 200);
      await drain.drainQueue(40, 20_000);
      const contato = await contatoDe("pessoa1");
      assert.equal(contato.human_paused_at, null);
    });

    test("o 2º enviar do mesmo item: 409; e descartar depois de enviar: 409; só 1 job", async () => {
      const pendente = await umaPendente();
      assert.equal((await POST(pendente.id, { acao: "enviar", texto: "Primeira" })).status, 200);
      const segunda = await POST(pendente.id, { acao: "enviar", texto: "Segunda" });
      assert.equal(segunda.status, 409);
      assert.equal((await segunda.json()).error, "Esta mensagem já foi respondida ou descartada.");
      assert.equal((await POST(pendente.id, { acao: "descartar" })).status, 409);
      assert.equal((await filaTudo()).length, 1);
      const [linha] = await pendentes();
      assert.equal(linha.status, "na_fila");
    });

    test("dois enviar ao mesmo tempo: só um vai", async () => {
      const pendente = await umaPendente();
      const respostas = await Promise.all([
        POST(pendente.id, { acao: "enviar", texto: "A" }),
        POST(pendente.id, { acao: "enviar", texto: "B" }),
      ]);
      assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await filaTudo()).length, 1);
    });

    test("contato com a última fala de 25 h atrás: GET marca expirada e enviar dá 409", async () => {
      const pendente = await umaPendente();
      await db.sql("update public.contacts set last_response_at = now() - interval '25 hours'");
      const [depois] = await itens();
      assert.equal(depois.status, "expirada");
      const resposta = await POST(pendente.id, { acao: "enviar", texto: "Oi!" });
      assert.equal(resposta.status, 409);
      assert.equal((await resposta.json()).error, "Esta mensagem já foi respondida ou descartada.");
      assert.equal((await filaTudo()).length, 0);
    });

    test("prazo vencido e o GET ainda não passou: enviar marca expirada e dá 409 com a frase do prazo", async () => {
      const pendente = await umaPendente();
      await db.sql("update public.contacts set last_response_at = now() - interval '25 hours'");
      const resposta = await POST(pendente.id, { acao: "enviar", texto: "Oi!" });
      assert.equal(resposta.status, 409);
      assert.equal((await resposta.json()).error, "Passou o prazo de 24 h do Instagram para responder esta pessoa.");
      const [linha] = await pendentes();
      assert.equal(linha.status, "expirada");
      assert.equal((await filaTudo()).length, 0);
    });

    test("job pulado pela regra de 24 h antes de sair: o GET mostra nao_enviada com a frase", async () => {
      const pendente = await umaPendente();
      assert.equal((await POST(pendente.id, { acao: "enviar", texto: "Oi!" })).status, 200);
      // O tempo passa antes de o drain pegar o job.
      await db.sql("update public.contacts set last_response_at = now() - interval '25 hours'");
      await drain.drainQueue(40, 20_000);
      assert.equal(meta.count("/messages"), 0);
      const [fila] = await filaTudo();
      assert.equal(fila.status, "skipped");
      assert.equal(fila.last_error, "24h window expired");
      const [depois] = await itens();
      assert.equal(depois.status, "nao_enviada");
      assert.equal(depois.nota, "Passou o prazo de 24 h do Instagram.");
    });

    test("contato em atendimento manual: a resposta não sai e o GET diz por quê (e o POST já mostra)", async () => {
      const pendente = await umaPendente();
      await db.sql("update public.contacts set human_paused_at = now(), human_paused_until = now() + interval '12 hours'");
      const resposta = await POST(pendente.id, { acao: "enviar", texto: "Oi!" });
      assert.equal(resposta.status, 200);
      const { data } = await resposta.json();
      assert.equal(data.status, "nao_enviada");
      assert.equal(data.nota, "O contato está em atendimento manual.");
      await drain.drainQueue(40, 20_000);
      assert.equal(meta.count("/messages"), 0);
      assert.equal((await itens())[0].nota, "O contato está em atendimento manual.");
    });

    test("falha de envio mostra o último erro; depois de 3 tentativas fica nao_enviada", async () => {
      const pendente = await umaPendente();
      await POST(pendente.id, { acao: "enviar", texto: "Oi!" });
      const [{ queue_id: filaId }] = await db.sql<{ queue_id: string }>("select queue_id from public.dm_pending");
      await db.sql("update public.queue set status = 'failed', attempts = 3, last_error = 'Erro da Meta: tente mais tarde' where id = $1", [filaId]);
      const [depois] = await itens();
      assert.equal(depois.status, "nao_enviada");
      assert.equal(depois.nota, "Erro da Meta: tente mais tarde");
    });

    test("200 DMs na última hora: o job fica adiado (não falha) e o item segue na_fila com a nota do limite", async () => {
      const pendente = await umaPendente();
      await db.sql(
        `insert into public.queue (account_id, send_type, status, instagram_recipient_id, payload, attempts, sent_at)
         select $1::uuid, 'dm', 'sent', 'dest-' || g, '{"text":"oi"}'::jsonb, 1, now() - interval '10 minutes' + make_interval(secs => g)
         from generate_series(1, 200) g`,
        [contaA],
      );
      assert.equal((await POST(pendente.id, { acao: "enviar", texto: "Oi!" })).status, 200);
      const resultado = await drain.drainQueue(40, 20_000);
      assert.equal(resultado.failed, 0);
      assert.equal(resultado.deferred, 1);
      assert.equal(meta.count("/messages"), 0);

      const [{ queue_id: filaId }] = await db.sql<{ queue_id: string }>("select queue_id from public.dm_pending");
      const [job] = await filaDe(filaId);
      assert.equal(job.status, "pending");
      assert.equal(job.attempts, 0);
      assert.ok(job.available_at.getTime() > Date.now() + 30 * 60_000);
      const [depois] = await itens();
      assert.equal(depois.status, "na_fila");
      assert.match(depois.nota ?? "", /^Limite de 200 mensagens por hora deste perfil: sai às \d\d:\d\d\.$/);
    });

    test("descartar: o item vira descartada e some do 'aguardando'", async () => {
      const pendente = await umaPendente();
      const resposta = await POST(pendente.id, { acao: "descartar" });
      assert.equal(resposta.status, 200);
      assert.equal((await resposta.json()).data.status, "descartada");
      assert.equal((await filaTudo()).length, 0);
      assert.equal((await POST(pendente.id, { acao: "descartar" })).status, 409);
      await dm("pessoa1", "mais uma");
      assert.equal((await pendentes()).filter((l) => l.status === "aguardando").length, 1, "uma mensagem nova abre um item novo");
    });

    test("texto de 1 a 1000 letras; ação desconhecida; item que não existe", async () => {
      const pendente = await umaPendente();
      for (const texto of ["", "   ", undefined, 42, "x".repeat(1001)]) {
        const resposta = await POST(pendente.id, { acao: "enviar", texto });
        assert.equal(resposta.status, 400, String(texto).slice(0, 10));
        assert.equal((await resposta.json()).error, "A resposta precisa ter de 1 a 1000 letras.");
      }
      assert.equal((await POST(pendente.id, { acao: "enviar", texto: "x".repeat(1000) })).status, 200, "1000 pode");
      const emojis = await umaPendente("pessoa2", "olá");
      assert.equal((await POST(emojis.id, { acao: "enviar", texto: "😀".repeat(1000) })).status, 200, "conta letras, não bytes");

      assert.equal((await POST(pendente.id, { acao: "apagar" })).status, 400);
      assert.equal((await POST(pendente.id, {})).status, 400);
      assert.equal((await POST("00000000-0000-4000-8000-000000000000", { acao: "enviar", texto: "oi" })).status, 404);
      assert.equal((await POST("nao-e-id", { acao: "descartar" })).status, 404);
      assert.equal((await (await POST("nao-e-id", { acao: "descartar" })).json()).error, "Mensagem não encontrada.");
    });

    test("sem token, 401 e nada muda", async () => {
      const pendente = await umaPendente();
      assert.equal((await POST(pendente.id, { acao: "enviar", texto: "oi" }, {})).status, 401);
      assert.equal((await POST(pendente.id, { acao: "descartar" }, { "x-molde-token": "errado" })).status, 401);
      assert.equal((await pendentes())[0].status, "aguardando");
      assert.equal((await filaTudo()).length, 0);
    });
  });

  // ---------- banco ----------

  describe("a tabela", () => {
    test("segurança por linha ligada e nenhuma política; o índice garante 1 aguardando por contato", async () => {
      const [tabela] = await db.sql<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'dm_pending'");
      assert.equal(tabela.relrowsecurity, true);
      assert.equal((await db.sql("select 1 from pg_policies where tablename = 'dm_pending'")).length, 0);
      await dm("pessoa1", "oi");
      const [linha] = await pendentes();
      await assert.rejects(
        db.sql("insert into public.dm_pending (account_id, contact_id, instagram_user_id) values ($1, $2, 'pessoa1')", [linha.account_id, linha.contact_id]),
        /dm_pending_open_contact/,
      );
    });

    test("a 0006 colada 2 vezes não perde nada", async () => {
      await dm("pessoa1", "oi");
      const { readFileSync } = await import("node:fs");
      const sql = readFileSync("supabase/migrations/0006_fase5.sql", "utf8");
      await db.sql(sql);
      await db.sql(sql);
      assert.equal((await pendentes()).length, 1);
    });

    test("apagar o contato apaga o item; apagar o job só solta o queue_id", async () => {
      const pendente = await umaPendente();
      await POST(pendente.id, { acao: "enviar", texto: "Oi!" });
      await db.sql("delete from public.queue");
      assert.equal((await pendentes()).length, 1);
      assert.equal((await pendentes())[0].status, "na_fila");
      await db.sql("delete from public.contacts");
      assert.equal((await pendentes()).length, 0);
    });

    test("na_fila cujo job sumiu (e ficou mais de 2 minutos assim) vira nao_enviada com a frase", async () => {
      const pendente = await umaPendente();
      await POST(pendente.id, { acao: "enviar", texto: "Oi!" });
      await db.sql("delete from public.queue");
      assert.equal((await itens())[0].status, "na_fila", "ainda dentro dos 2 minutos: espera");
      await db.sql("update public.dm_pending set updated_at = now() - interval '3 minutes'");
      const [depois] = await itens();
      assert.equal(depois.status, "nao_enviada");
      assert.equal(depois.nota, "A resposta saiu da fila de envios sem ser enviada.");
    });
  });
});
