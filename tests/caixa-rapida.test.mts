import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { LIST_CONTACTS_ANTIGA, conferirConversaIgualAntiga, semearBaseGrande, semearBasePequena } from "./helpers/caixa.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/** Caixa de entrada e Contatos com milhares de contatos (U-DESEMP-01), com a migração 0005. */
describe("caixa de entrada rápida (com a migração 0005)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let repos: typeof import("@/lib/db/repositories");
  let contaId: string;

  before(async () => {
    db = await createTestDatabase();
    repos = await import("@/lib/db/repositories");
    contaId = await seedAccount(db, { username: "ruthie", userId: "1001" });
  });

  after(async () => {
    await db?.close();
  });

  test("a 0005 cria os 5 índices e pode rodar de novo", async () => {
    const nomes = ["events_account_user_received_idx", "queue_contact_created_idx", "contacts_account_updated_idx", "contacts_updated_idx", "queue_sent_dm_idx"];
    const achados = await db.sql<{ indexname: string }>("select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[])", [nomes]);
    assert.deepEqual(achados.map((linha) => linha.indexname).sort(), [...nomes].sort());
    const { readFileSync } = await import("node:fs");
    await db.sql(readFileSync("supabase/migrations/0005_caixa_rapida.sql", "utf8"));
  });

  test("mesmos contatos, na mesma ordem e com os mesmos números que a consulta antiga (300 contatos feitos pelo webhook)", async () => {
    await semearBasePequena(repos, contaId, 300);
    await db.sql("update public.queue set status = 'sent', sent_at = now() where id in (select id from public.queue order by created_at limit 40)");
    await db.sql("update public.queue set status = 'failed', last_error = 'Erro de teste' where id in (select id from public.queue order by created_at desc limit 25)");

    for (const limite of [10, 50, 120]) {
      const antigo = (await db.sql(LIST_CONTACTS_ANTIGA, [limite, contaId])) as unknown[];
      const novo = await repos.listContacts(limite, contaId);
      assert.equal(novo.length, limite);
      assert.deepEqual(JSON.parse(JSON.stringify(novo)), JSON.parse(JSON.stringify(antigo)), `limite ${limite}`);
    }
    const semConta = (await db.sql(LIST_CONTACTS_ANTIGA, [30, null])) as unknown[];
    assert.deepEqual(JSON.parse(JSON.stringify(await repos.listContacts(30))), JSON.parse(JSON.stringify(semConta)));
  });

  test("getContactSummary devolve o mesmo resumo que a lista; id inexistente, inválido ou de outra conta dá null", async () => {
    const lista = await repos.listContacts(25, contaId);
    const alvo = lista[17];
    assert.deepEqual(await repos.getContactSummary(alvo.id, contaId), alvo);
    assert.deepEqual(await repos.getContactSummary(alvo.id), alvo);
    assert.equal(await repos.getContactSummary("00000000-0000-4000-8000-000000000000", contaId), null);
    assert.equal(await repos.getContactSummary("isso-nao-e-um-id", contaId), null);
    const outra = await seedAccount(db, { username: "outra", userId: "1002", isDefault: false, token: "IGAA-TESTE-OUTRA" });
    assert.equal(await repos.getContactSummary(alvo.id, outra), null);
  });

  test("5.000 contatos, 50.000 eventos e 5.000 itens de fila: listContacts(120) em menos de 1,5 s (melhor de 3)", async () => {
    await db.sql("delete from public.queue");
    await db.sql("delete from public.events");
    await db.sql("delete from public.contacts");
    await semearBaseGrande(db, contaId);
    const [contagem] = await db.sql<{ contatos: number; eventos: number; fila: number }>(
      "select (select count(*) from public.contacts)::int as contatos, (select count(*) from public.events)::int as eventos, (select count(*) from public.queue)::int as fila",
    );
    assert.deepEqual(contagem, { contatos: 5000, eventos: 50000, fila: 5000 });

    const tempos: number[] = [];
    let ultimo: Awaited<ReturnType<typeof repos.listContacts>> = [];
    for (let i = 0; i < 3; i += 1) {
      const inicio = performance.now();
      ultimo = await repos.listContacts(120, contaId);
      tempos.push(performance.now() - inicio);
    }
    const melhor = Math.min(...tempos);
    console.log(`# listContacts(120) com 5.000 contatos: ${tempos.map((t) => `${Math.round(t)} ms`).join(", ")}`);
    assert.equal(ultimo.length, 120);
    assert.equal(ultimo[0].instagram_user_id, "u1", "o mais recente primeiro");
    assert.equal(ultimo[0].event_count, 10);
    assert.ok(melhor < 1500, `melhor de 3: ${Math.round(melhor)} ms (limite 1500 ms)`);
  });

  test("o contato nº 4.000 aparece no resumo e a conversa abre (antes, só os 250 primeiros abriam)", async () => {
    const [alvo] = await db.sql<{ id: string }>("select id from public.contacts where instagram_user_id = 'u4000'");
    const inicio = performance.now();
    const resumo = await repos.getContactSummary(alvo.id, contaId);
    const { contact, messages } = await repos.getInboxConversation(alvo.id, contaId);
    const ms = Math.round(performance.now() - inicio);
    console.log(`# resumo + conversa do contato 4.000: ${ms} ms`);

    assert.equal(resumo?.instagram_username, "pessoa4000");
    assert.equal(resumo?.event_count, 10);
    assert.equal(contact?.id, alvo.id);
    assert.equal(messages.filter((mensagem) => mensagem.direction === "inbound").length, 10);
    assert.equal(messages.filter((mensagem) => mensagem.direction === "outbound").length, 1);
    assert.ok(ms < 1500);

    // A lista de 250 não traz o contato 4.000: ele só abre porque a conversa busca o contato pelo id.
    const primeiros = await repos.listContacts(250, contaId);
    assert.equal(primeiros.some((item) => item.id === alvo.id), false);
  });

  test("eventos da conversa: os mesmos da consulta antiga, com perfil e sem perfil (conta nula), sem misturar outro perfil", async () => {
    const outra = await seedAccount(db, { username: "outra_conv", userId: "1003", isDefault: false, token: "IGAA-TESTE-OUTRA-CONV" });
    assert.deepEqual(await conferirConversaIgualAntiga(db, repos, contaId, outra), [3, 3]);
  });

  test("conversa com id que não é de contato (endereço digitado errado) não quebra", async () => {
    assert.deepEqual(await repos.getInboxConversation("abc", contaId), { contact: null, messages: [] });
    assert.deepEqual(await repos.getInboxConversation(null, contaId), { contact: null, messages: [] });
  });
});
