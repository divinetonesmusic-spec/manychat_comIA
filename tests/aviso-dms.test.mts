import "./helpers/env.mjs";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Fase 6 · Aviso no Telegram de DM esperando resposta há mais de 30 min (1 por perfil, no máximo a cada 2 h). */
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const alerts = await import("@/lib/dm-alerts");
const HORA = 3_600_000;
const MIN = 60_000;

after(async () => {
  meta.restore();
  await db?.close();
});

describe("texto do aviso", () => {
  test("quantas mensagens, de quantas pessoas, o perfil e quanto falta para a mais urgente", () => {
    const agora = new Date("2026-10-11T12:00:00Z");
    const texto = alerts.waitingDmsMessage({ username: "ruthie", pessoas: 2, mensagens: 3, prazo: new Date(agora.getTime() + 5 * HORA + 20 * MIN) }, agora);
    assert.equal(texto, [
      "UaiFlow: 3 mensagens no Direct de @ruthie esperam resposta (de 2 pessoas).",
      "A mais urgente vence em 5 h 20 min (o Instagram só deixa responder até 24 h depois da última mensagem da pessoa).",
      "Responda pelo Molde.",
    ].join("\n"));
    const uma = alerts.waitingDmsMessage({ username: null, pessoas: 1, mensagens: 1, prazo: new Date(agora.getTime() + 45 * MIN) }, agora);
    assert.match(uma, /^UaiFlow: 1 mensagem no Direct do seu perfil espera resposta \(de 1 pessoa\)\.\nEla vence em 45 min /);
  });

  test("tempo em palavras simples", () => {
    assert.equal(alerts.durationText(30_000), "menos de 1 min");
    assert.equal(alerts.durationText(59 * MIN), "59 min");
    assert.equal(alerts.durationText(2 * HORA), "2 h");
    assert.equal(alerts.durationText(23 * HORA + 5 * MIN), "23 h 5 min");
  });
});

