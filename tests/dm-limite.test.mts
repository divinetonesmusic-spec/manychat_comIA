import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Limite de 200 DMs por hora por perfil: o que passa do limite espera o próximo horário livre (nunca vira "failed"). */
const meta = installFakeMeta();

type Fila = { id: string; status: string; attempts: number; available_at: Date; last_error: string | null; sent_at: Date | null; send_type: string };

describe("limite de 200 mensagens por hora", { skip: semBanco }, () => {
  let db: TestDatabase;
  let drain: typeof import("@/lib/queue/drain");
  let repos: typeof import("@/lib/db/repositories");
  let contaA: string;
  let contaB: string;
  let seq = 0;

  before(async () => {
    db = await createTestDatabase();
    drain = await import("@/lib/queue/drain");
    repos = await import("@/lib/db/repositories");
  });

  beforeEach(async () => {
    meta.reset();
    seq = 0;
    await db.sql("delete from public.queue");
    await db.sql("delete from public.contacts");
    await db.sql("delete from public.instagram_accounts");
    contaA = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A", isDefault: true });
    contaB = await seedAccount(db, { username: "conta_b", userId: "1002", token: "IGAA-TESTE-B", isDefault: false });
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  async function contato(conta: string) {
    seq += 1;
    const [c] = await db.sql<{ id: string }>(
      "insert into public.contacts (account_id, instagram_user_id, instagram_username, last_response_at) values ($1, $2, $3, now()) returning id",
      [conta, `u${seq}`, `pessoa${seq}`],
    );
    return c.id;
  }

  /** `quantas` mensagens já enviadas, uma por segundo, a partir de `haMinutos` atrás (a mais antiga é a de `haMinutos`). */
  async function jaEnviadas(conta: string, quantas: number, haMinutos: number, tipo = "dm") {
    await db.sql(
      `insert into public.queue (account_id, send_type, status, instagram_recipient_id, instagram_comment_id, payload, attempts, sent_at)
       select $1::uuid, $2::text, 'sent', 'dest-' || g, case when $2::text = 'private_reply' then 'cmt-env-' || $1::text || '-' || g end, '{"text":"oi"}'::jsonb, 1,
              now() - make_interval(mins => $4::int) + make_interval(secs => g)
       from generate_series(1, $3::int) g`,
      [conta, tipo, quantas, haMinutos],
    );
  }

  async function pendente(conta: string, tipo: "dm" | "private_reply" | "public_reply" = "dm") {
    const id = await contato(conta);
    const [fila] = await db.sql<{ id: string }>(
      `insert into public.queue (account_id, contact_id, send_type, status, instagram_recipient_id, instagram_comment_id, payload, attempts)
       values ($1, $2, $3, 'pending', $4, $5, '{"text":"Aqui está o link"}'::jsonb, 1) returning id`,
      [conta, id, tipo, `dest-p-${seq}`, tipo === "dm" ? null : `cmt-${conta}-${seq}-${tipo}`],
    );
    return fila.id;
  }

  const lerFila = (ids: string[]) => db.sql<Fila>("select id, status, attempts, available_at, last_error, sent_at, send_type from public.queue where id = any($1::uuid[]) order by created_at, id", [ids]);
  const horaSp = async (data: Date) => (await db.sql<{ hm: string }>("select to_char($1::timestamptz at time zone 'America/Sao_Paulo', 'HH24:MI') as hm", [data]))[0].hm;

  test("200 DMs na última hora: as pendentes esperam o horário livre, a resposta pública sai e a Meta não recebe nenhuma DM", async () => {
    await jaEnviadas(contaA, 200, 10);
    const dms = [await pendente(contaA), await pendente(contaA), await pendente(contaA), await pendente(contaA), await pendente(contaA)];
    const publica = await pendente(contaA, "public_reply");
    const [{ mais_antiga }] = await db.sql<{ mais_antiga: Date }>("select min(sent_at) as mais_antiga from public.queue where status = 'sent'");

    const resultado = await drain.drainQueue(40, 20_000);

    assert.equal(meta.count("/messages"), 0, "nenhuma DM chega à Meta");
    assert.equal(meta.count("/replies"), 1, "a resposta pública sai normalmente");
    assert.equal(resultado.deferred, 5);
    assert.equal(resultado.failed, 0);
    assert.equal(resultado.sent, 1);

    const esperado = mais_antiga.getTime() + 3600_000 + 5_000;
    for (const linha of await lerFila(dms)) {
      assert.equal(linha.status, "pending");
      assert.equal(linha.attempts, 1, "não gasta tentativa");
      assert.ok(Math.abs(linha.available_at.getTime() - esperado) < 1000, `available_at ${linha.available_at.toISOString()} ~ ${new Date(esperado).toISOString()}`);
      assert.equal(linha.last_error, `Limite de 200 mensagens por hora deste perfil: sai às ${await horaSp(linha.available_at)}.`);
      assert.match(linha.last_error ?? "", /^Limite de 200 mensagens por hora deste perfil: sai às \d\d:\d\d\.$/);
    }
    const [resp] = await lerFila([publica]);
    assert.equal(resp.status, "sent");
  });

  test("com o limite batido no meio do lote: as primeiras saem e as outras esperam", async () => {
    await jaEnviadas(contaA, 198, 10);
    const dms: string[] = [];
    for (let i = 0; i < 5; i += 1) dms.push(await pendente(contaA));

    const resultado = await drain.drainQueue(40, 20_000);

    assert.equal(meta.count("/messages"), 2);
    assert.equal(resultado.sent, 2);
    assert.equal(resultado.deferred, 3);
    const linhas = await lerFila(dms);
    assert.deepEqual(linhas.map((l) => l.status), ["sent", "sent", "pending", "pending", "pending"]);
    assert.ok(linhas.slice(2).every((l) => l.attempts === 1 && /^Limite de 200 mensagens/.test(l.last_error ?? "")));
    assert.ok(linhas.slice(2).every((l) => l.available_at.getTime() > Date.now() + 30 * 60_000), "volta mais tarde, daqui a bastante tempo");
  });

  test("resposta privada (comentário) também espera", async () => {
    await jaEnviadas(contaA, 200, 5, "private_reply");
    const priv = await pendente(contaA, "private_reply");
    const resultado = await drain.drainQueue(40, 20_000);
    assert.equal(meta.count("/messages"), 0);
    assert.equal(resultado.deferred, 1);
    const [linha] = await lerFila([priv]);
    assert.equal(linha.status, "pending");
    assert.equal(linha.attempts, 1);
  });

  test("com os envios 61 minutos mais velhos o drain seguinte manda", async () => {
    await jaEnviadas(contaA, 200, 10);
    const dms = [await pendente(contaA), await pendente(contaA)];
    await drain.drainQueue(40, 20_000);
    assert.equal(meta.count("/messages"), 0);

    // O tempo passa: 61 minutos para os envios e para o horário marcado das mensagens.
    await db.sql("update public.queue set sent_at = sent_at - interval '61 minutes' where status = 'sent'");
    await db.sql("update public.queue set available_at = available_at - interval '61 minutes' where id = any($1::uuid[])", [dms]);
    const resultado = await drain.drainQueue(40, 20_000);

    assert.equal(meta.count("/messages"), 2);
    assert.equal(resultado.sent, 2);
    assert.equal(resultado.deferred, 0);
    const linhas = await lerFila(dms);
    assert.ok(linhas.every((l) => l.status === "sent" && l.last_error === null));
  });

  test("duas contas: o limite de A não segura B", async () => {
    await jaEnviadas(contaA, 200, 10);
    const deA = [await pendente(contaA), await pendente(contaA)];
    const deB = [await pendente(contaB), await pendente(contaB), await pendente(contaB)];

    const resultado = await drain.drainQueue(40, 20_000);

    assert.equal(resultado.sent, 3);
    assert.equal(resultado.deferred, 2);
    assert.deepEqual((await lerFila(deA)).map((l) => l.status), ["pending", "pending"]);
    assert.deepEqual((await lerFila(deB)).map((l) => l.status), ["sent", "sent", "sent"]);
    const mensagens = meta.calls.filter((call) => call.path.endsWith("/messages"));
    assert.equal(mensagens.length, 3);
    assert.ok(mensagens.every((call) => call.path.startsWith("/1002/")), "só o perfil B enviou");
  });

  test("três drains seguidos nunca marcam 'failed' por causa do limite", async () => {
    await jaEnviadas(contaA, 200, 10);
    const dms: string[] = [];
    for (let i = 0; i < 6; i += 1) dms.push(await pendente(contaA));

    for (let rodada = 0; rodada < 3; rodada += 1) {
      // Força a mensagem a ser pega de novo (como se o horário marcado tivesse chegado, com o limite ainda batido).
      await db.sql("update public.queue set available_at = now() where id = any($1::uuid[])", [dms]);
      const resultado = await drain.drainQueue(40, 20_000);
      assert.equal(resultado.failed, 0);
      assert.equal(resultado.deferred, 6);
    }

    const linhas = await lerFila(dms);
    assert.ok(linhas.every((l) => l.status === "pending" && l.attempts === 1), JSON.stringify(linhas.map((l) => [l.status, l.attempts])));
    assert.equal(meta.count("/messages"), 0);
    assert.equal((await db.sql("select 1 from public.queue where status = 'failed'")).length, 0);
  });

  test("a resposta do /api/queue/drain ganha 'deferred' e o resto continua igual", async () => {
    const rota = await import("@/app/api/queue/drain/route");
    await jaEnviadas(contaA, 200, 10);
    await pendente(contaA);
    await pendente(contaA);
    await pendente(contaB);

    const resposta = await rota.POST(request("/api/queue/drain", { method: "POST", headers: { "x-worker-secret": process.env.WORKER_SECRET as string } }));
    assert.equal(resposta.status, 200);
    const corpo = (await resposta.json()) as Record<string, unknown>;
    assert.equal(corpo.ok, true);
    assert.equal(corpo.processed, 3);
    assert.equal(corpo.sent, 1);
    assert.equal(corpo.failed, 0);
    assert.equal(corpo.deferred, 2);
    assert.equal(corpo.stoppedEarly, false);
    for (const campo of ["content", "ms"]) assert.ok(campo in corpo, campo);
  });

  test("nextDmSlot: 1 h e 5 s depois do 200º envio mais recente; no mínimo daqui a 1 minuto", async () => {
    await jaEnviadas(contaA, 200, 30);
    const [{ duzentos }] = await db.sql<{ duzentos: Date }>("select min(sent_at) as duzentos from public.queue where account_id = $1", [contaA]);
    const slot = await repos.nextDmSlot(contaA);
    assert.ok(Math.abs(slot.getTime() - (duzentos.getTime() + 3605_000)) < 1000);

    // Mais de 200 na hora: vale o 200º mais recente, não o mais antigo.
    await jaEnviadas(contaA, 10, 5);
    const [{ ducentesimo }] = await db.sql<{ ducentesimo: Date }>(
      "select sent_at as ducentesimo from public.queue where account_id = $1 and status = 'sent' order by sent_at desc offset 199 limit 1",
      [contaA],
    );
    assert.ok(Math.abs((await repos.nextDmSlot(contaA)).getTime() - (ducentesimo.getTime() + 3605_000)) < 1000);

    // Sem 200 envios na janela (a contagem mudou no meio do caminho): espera 1 minuto.
    const antes = Date.now();
    const vazio = await repos.nextDmSlot(contaB);
    assert.ok(vazio.getTime() >= antes + 59_000 && vazio.getTime() <= Date.now() + 61_000);
  });

  test("deferQueueJobs só mexe em quem está 'sending' e não gasta tentativa", async () => {
    const [enviando, pendenteId, enviada] = [await pendente(contaA), await pendente(contaA), await pendente(contaA)];
    await db.sql("update public.queue set status = 'sending', claimed_at = now(), attempts = 2 where id = $1", [enviando]);
    await db.sql("update public.queue set status = 'sent', sent_at = now() where id = $1", [enviada]);
    const quando = new Date(Date.now() + 40 * 60_000);

    await repos.deferQueueJobs([enviando, pendenteId, enviada], quando, "Nota de teste");

    const [a, b, c] = await lerFila([enviando, pendenteId, enviada]);
    assert.deepEqual([a.status, a.attempts, a.last_error], ["pending", 1, "Nota de teste"]);
    assert.ok(Math.abs(a.available_at.getTime() - quando.getTime()) < 1000);
    assert.equal(b.last_error, null, "pendente que ninguém pegou não muda");
    assert.equal(c.status, "sent");
    await repos.deferQueueJobs([], quando, "nada");
  });
});
