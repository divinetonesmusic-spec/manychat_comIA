import "./helpers/env.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { seedAccount } from "./helpers/seed.mjs";

/**
 * Fase 6 · Tokens do Instagram num lugar só (public.instagram_accounts). A 0007 copia o token que só existia na tabela
 * antiga (public.config) e o app não lê nem grava mais a cópia. A tabela antiga não é apagada.
 */
const MIGRACAO_0007 = readFileSync(path.join(process.cwd(), "supabase", "migrations", "0007_fase6.sql"), "utf8");

// Banco "antes da 0007" (só para a migração; nada do app usa este) e banco completo (para o app). O do app vem por último:
// o pool do app lê DATABASE_URL ao carregar.
const antes: TestDatabase | null = semBanco ? null : await createTestDatabase({ ate: "0006" });
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();

after(async () => {
  await antes?.close();
  await db?.close();
});

describe("migração 0007: token só na tabela antiga vai para a das contas", { skip: semBanco }, () => {
  test("conta que só existia em public.config é copiada (vira a principal); colar de novo não duplica", async () => {
    await antes!.sql("delete from public.instagram_accounts");
    await antes!.sql(
      `update public.config set instagram_access_token = 'IGAA-TESTE-SO-NO-ESPELHO', instagram_user_id = '3001', instagram_username = 'antiga',
              token_expires_at = now() + interval '40 days' where id = true`,
    );
    await antes!.sql(MIGRACAO_0007);
    await antes!.sql(MIGRACAO_0007);
    const contas = await antes!.sql<{ instagram_user_id: string; instagram_access_token: string; instagram_username: string; is_default: boolean }>(
      "select instagram_user_id, instagram_access_token, instagram_username, is_default from public.instagram_accounts",
    );
    assert.deepEqual(contas, [{ instagram_user_id: "3001", instagram_access_token: "IGAA-TESTE-SO-NO-ESPELHO", instagram_username: "antiga", is_default: true }]);
    assert.equal((await antes!.sql("select 1 from public.config")).length, 1, "a tabela antiga continua lá");
  });

  test("conta que já existe não muda (o token da conta vale mais que a cópia antiga); outra principal continua principal", async () => {
    await antes!.sql("delete from public.instagram_accounts");
    await antes!.sql("insert into public.instagram_accounts (instagram_access_token, instagram_user_id, instagram_username, is_default) values ('IGAA-TESTE-NOVO', '3001', 'antiga', true)");
    await antes!.sql("update public.config set instagram_access_token = 'IGAA-TESTE-VELHO', instagram_user_id = '3001' where id = true");
    await antes!.sql(MIGRACAO_0007);
    const [conta] = await antes!.sql<{ instagram_access_token: string }>("select instagram_access_token from public.instagram_accounts");
    assert.equal(conta.instagram_access_token, "IGAA-TESTE-NOVO");

    await antes!.sql("update public.config set instagram_access_token = 'IGAA-TESTE-OUTRA', instagram_user_id = '3002', instagram_username = 'outra' where id = true");
    await antes!.sql(MIGRACAO_0007);
    const contas = await antes!.sql<{ instagram_username: string; is_default: boolean }>("select instagram_username, is_default from public.instagram_accounts order by instagram_username");
    assert.deepEqual(contas, [{ instagram_username: "antiga", is_default: true }, { instagram_username: "outra", is_default: false }]);
  });

  test("tabela antiga vazia: a 0007 não cria conta nenhuma", async () => {
    await antes!.sql("delete from public.instagram_accounts");
    await antes!.sql("update public.config set instagram_access_token = null, instagram_user_id = null where id = true");
    await antes!.sql(MIGRACAO_0007);
    assert.equal((await antes!.sql("select 1 from public.instagram_accounts")).length, 0);
  });
});

describe("o app não lê nem grava mais o token na tabela antiga", { skip: semBanco }, () => {
  test("sem conta em instagram_accounts, o token que sobrou na tabela antiga não é usado", async () => {
    const repos = await import("@/lib/db/repositories");
    await db!.sql("delete from public.instagram_accounts");
    await db!.sql("update public.config set instagram_access_token = 'IGAA-TESTE-ESPELHO', instagram_user_id = '9' where id = true");
    const config = await repos.getConfig();
    assert.equal(config.instagram_access_token, null);
    assert.equal(config.account_id, null);
  });

  test("perfil pedido que não existe: vazio (antes caía no token da tabela antiga)", async () => {
    const repos = await import("@/lib/db/repositories");
    await seedAccount(db!, { username: "ruthie", userId: "1001", token: "IGAA-TESTE-RUTHIE" });
    const config = await repos.getConfig("00000000-0000-0000-0000-000000000000");
    assert.equal(config.instagram_access_token, null);
  });

  test("conectar, trocar a principal e renovar o token não escrevem na tabela antiga", async () => {
    const repos = await import("@/lib/db/repositories");
    await db!.sql("delete from public.instagram_accounts");
    await db!.sql("update public.config set instagram_access_token = null, instagram_user_id = null, instagram_username = null where id = true");
    const conta = await repos.saveInstagramConfig({ accessToken: "IGAA-TESTE-CONECTADA", userId: "1002", username: "payoff" });
    const outra = await repos.saveInstagramConfig({ accessToken: "IGAA-TESTE-OUTRA", userId: "1003", username: "outra" });
    await repos.setDefaultInstagramAccount(outra.id);
    await repos.updateToken({ accessToken: "IGAA-TESTE-RENOVADA", expiresAt: new Date(Date.now() + 86_400_000), accountId: conta.id });
    const [config] = await db!.sql<{ instagram_access_token: string | null; instagram_user_id: string | null }>("select instagram_access_token, instagram_user_id from public.config where id = true");
    assert.deepEqual(config, { instagram_access_token: null, instagram_user_id: null });
    assert.equal((await repos.getConfig(conta.id)).instagram_access_token, "IGAA-TESTE-RENOVADA");
  });

  test("o código não fala mais com public.config", () => {
    assert.ok(!readFileSync("src/lib/db/repositories.ts", "utf8").match(/(from|into|update)\s+public\.config\b/));
  });
});
