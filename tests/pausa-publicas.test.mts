import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Pausa do direct (Instagram restringiu as mensagens): só poucas respostas públicas saem, com o texto da bio. */
const meta = installFakeMeta();

describe("pausa do direct", { skip: semBanco }, () => {
  let db: TestDatabase;
  let drain: typeof import("@/lib/queue/drain");
  let conta: string;
  let seq = 0;
  let escolhidoUmEm: (id: string, n: number) => boolean;

  before(async () => {
    db = await createTestDatabase();
    drain = await import("@/lib/queue/drain");
    escolhidoUmEm = (await import("@/lib/comment-automation")).escolhidoUmEm;
  });
  beforeEach(async () => {
    meta.reset();
    await db.sql("delete from public.queue");
    await db.sql("delete from public.instagram_accounts");
    conta = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A", isDefault: true });
    process.env.ENVIOS_PAUSADOS_ATE = "2099-01-01T00:00:00-03:00";
    process.env.PUBLICAS_NA_PAUSA_POR_HORA = "3";
    process.env.PUBLICAS_NA_PAUSA_UMA_EM = "1";
  });
  after(async () => {
    process.env.ENVIOS_PAUSADOS_ATE = "";
    delete process.env.PUBLICAS_NA_PAUSA_POR_HORA;
    delete process.env.PUBLICAS_NA_PAUSA_UMA_EM;
    meta.restore();
    await db?.close();
  });

  async function pendente(tipo: string, haMinutos = 1) {
    seq += 1;
    const [f] = await db.sql<{ id: string }>(
      `insert into public.queue (account_id, send_type, status, instagram_recipient_id, instagram_comment_id, payload, attempts, created_at)
       values ($1, $2, 'pending', $3, $4, '{"text":"te mandei no direct"}'::jsonb, 0, now() - make_interval(mins => $5::int)) returning id`,
      [conta, tipo, `dest-${seq}`, tipo === "dm" ? null : `cmt-${seq}`, haMinutos],
    );
    return f.id;
  }
  const status = async (id: string) => (await db.sql<{ status: string }>("select status from public.queue where id = $1", [id]))[0].status;

  test("DMs ficam paradas; no máximo 3 públicas por hora, com a frase da bio; as antigas são puladas", async () => {
    const dm = await pendente("dm");
    const primeira = await pendente("private_reply");
    const antiga = await pendente("public_reply", 180);
    const novas = [];
    for (let i = 0; i < 5; i++) novas.push(await pendente("public_reply"));

    const r = await drain.drainQueue(40, 20_000);

    assert.equal(r.pausado, true);
    assert.equal(meta.count("/messages"), 0, "nenhuma DM sai");
    assert.equal(meta.count("/replies"), 3, "só 3 respostas públicas");
    assert.equal(await status(dm), "pending");
    assert.equal(await status(primeira), "pending");
    assert.equal(await status(antiga), "skipped");
    const sts = await Promise.all(novas.map(status));
    assert.equal(sts.filter((s) => s === "sent").length, 3);
    assert.equal(sts.filter((s) => s === "pending").length, 2, "o resto volta para a fila, sem gastar tentativa");
    for (const c of meta.calls.filter((x) => x.path.endsWith("/replies"))) { const msg = typeof c.body === "string" ? new URLSearchParams(c.body).get("message") ?? JSON.parse(c.body || "{}").message : (c.body as Record<string, unknown>)?.message; assert.ok(drain.RESPOSTAS_NA_PAUSA.includes(String(msg)), String(msg)); }

    const r2 = await drain.drainQueue(40, 20_000);
    assert.equal(r2.sent, 0, "a hora já está cheia");
  });

  test("1 em N: o comentário não escolhido é pulado", async () => {
    process.env.PUBLICAS_NA_PAUSA_UMA_EM = "4";
    const ids = [];
    for (let i = 0; i < 8; i++) ids.push(await pendente("public_reply"));
    await drain.drainQueue(40, 20_000);
    const linhas = await db.sql<{ status: string; instagram_comment_id: string }>("select status, instagram_comment_id from public.queue where id = any($1::uuid[])", [ids]);
    for (const l of linhas) if (!escolhidoUmEm(l.instagram_comment_id, 4)) assert.equal(l.status, "skipped");
  });
});
