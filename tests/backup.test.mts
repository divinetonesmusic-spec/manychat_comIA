import "./helpers/env.mjs";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { FAKE_DOCKER, fakeCommands, loadWorkflow, runStep } from "./helpers/workflow.mjs";

/**
 * Cópia semanal (backup.yml) de ponta a ponta, sem internet: o passo "copia" roda de verdade com um docker
 * falso que executa o pg_dump daqui (com só as variáveis passadas por -e) contra o banco de teste.
 * gzip e openssl são os de verdade. Depois a cópia é aberta com o comando do docs/AVISOS_E_COPIA.md.
 */
const SENHA_DA_COPIA = "senha da copia para o teste 123";

describe("cópia semanal do banco (passo de cópia de verdade)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let dbUrl: string;

  before(async () => {
    db = await createTestDatabase();
    const url = new URL(db.url);
    if (!url.password) url.password = "senha-do-banco-que-nao-pode-vazar"; // Postgres local sem senha (trust) aceita qualquer uma
    dbUrl = url.toString();
  });

  after(async () => {
    await db?.close();
  });

  function rodarCopia(url: string) {
    const bin = fakeCommands({ docker: FAKE_DOCKER });
    const dockerLog = path.join(bin, "docker.log");
    const run = runStep(loadWorkflow("backup.yml").step("copia"), {
      SUPABASE_DB_URL: url,
      BACKUP_PASSPHRASE: SENHA_DA_COPIA,
      DOCKER_FALSO_LOG: dockerLog,
    }, { fakeBin: bin });
    return { ...run, imagens: existsSync(dockerLog) ? readFileSync(dockerLog, "utf8").trim().split("\n") : [] };
  }

  test("gera o arquivo criptografado (.sql.gz.enc) que abre com a senha e tem as tabelas do UaiFlow", () => {
    const run = rodarCopia(dbUrl);
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.imagens, ["postgres:17"]);
    assert.match(run.outputs.arquivo, /^uaiflow-banco-\d{4}-\d{2}-\d{2}\.sql\.gz\.enc$/);
    assert.equal(`${run.outputs.nome}.sql.gz.enc`, run.outputs.arquivo);

    const arquivo = path.join(run.dir, run.outputs.arquivo);
    const bruto = readFileSync(arquivo);
    assert.equal(bruto.subarray(0, 8).toString("latin1"), "Salted__", "criptografado pelo openssl (com sal)");
    assert.ok(!bruto.includes(Buffer.from("content_posts")), "nada legível no arquivo");

    // Mesmo comando do docs/AVISOS_E_COPIA.md (lá a senha é digitada; aqui vem pelo ambiente).
    const gz = execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-md", "sha256", "-in", arquivo, "-pass", "env:SENHA"], { env: { ...process.env, SENHA: SENHA_DA_COPIA } as NodeJS.ProcessEnv });
    const sql = execFileSync("gunzip", ["-c"], { input: gz }).toString("utf8");
    assert.match(sql, /CREATE TABLE public\.content_posts/);
    assert.match(sql, /CREATE TABLE public\.app_status/);
    assert.doesNotMatch(sql, /CREATE TABLE auth\./, "só o schema public");
    assert.doesNotMatch(sql, /OWNER TO|GRANT /, "--no-owner --no-privileges");

    const errada = spawnSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-md", "sha256", "-in", arquivo, "-pass", "pass:senha errada"]);
    assert.notEqual(errada.status, 0, "senha errada não abre");
  });

  test("o registro do passo nunca mostra a URL do banco nem a senha da cópia", () => {
    const run = rodarCopia(dbUrl);
    const senhaDoBanco = new URL(dbUrl).password;
    assert.ok(!run.output.includes(dbUrl));
    assert.ok(!run.output.includes(`:${senhaDoBanco}@`));
    assert.ok(!run.output.includes(SENHA_DA_COPIA));
  });

  test("banco inacessível: o passo falha (nada para guardar) e o erro não mostra a URL", () => {
    const errada = new URL(dbUrl);
    errada.pathname = "/banco_que_nao_existe";
    const run = rodarCopia(errada.toString());
    assert.notEqual(run.status, 0);
    assert.equal(run.outputs.arquivo, undefined, "sem arquivo para o upload");
    assert.ok(!run.output.includes(errada.toString()));
    assert.ok(!run.output.includes(`:${errada.password}@`));
  });
});
