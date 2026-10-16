import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/**
 * Fase 9: fila de trabalho do Molde (/api/molde/jobs), aprovar pelo Telegram (webhook com botões assinados) e as partes
 * do relógio (Mac sumido, teto de gastos, relatório de domingo). Banco de teste com a 0008; Telegram falso.
 */
const meta = installFakeMeta();

const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const SEGREDO = "segredo-falso-do-webhook-do-telegram-0123";
const CHAT = "42";
const TG = { "x-telegram-bot-api-secret-token": SEGREDO };

type Job = {
  id: string; estado: string; tipo: string; ref: string; worker: string | null; tentativas: number; leaseAte: string | null;
  etapa: string | null; progresso: number; rodada: number; aprovacao: { decisao: string; via: string } | null; aprovacoes: unknown[];
  erro: string | null; custoEstimadoUsd: number; forcarCusto: boolean;
};

describe("Fase 9: fila do Molde, Telegram e relatório", { skip: semBanco }, () => {
  let db: TestDatabase;
  let jobsRoute: typeof import("@/app/api/molde/jobs/route");
  let claimRoute: typeof import("@/app/api/molde/jobs/claim/route");
  let jobRoute: typeof import("@/app/api/molde/jobs/[id]/route");
  let acaoRoute: typeof import("@/app/api/molde/jobs/[id]/[acao]/route");
  let webhookRoute: typeof import("@/app/api/telegram/webhook/route");
  let dmRoute: typeof import("@/app/api/molde/dms/[id]/route");
  let healthRoute: typeof import("@/app/api/health/route");
  let relogio: typeof import("@/lib/molde/relogio");
  let relatorio: typeof import("@/lib/relatorio-semanal");
  let callbackData: typeof import("@/lib/telegram/callback-data");
  let uploadRoute: typeof import("@/app/api/molde/upload/route");
  let conta: string;
  let toque = 0;

  before(async () => {
    db = await createTestDatabase();
    jobsRoute = await import("@/app/api/molde/jobs/route");
    claimRoute = await import("@/app/api/molde/jobs/claim/route");
    jobRoute = await import("@/app/api/molde/jobs/[id]/route");
    acaoRoute = await import("@/app/api/molde/jobs/[id]/[acao]/route");
    webhookRoute = await import("@/app/api/telegram/webhook/route");
    dmRoute = await import("@/app/api/molde/dms/[id]/route");
    healthRoute = await import("@/app/api/health/route");
    relogio = await import("@/lib/molde/relogio");
    relatorio = await import("@/lib/relatorio-semanal");
    callbackData = await import("@/lib/telegram/callback-data");
    uploadRoute = await import("@/app/api/molde/upload/route");
  });

  beforeEach(async () => {
    meta.reset();
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    process.env.TELEGRAM_CHAT_ID = CHAT;
    process.env.TELEGRAM_WEBHOOK_SECRET = SEGREDO;
    delete process.env.MOLDE_TETO_USD;
    for (const tabela of ["molde_jobs", "dm_pending", "contacts", "app_status", "content_posts", "instagram_accounts"]) await db.sql(`delete from public.${tabela}`);
    conta = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
  });

  after(async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.MOLDE_TETO_USD;
    meta.restore();
    await db?.close();
  });

  // ---------- ajudantes ----------

  const criar = (json: Record<string, unknown>, headers: Record<string, string> = MOLDE) =>
    jobsRoute.POST(request("/api/molde/jobs", { method: "POST", json, headers }));
  async function novo(json: Record<string, unknown> = {}) {
    const response = await criar({ projeto: "birdie", tipo: "reel_pipeline", ref: `ref-${Math.random()}`, titulo: "Vídeo da Birdie", ...json });
    assert.equal(response.status, 201);
    return (await response.json()).data as Job;
  }
  const claim = (worker = "Mac do Nicolas", tipos = ["reel_pipeline", "narrar"]) =>
    claimRoute.POST(request("/api/molde/jobs/claim", { method: "POST", json: { worker, tipos }, headers: MOLDE }));
  /** Código de posse do último claim de cada trabalho (o robô manda de volta nas 4 ações dele). */
  const posses = new Map<string, string>();
  async function pegar(worker = "Mac do Nicolas", tipos?: string[]) {
    const response = await claim(worker, tipos);
    assert.equal(response.status, 200);
    const corpo = (await response.json()) as { data: (Job & { posse?: string }) | null; aviso?: string; gastos: { gastoUsd: number; tetoUsd: number } };
    if (corpo.data?.posse) posses.set(corpo.data.id, corpo.data.posse);
    return corpo;
  }
  const ACOES_DO_ROBO = new Set(["batimento", "concluir", "erro", "aprovacao"]);
  /** Ação num trabalho; nas do robô, manda a posse do último claim (a não ser que o teste mande outra, ou `posse: undefined`). */
  const acao = (id: string, nome: string, json: Record<string, unknown> = {}) => {
    const corpo = ACOES_DO_ROBO.has(nome) && !("posse" in json) ? { posse: posses.get(id), ...json } : json;
    return acaoRoute.POST(request(`/api/molde/jobs/${id}/${nome}`, { method: "POST", json: corpo, headers: MOLDE }), routeParams({ id, acao: nome }));
  };
  const linha = async (id: string) => (await db.sql<Record<string, unknown>>("select * from public.molde_jobs where id = $1", [id]))[0];
  const relogioAgora = () => relogio.runMoldeClock({ deadline: Date.now() + 8000, origin: "https://uaiflow.teste", now: new Date("2026-10-14T15:00:00Z") });

  /** Um toque num botão do Telegram, como o Telegram manda ao webhook. */
  function tocar(data: string, opcoes: { chat?: string | number; headers?: Record<string, string>; messageId?: number; de?: number } = {}) {
    toque += 1;
    const update = {
      update_id: toque,
      callback_query: {
        id: `cb-${toque}`,
        from: { id: opcoes.de ?? 7, username: "nicolas" },
        data,
        message: { message_id: opcoes.messageId ?? 1, chat: { id: opcoes.chat ?? Number(CHAT) }, text: "UaiFlow: mensagem antiga" },
      },
    };
    return webhookRoute.POST(request("/api/telegram/webhook", { method: "POST", json: update, headers: opcoes.headers ?? TG }));
  }
  const botoes = (indice = -1) => {
    const mensagem = meta.telegram.at(indice)?.body as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } };
    return mensagem?.reply_markup?.inline_keyboard?.[0] ?? [];
  };
  const chamadas = (metodo: string) => meta.telegramApi.filter((chamada) => chamada.method === metodo);

  // ---------- criar, listar, ler ----------

  describe("criar e listar", () => {
    test("sem o x-molde-token: 401; com ele: 201, e a mesma ref devolve o mesmo trabalho (200, criado: false)", async () => {
      assert.equal((await criar({ tipo: "reel_pipeline", ref: "a" }, {})).status, 401);
      const primeira = await criar({ projeto: "birdie", tipo: "reel_pipeline", ref: "cena-1", accountId: conta, payload: { roteiro: "oi" } });
      assert.equal(primeira.status, 201);
      const job = (await primeira.json()).data as Job & { username: string; payload: Record<string, unknown> };
      assert.equal(job.estado, "na_fila");
      assert.equal(job.username, "conta_a");
      assert.deepEqual(job.payload, { roteiro: "oi" });
      const segunda = await criar({ projeto: "birdie", tipo: "reel_pipeline", ref: "cena-1", payload: { roteiro: "outro" } });
      assert.equal(segunda.status, 200);
      const repetido = await segunda.json();
      assert.equal(repetido.criado, false);
      assert.equal(repetido.data.id, job.id);
      assert.deepEqual(repetido.data.payload, { roteiro: "oi" });
      // Outro tipo com a mesma ref é outro trabalho.
      assert.equal((await criar({ projeto: "birdie", tipo: "narrar", ref: "cena-1" })).status, 201);
      assert.equal((await db.sql("select 1 from public.molde_jobs")).length, 2);
    });

    test("validação: tipo, ref, accountId e forcarCusto sem a frase de confirmação: 400 em português", async () => {
      assert.equal((await criar({ tipo: "Reel Pipeline", ref: "a" })).status, 400);
      assert.equal((await criar({ tipo: "reel_pipeline" })).status, 400);
      assert.equal((await criar({ tipo: "reel_pipeline", ref: "a", accountId: "nao-e-uuid" })).status, 400);
      const sem = await criar({ tipo: "reel_pipeline", ref: "a", forcarCusto: true });
      assert.equal(sem.status, 400);
      assert.match((await sem.json()).error, /passar do teto/);
      assert.equal((await criar({ tipo: "reel_pipeline", ref: "a", forcarCusto: true, confirmo: "passar do teto" })).status, 201);
    });

    test("listar por projeto e estado; ler um; estado inválido: 400", async () => {
      const a = await novo({ projeto: "birdie" });
      await novo({ projeto: "outro" });
      const response = await jobsRoute.GET(request("/api/molde/jobs?projeto=birdie&estado=na_fila,rodando", { headers: MOLDE }));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.data.map((job: Job) => job.id), [a.id]);
      assert.equal(body.gastos.tetoUsd, 50);
      assert.equal((await jobsRoute.GET(request("/api/molde/jobs?estado=feito", { headers: MOLDE }))).status, 400);
      const um = await jobRoute.GET(request(`/api/molde/jobs/${a.id}`, { headers: MOLDE }), routeParams({ id: a.id }));
      assert.equal((await um.json()).data.id, a.id);
      const id = "00000000-0000-4000-8000-000000000000";
      assert.equal((await jobRoute.GET(request(`/api/molde/jobs/${id}`, { headers: MOLDE }), routeParams({ id }))).status, 404);
    });
  });

  // ---------- pegar o próximo ----------

  describe("pegar o próximo (claim)", () => {
    test("só tipos que o Mac sabe fazer, o de maior prioridade primeiro; fica rodando com lease de 10 min; o Mac acordado vai ao /api/health", async () => {
      const narrar = await novo({ tipo: "narrar" });
      const reelBaixo = await novo({ prioridade: 0 });
      const reelAlto = await novo({ prioridade: 5 });
      const primeiro = await pegar("Mac A", ["reel_pipeline"]);
      assert.equal(primeiro.data?.id, reelAlto.id);
      assert.equal(primeiro.data?.estado, "rodando");
      assert.equal(primeiro.data?.worker, "Mac A");
      assert.equal(primeiro.data?.tentativas, 1);
      const lease = new Date(primeiro.data?.leaseAte as string).getTime() - Date.now();
      assert.ok(lease > 9 * 60_000 && lease <= 10 * 60_000, `lease = ${lease}`);
      assert.equal((await pegar("Mac A", ["reel_pipeline"])).data?.id, reelBaixo.id);
      assert.equal((await pegar("Mac A", ["reel_pipeline"])).data, null, "o narrar não sai para quem só sabe reel_pipeline");
      assert.equal((await pegar("Mac B", ["narrar"])).data?.id, narrar.id);

      await db.sql("insert into public.app_status (chave, atualizado_em) values ('relogio', now()) on conflict (chave) do update set atualizado_em = now()");
      const saude = await (await healthRoute.GET()).json();
      assert.equal(saude.mac.minutos, 0);
      assert.doesNotMatch(JSON.stringify(saude), /Mac A|Mac B/);
    });

    test("tipos e worker obrigatórios: 400", async () => {
      assert.equal((await claimRoute.POST(request("/api/molde/jobs/claim", { method: "POST", json: { tipos: ["reel_pipeline"] }, headers: MOLDE }))).status, 400);
      assert.equal((await claim("Mac", [])).status, 400);
      assert.equal((await claim("Mac", ["Reel!"])).status, 400);
    });

    test("for update skip locked: um trabalho travado por outra transação é pulado; 8 pedidos ao mesmo tempo nunca pegam o mesmo", async () => {
      const travado = await novo({ prioridade: 10 });
      const livre = await novo();
      const outro = new pg.Client({ connectionString: db.url });
      await outro.connect();
      try {
        await outro.query("begin");
        await outro.query("select id from public.molde_jobs where id = $1 for update", [travado.id]);
        assert.equal((await pegar()).data?.id, livre.id);
        await outro.query("rollback");
      } finally {
        await outro.end();
      }

      await db.sql("delete from public.molde_jobs");
      const criados = await Promise.all(Array.from({ length: 5 }, () => novo()));
      const resultados = await Promise.all(Array.from({ length: 8 }, (_, i) => pegar(`Mac ${i}`)));
      const pegos = resultados.map((r) => r.data?.id).filter(Boolean);
      assert.equal(pegos.length, 5);
      assert.equal(new Set(pegos).size, 5);
      assert.deepEqual([...pegos].sort(), criados.map((job) => job.id).sort());
    });
  });

  // ---------- batimento, concluir, erro, cancelar ----------

  describe("o robô trabalhando", () => {
    test("batimento renova o lease e grava etapa/progresso; outro Mac: 409; concluir: pronto com o resultado", async () => {
      const job = await novo();
      await pegar("Mac A");
      await db.sql("update public.molde_jobs set lease_until = now() + interval '1 minute' where id = $1", [job.id]);
      const bate = await acao(job.id, "batimento", { worker: "Mac A", etapa: "Gerando a voz", progresso: 40 });
      assert.equal(bate.status, 200);
      const depois = (await bate.json()).data as Job;
      assert.equal(depois.etapa, "Gerando a voz");
      assert.equal(depois.progresso, 40);
      assert.ok(new Date(depois.leaseAte as string).getTime() - Date.now() > 9 * 60_000);
      const intruso = await acao(job.id, "batimento", { worker: "Mac B" });
      assert.equal(intruso.status, 409);
      assert.equal((await acao(job.id, "batimento", { worker: "Mac A", progresso: 120 })).status, 400);
      const fim = await acao(job.id, "concluir", { worker: "Mac A", resultado: { video: "https://midia.teste.invalid/a.mp4" } });
      assert.equal(fim.status, 200);
      const pronto = (await fim.json()).data as Job & { resultado: Record<string, unknown> };
      assert.equal(pronto.estado, "pronto");
      assert.equal(pronto.progresso, 100);
      assert.deepEqual(pronto.resultado, { video: "https://midia.teste.invalid/a.mp4" });
    });

    test("erro com tentarDeNovo volta para a fila (até 3 tentativas); sem ele vira erro; repetir zera", async () => {
      const job = await novo();
      for (let i = 1; i <= 2; i += 1) {
        await pegar();
        const r = await acao(job.id, "erro", { worker: "Mac do Nicolas", erro: "Sem internet.", tentarDeNovo: true });
        assert.equal((await r.json()).data.estado, "na_fila", `tentativa ${i}`);
      }
      await pegar();
      const terceira = await (await acao(job.id, "erro", { worker: "Mac do Nicolas", erro: "Sem internet.", tentarDeNovo: true })).json();
      assert.equal(terceira.data.estado, "erro");
      assert.equal(terceira.data.erro, "Sem internet.");
      const repetir = await (await acao(job.id, "repetir")).json();
      assert.equal(repetir.data.estado, "na_fila");
      assert.equal(repetir.data.tentativas, 0);
    });

    test("cancelar um trabalho rodando: o próximo batimento do robô recebe 409 com estado cancelado", async () => {
      const job = await novo();
      await pegar();
      assert.equal((await acao(job.id, "cancelar")).status, 200);
      const bate = await acao(job.id, "batimento", { worker: "Mac do Nicolas" });
      assert.equal(bate.status, 409);
      assert.equal((await bate.json()).estado, "cancelado");
      assert.equal((await acao(job.id, "cancelar")).status, 200, "cancelar de novo não é erro");
      assert.equal((await acao(job.id, "inventada")).status, 404);
    });
  });

  // ---------- relógio: lease vencido e Mac desligado ----------

  describe("relógio do Molde", () => {
    test("lease vencido volta para a fila; na 3ª vez vira erro com 1 aviso no Telegram", async () => {
      const job = await novo({ titulo: "Reel do pássaro" });
      for (let i = 1; i <= 3; i += 1) {
        assert.equal((await pegar()).data?.id, job.id, `pega ${i}`);
        await db.sql("update public.molde_jobs set lease_until = now() - interval '1 second' where id = $1", [job.id]);
        const resultado = await relogioAgora();
        if (i < 3) {
          assert.equal(resultado.devolvidos, 1);
          assert.equal((await linha(job.id)).estado, "na_fila");
          assert.equal((await linha(job.id)).worker, null);
        } else {
          assert.equal(resultado.erros, 1);
        }
      }
      const final = await linha(job.id);
      assert.equal(final.estado, "erro");
      assert.match(String(final.erro), /3 vezes/);
      const avisos = meta.telegram.filter((m) => String(m.body.text).includes("deu erro"));
      assert.equal(avisos.length, 1);
      assert.match(String(avisos[0].body.text), /Reel do pássaro/);
      await relogioAgora();
      assert.equal(meta.telegram.filter((m) => String(m.body.text).includes("deu erro")).length, 1, "o aviso não repete");
    });

    test("trabalho aprovado que perde o Mac volta para 'aprovado' (não recomeça do zero)", async () => {
      const job = await novo();
      await pegar();
      await acao(job.id, "aprovacao", { worker: "Mac do Nicolas", previa: { texto: "ok" } });
      await acao(job.id, "decidir", { decisao: "aprovar" });
      assert.equal((await pegar()).data?.id, job.id);
      await db.sql("update public.molde_jobs set lease_until = now() - interval '1 second' where id = $1", [job.id]);
      await relogioAgora();
      assert.equal((await linha(job.id)).estado, "aprovado");
    });

    test("nenhum Mac há mais de 30 min com trabalho esperando: 1 aviso «O Mac parece desligado»", async () => {
      await novo();
      await novo();
      await db.sql("update public.molde_jobs set atualizado_em = now() - interval '40 minutes'");
      await db.sql("insert into public.app_status (chave, valor, atualizado_em) values ('molde_mac', '{}'::jsonb, now() - interval '45 minutes')");
      await relogioAgora();
      const avisos = meta.telegram.filter((m) => String(m.body.text).includes("parece desligado"));
      assert.equal(avisos.length, 1);
      assert.match(String(avisos[0].body.text), /2 coisas esperando/);
      await relogioAgora();
      assert.equal(meta.telegram.filter((m) => String(m.body.text).includes("parece desligado")).length, 1, "não repete a cada minuto");
    });

    test("Mac pediu trabalho há pouco: nenhum aviso", async () => {
      await novo();
      await db.sql("update public.molde_jobs set atualizado_em = now() - interval '40 minutes'");
      await pegar("Mac", ["outro_tipo"]);
      await relogioAgora();
      assert.equal(meta.telegram.filter((m) => String(m.body.text).includes("parece desligado")).length, 0);
    });
  });

  // ---------- teto de gastos ----------

  describe("teto de gastos do mês", () => {
    test("passou do teto: o claim não entrega trabalho que custa, avisa 1 vez no Telegram; o de custo 0 sai; forcar libera", async () => {
      process.env.MOLDE_TETO_USD = "1";
      const caro1 = await novo({ custoEstimadoUsd: 0.8, prioridade: 10 });
      assert.equal((await pegar()).data?.id, caro1.id);
      const caro2 = await novo({ custoEstimadoUsd: 0.5, prioridade: 5 });
      const barrado = await pegar();
      assert.equal(barrado.data, null);
      assert.match(String(barrado.aviso), /teto/i);
      assert.equal(barrado.gastos.gastoUsd, 0.8);
      assert.equal(barrado.gastos.tetoUsd, 1);
      await pegar();
      assert.equal(meta.telegram.filter((m) => /Teto de gastos/.test(String(m.body.text))).length, 1, "1 aviso só no mês");

      const gratis = await novo({ custoEstimadoUsd: 0 });
      assert.equal((await pegar()).data?.id, gratis.id);

      assert.equal((await acao(caro2.id, "forcar", {})).status, 400);
      assert.equal((await acao(caro2.id, "forcar", { confirmo: "passar do teto" })).status, 200);
      const liberado = await pegar();
      assert.equal(liberado.data?.id, caro2.id);
      assert.equal(liberado.data?.forcarCusto, true);
    });

    test("o gasto que conta é o do mês (horário de São Paulo): trabalho do mês passado não conta", async () => {
      process.env.MOLDE_TETO_USD = "1";
      const velho = await novo({ custoEstimadoUsd: 0.9 });
      await db.sql("update public.molde_jobs set iniciado_em = now() - interval '40 days', estado = 'pronto' where id = $1", [velho.id]);
      const novoJob = await novo({ custoEstimadoUsd: 0.9 });
      assert.equal((await pegar()).data?.id, novoJob.id);
    });
  });

  // ---------- aprovar pelo Telegram ----------

  describe("aprovar pelo Telegram", () => {
    async function esperando() {
      const job = await novo({ titulo: "Birdie no lago" });
      await pegar();
      const r = await acao(job.id, "aprovacao", { worker: "Mac do Nicolas", previa: { texto: "Ficou lindo", video: "https://midia.teste.invalid/previa.mp4" } });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).telegram, true);
      return job;
    }

    test("pedir aprovação: mensagem com «Aprovar» / «Refazer», o link da prévia e callback_data curto e assinado", async () => {
      const job = await esperando();
      assert.equal((await linha(job.id)).estado, "esperando_aprovacao");
      const mensagem = meta.telegram.at(-1)?.body as Record<string, unknown>;
      assert.equal(String(mensagem.chat_id), CHAT);
      assert.match(String(mensagem.text), /«Birdie no lago» ficou pronto/);
      assert.match(String(mensagem.text), /https:\/\/midia\.teste\.invalid\/previa\.mp4/);
      const [aprovar, refazer] = botoes();
      assert.deepEqual([aprovar.text, refazer.text], ["Aprovar", "Refazer"]);
      for (const botao of [aprovar, refazer]) assert.ok(Buffer.byteLength(botao.callback_data) <= 64);
      assert.deepEqual(callbackData.verifyCallback(aprovar.callback_data), { kind: "j", action: "a", id: job.id, version: 1 });
      assert.equal(Number((await linha(job.id)).telegram_msg_id), meta.telegram.length);
    });

    test("toque em «Aprovar»: aprovado, responde o toque e edita a mensagem; dois toques = uma ação", async () => {
      const job = await esperando();
      const [aprovar] = botoes();
      const primeira = await tocar(aprovar.callback_data);
      assert.equal(primeira.status, 200);
      assert.equal((await primeira.json()).acao, "aprovar");
      const depois = await linha(job.id);
      assert.equal(depois.estado, "aprovado");
      assert.deepEqual((depois.aprovacao as Record<string, unknown>).via, "telegram");
      assert.equal(chamadas("answerCallbackQuery").length, 1);
      assert.match(String(chamadas("editMessageText")[0].body.text), /Aprovado às \d{2}:\d{2} \(pelo Telegram\)/);

      const segunda = await tocar(aprovar.callback_data);
      assert.equal((await segunda.json()).acao, "repetido");
      const [refazer] = botoes().slice(1);
      await tocar(refazer.callback_data);
      const final = await linha(job.id);
      assert.equal(final.estado, "aprovado");
      assert.equal((final.aprovacoes as unknown[]).length, 1);
      assert.match(String(chamadas("answerCallbackQuery").at(-1)?.body.text), /Já estava decidido/);
    });

    test("«Refazer» devolve o trabalho para o robô; o botão da prévia antiga não aprova a nova", async () => {
      const job = await esperando();
      const [aprovarV1, refazerV1] = botoes();
      await tocar(refazerV1.callback_data);
      assert.equal((await linha(job.id)).estado, "recusado");
      assert.equal((await pegar()).data?.id, job.id);
      await acao(job.id, "aprovacao", { worker: "Mac do Nicolas", previa: { texto: "Versão 2" } });
      const antigo = await (await tocar(aprovarV1.callback_data)).json();
      assert.equal(antigo.acao, "antigo");
      assert.equal((await linha(job.id)).estado, "esperando_aprovacao");
      const [aprovarV2] = botoes();
      assert.equal((await (await tocar(aprovarV2.callback_data)).json()).acao, "aprovar");
    });

    test("decidir pela página edita a mensagem do Telegram; depois o toque no Telegram não muda nada", async () => {
      const job = await esperando();
      const pagina = await acao(job.id, "decidir", { decisao: "refazer", nota: "Mais curto" });
      assert.equal(pagina.status, 200);
      assert.match(String(chamadas("editMessageText").at(-1)?.body.text), /Pedido para refazer às .* \(pela página\)/);
      const [aprovar] = botoes();
      await tocar(aprovar.callback_data);
      assert.equal((await linha(job.id)).estado, "recusado");
      assert.equal((await acao(job.id, "decidir", { decisao: "aprovar" })).status, 409);
    });

    test("callback_data forjado ou estragado: «Este botão não vale mais» e nada muda", async () => {
      const job = await esperando();
      const [aprovar] = botoes();
      const partes = aprovar.callback_data.split(".");
      const forjados = [
        [...partes.slice(0, 4), "AAAAAAAAAAAAAAAA"].join("."),
        ["j", "r", ...partes.slice(2)].join("."), // trocar a ação sem refazer a assinatura
        "j.a.qualquer.1.xxx",
        "",
      ];
      for (const data of forjados) {
        const resposta = await (await tocar(data)).json();
        assert.equal(resposta.acao, "invalido", data);
      }
      assert.equal((await linha(job.id)).estado, "esperando_aprovacao");
      process.env.TELEGRAM_WEBHOOK_SECRET = "outro-segredo-do-webhook-0123456789";
      assert.equal(callbackData.verifyCallback(aprovar.callback_data), null, "com outra chave a assinatura não confere");
    });

    test("webhook: sem o cabeçalho certo 401; sem o segredo configurado 503; outra conversa é recusada", async () => {
      const job = await esperando();
      const [aprovar] = botoes();
      assert.equal((await tocar(aprovar.callback_data, { headers: {} })).status, 401);
      assert.equal((await tocar(aprovar.callback_data, { headers: { "x-telegram-bot-api-secret-token": `${SEGREDO}x` } })).status, 401);
      const outraConversa = await tocar(aprovar.callback_data, { chat: 999 });
      assert.equal(outraConversa.status, 200);
      assert.equal((await outraConversa.json()).ignorado, true);
      assert.match(String(chamadas("answerCallbackQuery").at(-1)?.body.text), /não pode aprovar/);
      assert.equal((await linha(job.id)).estado, "esperando_aprovacao");
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      assert.equal((await tocar(aprovar.callback_data)).status, 503);
    });

    test("Revisão F9 · TELEGRAM_ALLOWED_USER_IDS: só essas pessoas decidem; vazia, vale qualquer uma da conversa", async (t) => {
      t.after(() => { delete process.env.TELEGRAM_ALLOWED_USER_IDS; });
      const job = await esperando();
      const [aprovar] = botoes();
      process.env.TELEGRAM_ALLOWED_USER_IDS = "42, 1001";
      const intruso = await tocar(aprovar.callback_data, { de: 7 });
      assert.equal((await intruso.json()).ignorado, true);
      assert.match(String(chamadas("answerCallbackQuery").at(-1)?.body.text), /Você não pode decidir/);
      assert.equal((await linha(job.id)).estado, "esperando_aprovacao");
      assert.equal((await (await tocar(aprovar.callback_data, { de: 1001 })).json()).ignorado, undefined);
      assert.equal((await linha(job.id)).estado, "aprovado");
      await acao(job.id, "cancelar"); // senão o próximo claim pega este (aprovado) primeiro

      const outro = await esperando();
      const [aprovarOutro] = botoes();
      process.env.TELEGRAM_ALLOWED_USER_IDS = " ";
      await tocar(aprovarOutro.callback_data, { de: 7 });
      assert.equal((await linha(outro.id)).estado, "aprovado", "vazia: como antes");
    });

    test("o webhook compara o segredo em tempo constante (safeEqualSecret) e a assinatura com timingSafeEqual", () => {
      const rota = readFileSync("src/app/api/telegram/webhook/route.ts", "utf8");
      assert.match(rota, /safeEqualSecret\(request\.headers\.get\("x-telegram-bot-api-secret-token"\)/);
      assert.doesNotMatch(rota, /===\s*expected|expected\s*===/);
      assert.match(readFileSync("src/lib/telegram/callback-data.ts", "utf8"), /timingSafeEqual\(provided, expected\)/);
    });

    test("sem TELEGRAM_WEBHOOK_SECRET: a mensagem sai sem botões e manda aprovar pela página", async () => {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      await esperando();
      assert.equal(botoes().length, 0);
      assert.match(String(meta.telegram.at(-1)?.body.text), /Aprove pela página do Molde/);
    });

    test("Telegram fora do ar na hora: o relógio manda a mensagem de aprovação depois", async () => {
      meta.telegramFails = "rede";
      const job = await novo();
      await pegar();
      const r = await acao(job.id, "aprovacao", { worker: "Mac do Nicolas", previa: { texto: "Prévia" } });
      assert.equal((await r.json()).telegram, false);
      meta.telegramFails = null;
      await db.sql("update public.molde_jobs set atualizado_em = now() - interval '2 minutes', telegram_aviso_em = now() - interval '11 minutes' where id = $1", [job.id]);
      const resultado = await relogioAgora();
      assert.equal(resultado.avisos, 1);
      assert.equal(botoes().length, 2);
      assert.ok((await linha(job.id)).telegram_msg_id);
    });
  });

  // ---------- «Mandar» / «Não mandar» da DM ----------

  describe("resposta de DM pelo Telegram", () => {
    async function conversa() {
      const [contato] = await db.sql<{ id: string }>(
        "insert into public.contacts (account_id, instagram_user_id, instagram_username, last_response_at) values ($1, 'pessoa1', 'maria', now() - interval '1 hour') returning id",
        [conta],
      );
      const [dm] = await db.sql<{ id: string }>(
        `insert into public.dm_pending (account_id, contact_id, instagram_user_id, username, messages)
         values ($1, $2, 'pessoa1', 'maria', $3::jsonb) returning id`,
        [conta, contato.id, JSON.stringify([{ texto: "Quanto custa?", em: new Date().toISOString(), eventId: null }])],
      );
      return dm.id;
    }
    const preparar = (id: string, texto: string) => dmRoute.POST(request(`/api/molde/dms/${id}`, { method: "POST", json: { acao: "preparar", texto }, headers: MOLDE }), routeParams({ id }));

    test("preparar: pergunta «Mandar» / «Não mandar»; «Mandar» põe a resposta na fila 1 vez só", async () => {
      const id = await conversa();
      const r = await preparar(id, "Custa R$ 10!");
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.equal(body.telegram, true);
      assert.equal(body.data.rascunho, "Custa R$ 10!");
      assert.match(String(meta.telegram.at(-1)?.body.text), /Quanto custa\?[\s\S]*Custa R\$ 10!/);
      const [mandar, naoMandar] = botoes();
      assert.deepEqual([mandar.text, naoMandar.text], ["Mandar", "Não mandar"]);
      assert.equal((await (await tocar(mandar.callback_data)).json()).acao, "mandar");
      await tocar(mandar.callback_data);
      const fila = await db.sql<{ payload: { text: string } }>("select payload from public.queue");
      assert.equal(fila.length, 1);
      assert.equal(fila[0].payload.text, "Custa R$ 10!");
      assert.match(String(chamadas("editMessageText")[0].body.text), /Mandada às/);
    });

    test("«Não mandar» tira o rascunho; o botão de um rascunho antigo não manda o novo", async () => {
      const id = await conversa();
      await preparar(id, "Primeira versão");
      const [mandarV1, naoMandarV1] = botoes();
      assert.equal((await (await tocar(naoMandarV1.callback_data)).json()).acao, "nao_mandar");
      assert.equal((await db.sql("select draft_text from public.dm_pending where id = $1", [id]))[0].draft_text, null);
      await preparar(id, "Segunda versão");
      assert.equal((await (await tocar(mandarV1.callback_data)).json()).acao, "antigo");
      assert.equal((await db.sql("select 1 from public.queue")).length, 0);
    });
  });

  // ---------- relatório de domingo ----------

  describe("relatório de domingo", () => {
    // 2026-10-18 é domingo. 12:00 UTC = 9:00 em São Paulo (UTC-3).
    const DOMINGO_9H = new Date("2026-10-18T12:00:00Z");

    test("1 vez por domingo, a partir das 9h de São Paulo; antes das 9h e no sábado não sai", async () => {
      const prazo = () => Date.now() + 8000;
      assert.equal((await relatorio.maybeSendWeeklyReport({ now: new Date("2026-10-18T11:59:00Z"), deadline: prazo() })).motivo, "fora_da_hora");
      assert.equal((await relatorio.maybeSendWeeklyReport({ now: new Date("2026-10-17T15:00:00Z"), deadline: prazo() })).motivo, "fora_da_hora");
      // Domingo 01:00 UTC ainda é sábado 22h em São Paulo.
      assert.equal((await relatorio.maybeSendWeeklyReport({ now: new Date("2026-10-18T01:00:00Z"), deadline: prazo() })).motivo, "fora_da_hora");
      assert.deepEqual(await relatorio.maybeSendWeeklyReport({ now: DOMINGO_9H, deadline: prazo() }), { sent: true });
      assert.equal((await relatorio.maybeSendWeeklyReport({ now: new Date("2026-10-18T20:00:00Z"), deadline: prazo() })).motivo, "ja_enviado");
      // Segunda 02:00 UTC ainda é domingo 23h em São Paulo: continua o mesmo domingo.
      assert.equal((await relatorio.maybeSendWeeklyReport({ now: new Date("2026-10-19T02:00:00Z"), deadline: prazo() })).motivo, "ja_enviado");
      assert.deepEqual(await relatorio.maybeSendWeeklyReport({ now: new Date("2026-10-25T12:30:00Z"), deadline: prazo() }), { sent: true });
      assert.equal(meta.telegram.length, 2);
    });

    test("Revisão F9 · falta de tempo depois da reserva não gasta tentativa; Telegram falhando desfaz a reserva; enviado fica gravado antes", async (t) => {
      const estado = async () => (await db.sql<{ valor: Record<string, unknown> }>("select valor from public.app_status where chave = 'relatorio_semanal'"))[0]?.valor;
      // Relógio sem tempo depois de reservar: Date.now anda 1 s entre a primeira conferência e a hora de mandar.
      const T = Date.now();
      let chamadas = 0;
      const agora = t.mock.method(Date, "now", () => (chamadas++ === 0 ? T : T + 1000));
      const semTempo = await relatorio.maybeSendWeeklyReport({ now: DOMINGO_9H, deadline: T + 1600 });
      agora.mock.restore();
      assert.equal(semTempo.motivo, "sem_tempo");
      assert.equal(meta.telegram.length, 0);
      assert.deepEqual([(await estado())?.enviado, (await estado())?.tentativas], [false, 0]);
      // Telegram fora do ar: desfaz (enviado false, 1 tentativa gasta) e espera os 10 min
      meta.telegramFails = { status: 500, description: "Internal" };
      assert.equal((await relatorio.maybeSendWeeklyReport({ now: DOMINGO_9H, deadline: Date.now() + 8000 })).motivo, "erro");
      assert.deepEqual([(await estado())?.enviado, (await estado())?.tentativas], [false, 1]);
      meta.telegramFails = null;
      assert.equal((await relatorio.maybeSendWeeklyReport({ now: DOMINGO_9H, deadline: Date.now() + 8000 })).motivo, "ja_enviado", "espera 10 min");
      await db.sql("update public.app_status set atualizado_em = now() - interval '11 minutes' where chave = 'relatorio_semanal'");
      assert.deepEqual(await relatorio.maybeSendWeeklyReport({ now: DOMINGO_9H, deadline: Date.now() + 8000 }), { sent: true });
      assert.equal((await estado())?.enviado, true);
      assert.ok((await estado())?.enviadoEm);
      // Mesmo que a reserva fique "parada" (ex.: o banco caiu depois de mandar), ela já diz enviado: não manda de novo.
      await db.sql("update public.app_status set valor = valor - 'enviadoEm', atualizado_em = now() - interval '1 hour' where chave = 'relatorio_semanal'");
      assert.equal((await relatorio.maybeSendWeeklyReport({ now: DOMINGO_9H, deadline: Date.now() + 8000 })).motivo, "ja_enviado");
      assert.equal(meta.telegram.length, 1);
    });

    test("o texto: posts da semana, o mais visto, posts com erro e os gastos do Molde contra o teto", async () => {
      process.env.MOLDE_TETO_USD = "20";
      const columns = "account_id, publish_type, caption, media_url, status, published_at, insights, title";
      await db.sql(
        `insert into public.content_posts (${columns}) values
         ($1, 'reel_video', 'Legenda A', 'https://midia.teste.invalid/a.mp4', 'published', now() - interval '1 day', '{"views": 1500}'::jsonb, 'Reel campeão'),
         ($1, 'reel_video', 'Legenda B', 'https://midia.teste.invalid/b.mp4', 'published', now() - interval '2 days', '{"views": 300}'::jsonb, 'Reel fraco'),
         ($1, 'reel_video', 'Legenda C', 'https://midia.teste.invalid/c.mp4', 'failed', null, '{}'::jsonb, 'Reel com erro')`,
        [conta],
      );
      const job = await novo({ custoEstimadoUsd: 5 });
      await pegar();
      assert.ok(job);
      const dados = await relatorio.collectWeeklyStats();
      const texto = relatorio.weeklyReportText(dados, DOMINGO_9H, "https://uaiflow.teste");
      assert.match(texto, /@conta_a/);
      assert.match(texto, /2 posts publicados/);
      assert.match(texto, /Reel campeão/);
      assert.match(texto, /1\.500 visualizações/);
      assert.match(texto, /1 post com erro/);
      assert.match(texto, /Gastos do Molde em outubro: US\$ 5,00 de US\$ 20,00 \(25%\)/);
      assert.match(texto, /Nenhum clique nos seus links/);
    });

    test("o relógio manda o relatório no domingo junto com o resto", async () => {
      const resultado = await relogio.runMoldeClock({ deadline: Date.now() + 8000, origin: "https://uaiflow.teste", now: DOMINGO_9H });
      assert.equal(resultado.relatorio.sent, true);
      assert.match(String(meta.telegram.at(-1)?.body.text), /resumo da semana/);
    });
  });

  // ---------- robô 0.10.0: tipos, retomada, prévias no R2 e códigos de erro ----------

  describe("integração com o robô 0.10.0", () => {
    test("narrar_tratar tem rótulo em português no Telegram", async () => {
      const job = await novo({ tipo: "narrar_tratar", titulo: "Narração da Birdie" });
      await pegar("Mac", ["narrar_tratar"]);
      await acao(job.id, "aprovacao", { worker: "Mac", previa: { texto: "ok" } });
      assert.match(String(meta.telegram.at(-1)?.body.text), /o áudio da narração «Narração da Birdie» ficou pronto/);
    });

    test("retomada: comecar no 1º claim, continuar depois do «Aprovar», refazer depois do «Refazer»", async () => {
      const job = await novo();
      assert.equal((job as Job & { retomada: string }).retomada, "comecar");
      const primeiro = (await pegar()).data as Job & { retomada: string; retomarEstado: string };
      assert.deepEqual([primeiro.retomada, primeiro.retomarEstado], ["comecar", "na_fila"]);
      await acao(job.id, "aprovacao", { worker: "Mac do Nicolas", previa: { texto: "v1" } });
      await acao(job.id, "decidir", { decisao: "refazer", nota: "Mais curto" });
      const refazer = (await pegar()).data as Job & { retomada: string; retomarEstado: string };
      assert.deepEqual([refazer.retomada, refazer.retomarEstado], ["refazer", "recusado"]);
      await acao(job.id, "aprovacao", { worker: "Mac do Nicolas", previa: { texto: "v2" } });
      await acao(job.id, "decidir", { decisao: "aprovar" });
      const continuar = (await pegar()).data as Job & { retomada: string; aprovacao: { rodada: number } };
      assert.equal(continuar.retomada, "continuar");
      assert.equal(continuar.aprovacao.rodada, 2);
    });

    test("Revisão F9 · repetir depois de aprovado → erro: a decisão sai e o robô recebe comecar (refaz de verdade)", async () => {
      const job = await novo();
      await pegar();
      await acao(job.id, "aprovacao", { worker: "Mac do Nicolas", previa: { texto: "v1" } });
      await acao(job.id, "decidir", { decisao: "aprovar" });
      const continuar = (await pegar()).data as Job & { retomada: string };
      assert.equal(continuar.retomada, "continuar");
      await acao(job.id, "erro", { worker: "Mac do Nicolas", erro: "Disco cheio." });
      const repetido = (await (await acao(job.id, "repetir")).json()).data as Job & { retomada: string; aprovacao: unknown; aprovacoes: unknown[] };
      assert.equal(repetido.retomada, "comecar");
      assert.equal(repetido.aprovacao, null);
      assert.equal(repetido.aprovacoes.length, 1, "o histórico fica");
      const denovo = (await pegar()).data as Job & { retomada: string; retomarEstado: string };
      assert.deepEqual([denovo.retomada, denovo.retomarEstado], ["comecar", "na_fila"]);

      // cancelado (esperando aprovação já aprovada) → repetir: também comecar
      await acao(job.id, "aprovacao", { worker: "Mac do Nicolas", previa: { texto: "v2" } });
      await acao(job.id, "decidir", { decisao: "aprovar" });
      await acao(job.id, "cancelar");
      const outra = (await (await acao(job.id, "repetir")).json()).data as Job & { retomada: string };
      assert.equal(outra.retomada, "comecar");
      assert.equal(((await pegar()).data as Job & { retomada: string }).retomada, "comecar");
    });

    test("Revisão F9 · posse: o claim devolve um código novo a cada vez; sem ele ou com o antigo, 409 sem_posse", async () => {
      const job = await novo();
      const primeiro = (await pegar()).data as Job & { posse: string };
      assert.match(primeiro.posse, /^[0-9a-f-]{36}$/);
      assert.equal((await acao(job.id, "batimento", { worker: "Mac do Nicolas" })).status, 200, "com a posse certa");
      for (const posse of [undefined, "nao-e-uuid", "00000000-0000-0000-0000-000000000000"]) {
        const r = await acao(job.id, "batimento", { worker: "Mac do Nicolas", posse });
        assert.equal(r.status, 409, String(posse));
        const corpo = await r.json();
        assert.equal(corpo.codigo, "sem_posse");
        assert.equal(corpo.estado, "rodando");
      }
      // o prazo vence, o mesmo Mac pega de novo: o processo antigo (posse velha) não mexe mais
      await db.sql("update public.molde_jobs set lease_until = now() - interval '1 minute' where id = $1", [job.id]);
      await relogioAgora();
      const segundo = (await pegar()).data as Job & { posse: string };
      assert.equal(segundo.id, job.id);
      assert.notEqual(segundo.posse, primeiro.posse);
      for (const nome of ["batimento", "concluir", "aprovacao", "erro"]) {
        const r = await acao(job.id, nome, { worker: "Mac do Nicolas", posse: primeiro.posse, erro: "x", previa: { texto: "x" } });
        assert.equal(r.status, 409, nome);
        assert.equal((await r.json()).codigo, "sem_posse", nome);
      }
      assert.equal((await linha(job.id)).estado, "rodando");
      assert.equal((await acao(job.id, "concluir", { worker: "Mac do Nicolas", posse: segundo.posse })).status, 200);
      const lista = await (await jobsRoute.GET(request("/api/molde/jobs", { headers: MOLDE }))).json();
      assert.ok(lista.data.every((item: Record<string, unknown>) => !("posse" in item)), "a posse só sai no claim");
    });

    test("upload com folder molde-previas fica em uaiflow/molde-previas/ (sem molde- a mais); o link serve de prévia", async () => {
      const pedir = async (folder?: string) => {
        const r = await uploadRoute.POST(request("/api/molde/upload", { method: "POST", json: { fileName: "previa.mp4", contentType: "video/mp4", size: 1000, ...(folder ? { folder } : {}) }, headers: MOLDE }));
        return (await r.json()).data as { key: string; publicUrl: string };
      };
      assert.match((await pedir("molde-previas")).key, /^uaiflow\/molde-previas\//);
      assert.match((await pedir("previas")).key, /^uaiflow\/molde-previas\//);
      assert.match((await pedir("molde")).key, /^uaiflow\/molde\//);
      assert.match((await pedir()).key, /^uaiflow\/molde\//);
      const alvo = await pedir("molde-previas");
      const job = await novo();
      await pegar();
      const r = await acao(job.id, "aprovacao", { worker: "Mac do Nicolas", previa: { texto: "Prévia", video: alvo.publicUrl } });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).data.previa.video, alvo.publicUrl);
    });

    test("prévias no R2 de trabalhos parados há mais de 30 dias são apagadas 1 vez (o vídeo final não)", async () => {
      const base = process.env.R2_PUBLIC_BASE_URL;
      const job = await novo();
      await pegar();
      await acao(job.id, "aprovacao", {
        worker: "Mac do Nicolas",
        previa: { video: `${base}/uaiflow/molde-previas/2026-09/abc-previa.mp4` },
        resultado: { links: { previa: `${base}/uaiflow/molde-previas/2026-09/abc-previa.mp4` }, final: `${base}/uaiflow/molde/2026-09/final.mp4` },
      });
      const recente = await novo();
      await db.sql("update public.molde_jobs set previa = $2::jsonb where id = $1", [recente.id, JSON.stringify({ video: `${base}/uaiflow/molde-previas/2026-10/nova.mp4` })]);
      await db.sql("update public.molde_jobs set atualizado_em = now() - interval '31 days' where id = $1", [job.id]);
      const resultado = await relogioAgora();
      assert.equal(resultado.previasApagadas, 1);
      const apagados = meta.calls.filter((c) => c.method === "DELETE").map((c) => c.path);
      assert.equal(apagados.length, 1);
      assert.match(apagados[0], /molde-previas\/2026-09\/abc-previa\.mp4/);
      assert.ok((await linha(job.id)).previa_apagada_em);
      assert.equal(((await (await jobRoute.GET(request(`/api/molde/jobs/${job.id}`, { headers: MOLDE }), routeParams({ id: job.id }))).json()).data.previaApagada), true);
      assert.equal((await relogioAgora()).previasApagadas, 0);
    });

    test("Revisão F9 · áudio (M4A/MP3) só na pasta molde-previas; vira previa.audio e o Telegram mostra o link do áudio", async () => {
      const pedir = (contentType: string, folder?: string) =>
        uploadRoute.POST(request("/api/molde/upload", { method: "POST", json: { fileName: "narracao.m4a", contentType, size: 1000, ...(folder ? { folder } : {}) }, headers: MOLDE }));
      const m4a = await pedir("audio/mp4", "molde-previas");
      assert.equal(m4a.status, 200);
      const alvo = (await m4a.json()).data as { key: string; publicUrl: string };
      assert.match(alvo.key, /^uaiflow\/molde-previas\/.*\.m4a$/);
      assert.match((await (await pedir("audio/mpeg", "previas")).json()).data.key, /\.mp3$/);
      for (const folder of [undefined, "molde"]) {
        const r = await pedir("audio/mp4", folder);
        assert.equal(r.status, 400, String(folder));
        assert.match((await r.json()).error, /MP4, MOV, JPG, PNG ou WEBP/);
      }
      assert.equal((await pedir("audio/wav", "molde-previas")).status, 400);

      const job = await novo({ tipo: "narrar_tratar", titulo: "Narração" });
      await pegar("Mac", ["narrar_tratar"]);
      const r = await acao(job.id, "aprovacao", { worker: "Mac", previa: { texto: "Ouça", link: alvo.publicUrl } });
      assert.equal(r.status, 200);
      const previa = (await r.json()).data.previa;
      assert.deepEqual(previa, { texto: "Ouça", audio: alvo.publicUrl }, "o .m4a mandado em link vira audio");
      const { jobApprovalText } = await import("@/lib/telegram/approvals");
      const comVideo = jobApprovalText({ ...(await linha(job.id)), previa: { video: "https://midia.teste.invalid/v.mp4", audio: alvo.publicUrl } } as never);
      assert.match(comVideo, /Prévia: https:\/\/midia\.teste\.invalid\/v\.mp4/);
      assert.ok(comVideo.includes(`Áudio: ${alvo.publicUrl}`));
      const soAudio = jobApprovalText({ ...(await linha(job.id)), previa: { audio: alvo.publicUrl } } as never);
      assert.ok(soAudio.includes(`Prévia: ${alvo.publicUrl}`));
      assert.ok(!soAudio.includes("Áudio:"), "sem repetir o mesmo link");
    });

    test("Revisão F9 · R2 que não responde: o DELETE desiste no prazo e o relógio respeita o orçamento", async () => {
      const r2 = await import("@/lib/content/r2");
      meta.hang = /molde-previas/;
      const inicio = Date.now();
      await assert.rejects(r2.deleteR2Object("uaiflow/molde-previas/2026-09/x.mp4", 200));
      assert.ok(Date.now() - inicio < 1500);

      const base = process.env.R2_PUBLIC_BASE_URL;
      for (let i = 0; i < 3; i += 1) {
        const job = await novo();
        await db.sql("update public.molde_jobs set estado = 'pronto', previa = $2::jsonb, atualizado_em = now() - interval '40 days' where id = $1",
          [job.id, JSON.stringify({ video: `${base}/uaiflow/molde-previas/2026-08/p${i}.mp4` })]);
      }
      const comeco = Date.now();
      const resultado = await relogio.runMoldeClock({ deadline: Date.now() + 5000, origin: "https://uaiflow.teste", now: new Date("2026-10-14T15:00:00Z") });
      assert.ok(Date.now() - comeco < 5500, `levou ${Date.now() - comeco} ms`);
      assert.equal(resultado.previasApagadas, 0, "nada marcado como apagado");
      meta.hang = null;
    });

    test("401 e 503 com codigo: token_invalido, fechado e sem_segredo", async () => {
      const r401 = await criar({ tipo: "reel_pipeline", ref: "x" }, { "x-molde-token": "errado" });
      assert.equal((await r401.json()).codigo, "token_invalido");
      const token = process.env.MOLDE_API_TOKEN;
      delete process.env.MOLDE_API_TOKEN;
      try {
        const fechado = await criar({ tipo: "reel_pipeline", ref: "x" }, {});
        assert.equal(fechado.status, 503);
        assert.equal((await fechado.json()).codigo, "fechado");
      } finally {
        process.env.MOLDE_API_TOKEN = token;
      }
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      const semSegredo = await tocar("x");
      assert.equal((await semSegredo.json()).codigo, "sem_segredo");
    });
  });
});
