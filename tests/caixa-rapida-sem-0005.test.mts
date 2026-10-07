import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { LIST_CONTACTS_ANTIGA, semearBasePequena } from "./helpers/caixa.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Sem a 0005 colada no Supabase (banco só até a 0004): o código dá os mesmos resultados, só mais devagar. Sem medir tempo. */
describe("caixa de entrada sem a migração 0005", { skip: semBanco }, () => {
  let db: TestDatabase;
  let repos: typeof import("@/lib/db/repositories");
  let contaId: string;

  before(async () => {
    db = await createTestDatabase({ ate: "0004" });
    repos = await import("@/lib/db/repositories");
    contaId = await seedAccount(db, { username: "ruthie", userId: "1001" });
    await semearBasePequena(repos, contaId, 300);
  });

  after(async () => {
    await db?.close();
  });

  test("o banco de teste está mesmo sem os índices da 0005", async () => {
    const achados = await db.sql("select 1 from pg_indexes where schemaname = 'public' and indexname in ('events_account_user_received_idx', 'queue_contact_created_idx', 'contacts_account_updated_idx', 'contacts_updated_idx', 'queue_sent_dm_idx')");
    assert.equal(achados.length, 0);
  });

  test("listContacts: mesmos contatos, ordem e números que a consulta antiga", async () => {
    for (const limite of [10, 50, 120]) {
      const antigo = (await db.sql(LIST_CONTACTS_ANTIGA, [limite, contaId])) as unknown[];
      const novo = await repos.listContacts(limite, contaId);
      assert.equal(novo.length, limite);
      assert.deepEqual(JSON.parse(JSON.stringify(novo)), JSON.parse(JSON.stringify(antigo)), `limite ${limite}`);
    }
  });

  test("getContactSummary e a conversa abrem normalmente", async () => {
    const lista = await repos.listContacts(250, contaId);
    const alvo = lista[200];
    assert.deepEqual(await repos.getContactSummary(alvo.id, contaId), alvo);
    const { contact, messages } = await repos.getInboxConversation(alvo.id, contaId);
    assert.equal(contact?.id, alvo.id);
    assert.ok(messages.length > 0);
  });
});
