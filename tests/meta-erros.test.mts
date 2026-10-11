import "./helpers/env.mjs";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Fase 6 · Meta: prazo de 8 s em cada chamada, code/error_subcode guardados no erro, limite de uso da Meta adia
 * (sem gastar as 3 tentativas) e a DM com mídia + texto não repete o texto quando só a mídia falhou.
 */
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const client = await import("@/lib/instagram/client");
const MIN = 60_000;

after(async () => {
  meta.restore();
  await db?.close();
});

describe("erros da Meta (sem banco)", () => {
  beforeEach(() => meta.reset());
  afterEach(() => {
    delete process.env.META_TIMEOUT_MS;
  });

  const dm = () => client.sendDirectMessage({ instagramUserId: "1001", recipientId: "dest", accessToken: "IGAA-TESTE", text: "oi" });

  test("o erro guarda status, code e error_subcode; a mensagem continua igual", async () => {
    meta.messagesError = { status: 400, error: { message: "(#4) Application request limit reached", code: 4, error_subcode: 2207042, type: "OAuthException" } };
    const erro = await dm().then(() => null, (error: unknown) => error);
    assert.ok(erro instanceof client.MetaApiError);
    assert.equal(erro.status, 400);
    assert.equal(erro.code, 4);
    assert.equal(erro.subcode, 2207042);
    assert.equal(erro.kind, "rate_limit");
    assert.equal(erro.temporary, true);
    assert.match(erro.message, /^Instagram Graph v\d+\.\d+: \(#4\) Application request limit reached$/);
  });

  test("limite de uso: códigos 4, 17, 32, 613, 80002, o subcódigo 2207042 e HTTP 429; o resto não", async () => {
    const casos: Array<[number, Record<string, unknown>, string]> = [
      [400, { message: "a", code: 4 }, "rate_limit"],
      [400, { message: "b", code: 17 }, "rate_limit"],
      [400, { message: "c", code: 32 }, "rate_limit"],
      [400, { message: "d", code: 613 }, "rate_limit"],
      [400, { message: "e", code: 80002 }, "rate_limit"],
      [400, { message: "f", code: 9, error_subcode: 2207042 }, "rate_limit"],
      [429, { message: "g" }, "rate_limit"],
      [400, { message: "h", code: 100 }, "other"],
      [400, { message: "i", code: 190 }, "other"],
      [500, { message: "j", code: 2 }, "other"],
    ];
    for (const [status, error, tipo] of casos) {
      meta.messagesError = { status, error };
      const erro = (await dm().then(() => null, (e: unknown) => e)) as InstanceType<typeof client.MetaApiError>;
      assert.equal(erro.kind, tipo, JSON.stringify([status, error]));
      assert.equal(client.isMetaRateLimit(erro), tipo === "rate_limit");
    }
  });

  test("a Meta travou: o pedido desiste no prazo e vira erro temporário (timeout)", async () => {
    process.env.META_TIMEOUT_MS = "150";
    meta.hang = /\/messages$/;
    const inicio = Date.now();
    const erro = await dm().then(() => null, (e: unknown) => e);
    const levou = Date.now() - inicio;
    assert.ok(client.isMetaTimeout(erro), String(erro));
    assert.equal((erro as InstanceType<typeof client.MetaApiError>).temporary, true);
    assert.match((erro as Error).message, /não respondeu/);
    assert.ok(levou >= 140 && levou < 3000, `levou ${levou} ms`);
  });

  test("o prazo padrão é de 8 s e vale para todas as chamadas (graphFetch e as diretas)", async () => {
    assert.equal(client.META_TIMEOUT_MS, 8000);
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/lib/instagram/client.ts", "utf8");
    assert.equal((fonte.match(/\bawait fetch\(/g) ?? []).length, 1, "só o metaFetch chama o fetch");
    assert.ok(fonte.includes("AbortSignal.timeout(timeoutMs)"));
  });
});

type Fila = { id: string; status: string; attempts: number; available_at: Date; last_error: string | null; payload: Record<string, unknown> };

describe("fila: limite de uso da Meta e DM com mídia", { skip: semBanco }, () => {
  let drain: typeof import("@/lib/queue/drain");
  let repos: typeof import("@/lib/db/repositories");
  let conta: string;
  let outra: string;
  let seq = 0;

  before(async () => {
    drain = await import("@/lib/queue/drain");
    repos = await import("@/lib/db/repositories");
  });

  beforeEach(async () => {
    meta.reset();
    await db!.sql("delete from public.queue");
    await db!.sql("delete from public.contacts");
    await db!.sql("delete from public.instagram_accounts");
    conta = await seedAccount(db!, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A", isDefault: true });
    outra = await seedAccount(db!, { username: "conta_b", userId: "1002", token: "IGAA-TESTE-B", isDefault: false });
  });

  async function pendente(accountId: string, payload: Record<string, unknown> = { text: "Aqui está o link" }) {
    seq += 1;
    const [c] = await db!.sql<{ id: string }>(
      "insert into public.contacts (account_id, instagram_user_id, instagram_username, last_response_at) values ($1, $2, $3, now()) returning id",
      [accountId, `u${seq}`, `pessoa${seq}`],
    );
    const [fila] = await db!.sql<{ id: string }>(
      `insert into public.queue (account_id, contact_id, send_type, status, instagram_recipient_id, payload)
       values ($1, $2, 'dm', 'pending', $3, $4) returning id`,
      [accountId, c.id, `dest-${seq}`, JSON.stringify(payload)],
    );
    return fila.id;
  }

  const ler = async (id: string) => (await db!.sql<Fila>("select id, status, attempts, available_at, last_error, payload from public.queue where id = $1", [id]))[0];
  const liberar = () => db!.sql("update public.queue set available_at = now() - interval '1 second' where status = 'pending'");
  const minutosAte = (data: Date) => (new Date(data).getTime() - Date.now()) / MIN;

  test("limite de uso (código 4): espera 30 min, não gasta tentativa, não vira 'falhou'; os outros envios do perfil esperam junto", async () => {
    const primeiro = await pendente(conta);
    const segundo = await pendente(conta);
    const deOutroPerfil = await pendente(outra);
    meta.messagesError = { status: 400, error: { message: "(#4) Application request limit reached", code: 4 } };

    const resultado = await drain.drainQueue(40, 20_000);
    assert.equal(resultado.failed, 0);

    const a = await ler(primeiro);
    assert.equal(a.status, "pending");
    assert.equal(a.attempts, 0, "não gastou tentativa");
    assert.ok(Math.abs(minutosAte(a.available_at) - 30) < 1, `espera ${minutosAte(a.available_at)} min`);
    assert.match(a.last_error ?? "", /^A Meta pediu para esperar \(limite de uso\)\. Nova tentativa às \d\d:\d\d\.$/);
    assert.equal(a.payload.limiteMeta, 1);

    const b = await ler(segundo);
    assert.equal(b.status, "pending");
    assert.equal(b.attempts, 0);
    assert.ok(minutosAte(b.available_at) > 29, "o outro envio do mesmo perfil espera junto");

    // O outro perfil também esbarrou no limite (a Meta falsa recusa tudo), mas cada perfil conta o seu.
    const c = await ler(deOutroPerfil);
    assert.equal(c.status, "pending");
    assert.equal(meta.count("/messages", "POST"), 2, "uma chamada por perfil; o 2º envio do perfil A nem chamou a Meta");
  });

  test("a espera cresce (30, 60, 120 min...) e só desiste depois de 6 vezes seguidas", async () => {
    const id = await pendente(conta);
    meta.messagesError = { status: 429, error: { message: "Too many calls" } };
    const esperas: number[] = [];
    for (let vez = 1; vez <= 3; vez += 1) {
      await drain.drainQueue(40, 20_000);
      const fila = await ler(id);
      assert.equal(fila.status, "pending", `vez ${vez}`);
      assert.equal(fila.attempts, 0, `vez ${vez}`);
      esperas.push(Math.round(minutosAte(fila.available_at)));
      await liberar();
    }
    assert.deepEqual(esperas, [30, 60, 120]);

    await db!.sql("update public.queue set payload = jsonb_set(payload, '{limiteMeta}', '6') where id = $1", [id]);
    await drain.drainQueue(40, 20_000);
    const desistiu = await ler(id);
    assert.equal(desistiu.status, "failed");
    assert.equal(desistiu.last_error, repos.META_LIMIT_GAVE_UP);
  });

  test("erro permanente (código 100) continua como antes: tentativa gasta e nova tentativa em 5 min; na 3ª, 'falhou'", async () => {
    const id = await pendente(conta);
    meta.messagesError = { status: 400, error: { message: "(#100) Invalid parameter", code: 100 } };
    await drain.drainQueue(40, 20_000);
    let fila = await ler(id);
    assert.equal(fila.status, "pending");
    assert.equal(fila.attempts, 1);
    assert.ok(Math.abs(minutosAte(fila.available_at) - 5) < 1);
    assert.match(fila.last_error ?? "", /Invalid parameter/);
    for (let vez = 2; vez <= 3; vez += 1) {
      await liberar();
      await drain.drainQueue(40, 20_000);
    }
    fila = await ler(id);
    assert.equal(fila.status, "failed");
    assert.equal(fila.attempts, 3);
  });

  test("DM com mídia e texto: a mídia falhou, a nova tentativa manda só a mídia (o texto não sai duas vezes)", async () => {
    const id = await pendente(conta, { type: "media", text: "Olha que lindo", mediaUrl: "https://midia.teste.invalid/foto.jpg", mediaType: "image" });
    meta.mediaMessageFails = 1;
    await drain.drainQueue(40, 20_000);
    let fila = await ler(id);
    assert.equal(fila.status, "pending");
    assert.equal(fila.payload.textSent, true, "o texto saiu e ficou marcado");

    await liberar();
    await drain.drainQueue(40, 20_000);
    fila = await ler(id);
    assert.equal(fila.status, "sent");

    const mensagens = meta.calls.filter((call) => call.path.endsWith("/messages") && call.method === "POST").map((call) => call.body.message as Record<string, unknown>);
    const textos = mensagens.filter((mensagem) => mensagem.text === "Olha que lindo");
    const midias = mensagens.filter((mensagem) => (mensagem.attachment as { type?: string } | undefined)?.type === "image");
    assert.equal(textos.length, 1, "o texto saiu uma vez só");
    assert.equal(midias.length, 2, "a mídia foi tentada duas vezes (falhou e depois saiu)");
  });

  test("DM com mídia e texto sem falha: texto e mídia saem uma vez cada", async () => {
    const id = await pendente(conta, { type: "media", text: "Oi", mediaUrl: "https://midia.teste.invalid/foto.jpg", mediaType: "image" });
    await drain.drainQueue(40, 20_000);
    assert.equal((await ler(id)).status, "sent");
    assert.equal(meta.count("/messages", "POST"), 2);
  });
});

describe("posts: erro temporário da Meta não vira 'Com erro'", { skip: semBanco }, () => {
  let scheduler: typeof import("@/lib/content/scheduler");
  let conta: string;

  before(async () => {
    scheduler = await import("@/lib/content/scheduler");
  });

  beforeEach(async () => {
    meta.reset();
    delete process.env.META_TIMEOUT_MS;
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    process.env.TELEGRAM_CHAT_ID = "42";
    await db!.sql("delete from public.content_posts");
    await db!.sql("delete from public.instagram_accounts");
    conta = await seedAccount(db!, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.META_TIMEOUT_MS;
  });

  test("limite de uso ao criar o container: volta para 'agendado' daqui a 30 min, sem gastar tentativa e sem aviso", async () => {
    const id = await insertPost(db!, conta);
    meta.createMediaFailure = { status: 400, error: { message: "(#17) User request limit reached", code: 17 } };
    const resultado = await scheduler.runContentCycle(8000);
    assert.equal(resultado.failed, 0);
    const post = await readPost(db!, id);
    assert.equal(post.status, "scheduled");
    assert.equal(post.attempts, 0);
    assert.ok(Math.abs((new Date(post.scheduled_at as string).getTime() - Date.now()) / MIN - 30) < 1);
    assert.match(String(post.last_error), /^A Meta pediu para esperar \(limite de uso\)\. Nova tentativa às \d\d:\d\d\.$/);
    assert.equal(meta.telegram.length, 0, "nenhum aviso de 'Com erro'");
  });

  test("teto de 6 esperas seguidas: a 7ª vira 'Com erro' com aviso no Telegram; começar de verdade zera o contador", async () => {
    const id = await insertPost(db!, conta);
    meta.createMediaFailure = { status: 400, error: { message: "(#4) Application request limit reached", code: 4 } };
    await scheduler.runContentCycle(8000);
    let post = await readPost(db!, id);
    assert.equal(post.status, "scheduled");
    assert.equal(post.meta_limit_waits, 1);
    assert.equal(post.attempts, 0);

    await db!.sql("update public.content_posts set meta_limit_waits = 6, scheduled_at = now() - interval '1 minute' where id = $1", [id]);
    await scheduler.runContentCycle(8000);
    post = await readPost(db!, id);
    assert.equal(post.status, "failed");
    assert.equal(post.last_error, scheduler.META_LIMIT_POST_GAVE_UP);
    assert.equal(meta.telegram.length, 1, "aviso de 'Com erro'");
    assert.match(String(meta.telegram[0].body.text), /limite de uso/);

    const outro = await insertPost(db!, conta, { meta_limit_waits: 3 });
    meta.createMediaFailure = null;
    await scheduler.runContentCycle(8000);
    assert.equal((await readPost(db!, outro)).meta_limit_waits, 0, "começou: as esperas seguidas voltam a 0");
  });

  test("limite de publicações (subcódigo 2207042) também espera", async () => {
    const id = await insertPost(db!, conta);
    meta.createMediaFailure = { status: 400, error: { message: "The user has reached the publishing limit", code: 9, error_subcode: 2207042 } };
    await scheduler.runContentCycle(8000);
    assert.equal((await readPost(db!, id)).status, "scheduled");
  });

  test("a Meta não respondeu ao criar o container: espera 5 min (a tentativa conta); na 3ª vira 'Com erro'", async () => {
    process.env.META_TIMEOUT_MS = "150";
    meta.hang = /\/media$/;
    const id = await insertPost(db!, conta);
    await scheduler.runContentCycle(8000);
    let post = await readPost(db!, id);
    assert.equal(post.status, "scheduled");
    assert.equal(post.attempts, 1);
    assert.match(String(post.last_error), /^A Meta não respondeu a tempo\. Nova tentativa às \d\d:\d\d\.$/);

    await db!.sql("update public.content_posts set attempts = 2, scheduled_at = now() - interval '1 minute' where id = $1", [id]);
    await scheduler.runContentCycle(8000);
    post = await readPost(db!, id);
    assert.equal(post.status, "failed", "3ª tentativa sem resposta: Com erro, como qualquer outra falha");
    assert.match(String(post.last_error), /não respondeu/);
  });

  test("erro permanente ao criar o container continua virando 'Com erro' na hora", async () => {
    const id = await insertPost(db!, conta);
    meta.createMediaFailure = { status: 400, error: { message: "(#100) Invalid parameter", code: 100 } };
    await scheduler.runContentCycle(8000);
    assert.equal((await readPost(db!, id)).status, "failed");
  });
});
