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

  test("o registro do passo nunca mostra a URL do banco nem a senha da cópia (e a senha do banco fica escondida)", () => {
    const run = rodarCopia(dbUrl);
    assert.equal(run.status, 0, run.output);
    const senhaDoBanco = new URL(dbUrl).password;
    const linhas = run.output.split("\n");
    const publico = linhas.filter((linha) => !linha.startsWith("::add-mask::")).join("\n");
    assert.ok(!publico.includes(dbUrl));
    assert.ok(!publico.includes(senhaDoBanco));
    assert.ok(!run.output.includes(SENHA_DA_COPIA));
    assert.ok(linhas.includes(`::add-mask::${senhaDoBanco}`), "a senha do banco é escondida antes do pg_dump");
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

/**
 * Rodada 1: o pg_dump repete partes de uma URL mal formada no erro (ex.: `invalid percent-encoded token: "<senha>"`),
 * e o registro do GitHub é público. O passo nunca mostra o erro original: só uma mensagem fixa em português.
 * Também esconde (::add-mask::) o usuário e a senha, inteiros e em pedaços, antes do pg_dump.
 * Não precisa de banco: o pg_dump falha antes de conectar.
 */
const temPgDump = spawnSync("pg_dump", ["--version"]).status === 0;

describe("cópia: senha com caracteres especiais nunca aparece no registro", { skip: temPgDump ? false : "sem pg_dump instalado" }, () => {
  function rodar(url: string) {
    const bin = fakeCommands({ docker: FAKE_DOCKER });
    const run = runStep(loadWorkflow("backup.yml").step("copia"), {
      SUPABASE_DB_URL: url,
      BACKUP_PASSPHRASE: SENHA_DA_COPIA,
      DOCKER_FALSO_LOG: path.join(bin, "docker.log"),
    }, { fakeBin: bin });
    const linhas = run.output.split("\n");
    // O GitHub consome as linhas ::add-mask:: (não aparecem no registro); o resto é o que fica público.
    const mascaras = linhas.filter((linha) => linha.startsWith("::add-mask::")).map((linha) =>
      linha.slice("::add-mask::".length).replace(/%0A/g, "\n").replace(/%0D/g, "\r").replace(/%25/g, "%"));
    const publico = linhas.filter((linha) => !linha.startsWith("::add-mask::")).join("\n");
    return { ...run, mascaras, publico };
  }

  // pedacos: o que o passo tem que esconder além do usuário e da senha inteiros (partes da senha separadas por @ : / %, com 3+ letras).
  const casos = [
    { nome: "senha com %", credenciais: "postgres.abcdefgh:Abc%zzSEGREDO9", pedacos: ["Abc", "zzSEGREDO9"], erro: /mal formado/ },
    { nome: "senha com @", credenciais: "postgres.abcdefgh:abc@SEGREDO9", pedacos: ["abc", "SEGREDO9"], erro: /mal formado/ },
    { nome: "senha com : e /", credenciais: "postgres.abcdefgh:abc:de/SEGREDO9", pedacos: ["abc", "SEGREDO9"], erro: /mal formado/ },
  ];

  for (const caso of casos) {
    test(`${caso.nome}: o passo falha com mensagem fixa e nenhum pedaço da senha aparece`, () => {
      const run = rodar(`postgresql://${caso.credenciais}@127.0.0.1:55433/postgres?sslmode=disable`);
      assert.notEqual(run.status, 0);
      assert.equal(run.outputs.arquivo, undefined, "sem arquivo para o upload");
      assert.match(run.publico, /::error title=A cópia falhou::/);
      assert.match(run.publico, caso.erro);
      // Onda final: aponta para a tabela de códigos (ou senha só com letras e números), não para copiar a mesma URL de novo.
      assert.match(run.publico, /escreva cada um em código \(tabela na Parte 5 do docs\/AVISOS_E_COPIA\.md\) ou troque a senha do banco por uma só com letras e números/);
      assert.doesNotMatch(run.publico, /copie o DATABASE_URL/);
      const senha = caso.credenciais.slice(caso.credenciais.indexOf(":") + 1);
      for (const pedaco of [senha, ...caso.pedacos, "SEGREDO", "abc:de", "Abc%zz"]) {
        assert.ok(!run.publico.includes(pedaco), `"${pedaco}" apareceu no registro:\n${run.publico}`);
      }
      assert.ok(!run.publico.includes("abcdefgh"), "nem o usuário");
    });

    test(`${caso.nome}: usuário e senha são escondidos (::add-mask::) inteiros e em pedaços`, () => {
      const run = rodar(`postgresql://${caso.credenciais}@127.0.0.1:55433/postgres?sslmode=disable`);
      const esperado = [caso.credenciais, caso.credenciais.slice(caso.credenciais.indexOf(":") + 1), "postgres.abcdefgh", ...caso.pedacos];
      for (const valor of esperado) assert.ok(run.mascaras.includes(valor), `faltou esconder "${valor}" (escondidos: ${JSON.stringify(run.mascaras)})`);
    });
  }

  test("senha certa porém recusada (password authentication failed): mensagem fixa sobre usuário ou senha", () => {
    const bin = fakeCommands({
      docker: 'echo "pg_dump: error: connection to server failed: FATAL:  password authentication failed for user \\"postgres.abcdefgh\\" senha=SEGREDO9" >&2; exit 1',
    });
    const run = runStep(loadWorkflow("backup.yml").step("copia"), {
      SUPABASE_DB_URL: "postgresql://postgres.abcdefgh:SEGREDO9@banco.invalid:5432/postgres",
      BACKUP_PASSPHRASE: SENHA_DA_COPIA,
    }, { fakeBin: bin });
    const publico = run.output.split("\n").filter((linha) => !linha.startsWith("::add-mask::")).join("\n");
    assert.notEqual(run.status, 0);
    assert.match(publico, /::error title=A cópia falhou::O Supabase recusou o usuário ou a senha/);
    assert.ok(!publico.includes("SEGREDO9"));
    assert.ok(!publico.includes("abcdefgh"));
  });
});