describe("aviso de DMs esperando (com a 0006 e a 0007)", { skip: semBanco }, () => {
  let contaA: string;
  let contaB: string;
  let seq = 0;

  beforeEach(async () => {
    meta.reset();
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    // O relatório de domingo (9h de São Paulo) dispararia junto com o relógio aos domingos e mudaria a contagem deste teste;
    // ele tem o seu teste próprio (molde-jobs, com a hora fixa).
    process.env.RELATORIO_SEMANAL = "desligado";
    process.env.TELEGRAM_CHAT_ID = "42";
    await db!.sql("delete from public.dm_pending");
    await db!.sql("delete from public.app_status where chave like 'aviso_dms:%'");
    await db!.sql("delete from public.contacts");
    await db!.sql("delete from public.instagram_accounts");
    contaA = await seedAccount(db!, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A", isDefault: true });
    contaB = await seedAccount(db!, { username: "conta_b", userId: "1002", token: "IGAA-TESTE-B", isDefault: false });
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  /** Uma pessoa com DM esperando: `minutos` = há quanto tempo a 1ª mensagem chegou; `horasDesdeUltima` = última mensagem da pessoa. */
  async function esperando(conta: string, opcoes: { minutos?: number; mensagens?: number; horasDesdeUltima?: number; saiu?: boolean } = {}) {
    seq += 1;
    const minutos = opcoes.minutos ?? 40;
    const horas = opcoes.horasDesdeUltima ?? minutos / 60;
    const [contato] = await db!.sql<{ id: string }>(
      `insert into public.contacts (account_id, instagram_user_id, instagram_username, last_response_at, opted_out_at)
       values ($1, $2, $3, now() - make_interval(secs => $4::float8 * 3600), $5) returning id`,
      [conta, `u${seq}`, `pessoa${seq}`, horas, opcoes.saiu ? new Date() : null],
    );
    const quantas = opcoes.mensagens ?? 1;
    const mensagens = Array.from({ length: quantas }, (_, i) => ({
      texto: `oi ${i}`,
      em: new Date(Date.now() - (minutos - i) * MIN).toISOString(),
      eventId: `ev-${seq}-${i}`,
    }));
    const [linha] = await db!.sql<{ id: string }>(
      `insert into public.dm_pending (account_id, contact_id, instagram_user_id, username, messages, last_message_at, created_at)
       values ($1, $2, $3, $4, $5::jsonb, now() - make_interval(mins => $6), now() - make_interval(mins => $7)) returning id`,
      [conta, contato.id, `u${seq}`, `pessoa${seq}`, JSON.stringify(mensagens), minutos - quantas + 1, minutos],
    );
    return linha.id;
  }

  const textos = () => meta.telegram.map((aviso) => String(aviso.body.text));

  test("1 pessoa esperando há 40 min: 1 aviso, com o perfil e o prazo; o aviso fica marcado e não repete", async () => {
    const id = await esperando(contaA, { minutos: 40, horasDesdeUltima: 20 });
    const resultado = await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 });
    assert.deepEqual(resultado, { sent: 1 });
    assert.equal(meta.telegram.length, 1);
    assert.match(textos()[0], /^UaiFlow: 1 mensagem no Direct de @conta_a espera resposta \(de 1 pessoa\)\./);
    assert.match(textos()[0], /Ela vence em (3 h 59 min|4 h) /);

    const [linha] = await db!.sql<{ notified_at: Date | null }>("select notified_at from public.dm_pending where id = $1", [id]);
    assert.ok(linha.notified_at, "marcado no banco");

    assert.deepEqual(await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 }), { sent: 0 });
    assert.equal(meta.telegram.length, 1, "não repete");
  });

  test("um aviso por perfil, somando as pessoas do perfil; a mais urgente é a que vence primeiro", async () => {
    await esperando(contaA, { minutos: 50, mensagens: 2, horasDesdeUltima: 10 });
    await esperando(contaA, { minutos: 35, horasDesdeUltima: 22 });
    await esperando(contaB, { minutos: 60 });
    const resultado = await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 });
    assert.equal(resultado.sent, 2);
    const doA = textos().find((texto) => texto.includes("@conta_a")) as string;
    const doB = textos().find((texto) => texto.includes("@conta_b")) as string;
    assert.match(doA, /3 mensagens no Direct de @conta_a esperam resposta \(de 2 pessoas\)/);
    assert.match(doA, /A mais urgente vence em (1 h 59 min|2 h) /, "a pessoa de 22 h atrás vence em 2 h");
    assert.match(doB, /1 mensagem no Direct de @conta_b/);
  });

  test("não avisa: esperando há menos de 30 min, prazo de 24 h já vencido, pessoa que pediu para sair", async () => {
    await esperando(contaA, { minutos: 10 });
    await esperando(contaA, { minutos: 40, horasDesdeUltima: 25 });
    await esperando(contaB, { minutos: 40, saiu: true });
    assert.deepEqual(await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 }), { sent: 0 });
    assert.equal(meta.telegram.length, 0);
  });

  test("conta com uma pessoa nova (<30 min) e outra antiga: avisa e conta as duas", async () => {
    await esperando(contaA, { minutos: 10 });
    await esperando(contaA, { minutos: 45 });
    await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 });
    assert.equal(meta.telegram.length, 1);
    assert.match(textos()[0], /2 mensagens .* \(de 2 pessoas\)/);
    const marcadas = await db!.sql("select 1 from public.dm_pending where notified_at is not null");
    assert.equal(marcadas.length, 2, "as duas ficam marcadas");
  });

  test("mensagem nova depois do aviso: avisa de novo, mas só depois de 2 h do último aviso do perfil", async () => {
    const id = await esperando(contaA, { minutos: 40 });
    await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 });
    assert.equal(meta.telegram.length, 1);

    // A pessoa mandou outra mensagem depois do aviso (há 35 min); o último aviso do perfil foi há 1 h.
    await db!.sql("update public.dm_pending set notified_at = now() - interval '1 hour' where id = $1", [id]);
    await db!.sql("update public.app_status set atualizado_em = now() - interval '1 hour' where chave = $1", [`aviso_dms:${contaA}`]);
    await db!.sql(
      `update public.dm_pending set messages = messages || jsonb_build_array(jsonb_build_object('texto', 'e aí?', 'em', (now() - interval '35 minutes')::text, 'eventId', 'ev-novo')),
              last_message_at = now() - interval '35 minutes' where id = $1`,
      [id],
    );
    await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 });
    assert.equal(meta.telegram.length, 1, "dentro das 2 h: espera");

    await db!.sql("update public.app_status set atualizado_em = now() - interval '2 hours 1 minute' where chave = $1", [`aviso_dms:${contaA}`]);
    await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 });
    assert.equal(meta.telegram.length, 2, "passadas as 2 h: avisa de novo");
    assert.match(textos()[1], /2 mensagens/);
  });

  test("sem Telegram configurado: não faz nada e não marca nada", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await esperando(contaA, { minutos: 40 });
    assert.deepEqual(await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 }), { sent: 0, skipped: "sem_telegram" });
    assert.equal((await db!.sql("select 1 from public.dm_pending where notified_at is not null")).length, 0);
  });

  test("Telegram fora do ar: não marca (tenta de novo no próximo minuto) e não quebra", async () => {
    meta.telegramFails = "rede";
    await esperando(contaA, { minutos: 40 });
    const erros: unknown[] = [];
    const original = console.error;
    console.error = (...partes: unknown[]) => void erros.push(partes);
    try {
      assert.deepEqual(await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 }), { sent: 0 });
    } finally {
      console.error = original;
    }
    assert.equal((await db!.sql("select 1 from public.dm_pending where notified_at is not null")).length, 0);
    meta.telegramFails = null;
    assert.equal((await alerts.notifyWaitingDms({ deadline: Date.now() + 10_000 })).sent, 1);
  });

  test("sem tempo no relógio: fica para o próximo minuto", async () => {
    await esperando(contaA, { minutos: 40 });
    assert.deepEqual(await alerts.notifyWaitingDms({ deadline: Date.now() + 200 }), { sent: 0, skipped: "sem_tempo" });
    assert.equal(meta.telegram.length, 0);
  });

  test("o relógio (/api/queue/drain) manda o aviso", async () => {
    await esperando(contaA, { minutos: 40 });
    const route = await import("@/app/api/queue/drain/route");
    const corpo = await (await route.POST(request("/api/queue/drain", { method: "POST", headers: { "x-worker-secret": process.env.WORKER_SECRET as string } }))).json();
    assert.deepEqual(corpo.avisosDm, { sent: 1 });
    assert.equal(meta.telegram.length, 1);
  });
});
