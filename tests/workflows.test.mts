import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FAKE_CURL, assertBashSyntax, fakeCommands, loadWorkflow, runStep, telegramCalls } from "./helpers/workflow.mjs";

/** Workflows do GitHub Actions: YAML válido, scripts com sintaxe certa e o comportamento dos scripts com comandos falsos. */

describe("CI (.github/workflows/ci.yml)", () => {
  const { workflow, steps } = loadWorkflow("ci.yml");

  test("continua com o que já existia: release:check, lint, tsc e build", () => {
    const runs = workflow.jobs.quality.steps.map((step) => step.run ?? "");
    for (const comando of ["npm ci", "npm run release:check", "npm run lint", "npx tsc --noEmit", "npm run build"]) {
      assert.ok(runs.includes(comando), `falta "${comando}"`);
    }
  });

  test("roda o npm test com Postgres 16 e TEST_DATABASE_URL, e falha se algum teste for pulado", () => {
    const job = Object.values(workflow.jobs).find((candidate) => candidate.steps.some((step) => /\bnpm test\b/.test(step.run ?? "")));
    assert.ok(job, "nenhum job roda npm test");
    assert.equal(job.services?.postgres?.image, "postgres:16");
    assert.ok(job.services?.postgres?.ports?.includes("5432:5432"));
    assert.match(job.env?.TEST_DATABASE_URL ?? "", /^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:5432\/postgres$/);
    assert.equal(job.env?.TESTES_EXIGEM_BANCO, "1", "sem banco, os testes de banco falham em vez de serem pulados");
    const passo = job.steps.find((step) => /\bnpm test\b/.test(step.run ?? ""));
    assert.equal(passo?.shell, "bash", "shell: bash liga o pipefail (o tee não esconde a falha)");
    assert.match(passo?.run ?? "", /SKIP/, "confere que nada foi pulado");
    const pgDump = job.steps.findIndex((step) => /pg_dump --version/.test(step.run ?? ""));
    assert.ok(pgDump >= 0 && pgDump < job.steps.indexOf(passo!), "garante o pg_dump (teste da cópia do banco) antes do npm test");
    const setupNode = job.steps.find((step) => step.uses?.startsWith("actions/setup-node"));
    assert.ok(Number(setupNode?.with?.["node-version"]) >= 20, "Node 20 ou mais novo (--import tsx)");
  });

  test("scripts com sintaxe válida", () => assertBashSyntax("ci.yml", steps));
});

describe("trava dos testes de banco na CI", () => {
  test("com TESTES_EXIGEM_BANCO=1 e sem TEST_DATABASE_URL, o teste de banco falha em vez de ser pulado", () => {
    const env = { ...process.env, TESTES_EXIGEM_BANCO: "1" } as NodeJS.ProcessEnv;
    delete env.TEST_DATABASE_URL;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "await import('./tests/helpers/db.mts')"], { env, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TESTES_EXIGEM_BANCO/);
  });
});

describe("monitor (.github/workflows/monitor.yml)", () => {
  const { text, workflow, steps, step } = loadWorkflow("monitor.yml");
  const TOKEN = "123456789:TESTE-token-falso-do-robo";

  /** Roda o passo do monitor com o curl falso respondendo o /api/health. */
  function rodarMonitor(resposta: { codigo: string; corpo?: unknown }, telegram: boolean) {
    const dir = mkdtempSync(path.join(tmpdir(), "uaiflow-monitor-"));
    const bin = fakeCommands({ curl: FAKE_CURL });
    const result = runStep(step("saude"), {
      UAIFLOW_URL: "https://uaiflow.teste/",
      TELEGRAM_BOT_TOKEN: telegram ? TOKEN : "",
      TELEGRAM_CHAT_ID: telegram ? "987654321" : "",
      CURL_FALSO_DIR: dir,
      CURL_FALSO_CODIGO: resposta.codigo,
      CURL_FALSO_CORPO: typeof resposta.corpo === "string" ? resposta.corpo : JSON.stringify(resposta.corpo ?? {}),
    }, { fakeBin: bin });
    return { ...result, telegram: telegramCalls(dir), urls: spawnSync("cat", [path.join(dir, "urls.log")], { encoding: "utf8" }).stdout };
  }

  test("roda a cada hora no minuto 17 e também na mão (workflow_dispatch)", () => {
    assert.deepEqual(workflow.on.schedule, [{ cron: "17 * * * *" }]);
    assert.ok("workflow_dispatch" in workflow.on);
  });

  test("o endereço vem de vars.UAIFLOW_URL, com o site no ar como padrão; o Telegram só pelos segredos", () => {
    const saude = step("saude");
    assert.equal(saude.env?.UAIFLOW_URL, "${{ vars.UAIFLOW_URL || 'https://uaiflow-divinetones.netlify.app' }}");
    assert.equal(saude.env?.TELEGRAM_BOT_TOKEN, "${{ secrets.TELEGRAM_BOT_TOKEN }}");
    assert.equal(saude.env?.TELEGRAM_CHAT_ID, "${{ secrets.TELEGRAM_CHAT_ID }}");
    assert.doesNotMatch(saude.run ?? "", /secrets\./, "segredos só pelo env:, nunca dentro do script");
    assert.match(text, /permissions:\s*\n\s*contents: read/);
  });

  test("scripts com sintaxe válida", () => assertBashSyntax("monitor.yml", steps));

  test("site ok: termina com sucesso e não manda aviso", () => {
    const run = rodarMonitor({ codigo: "200", corpo: { ok: true, relogio: { ultimaVez: "2026-10-07T12:00:00.000Z", minutos: 1 }, tokens: { menorPrazoDias: 40 } } }, true);
    assert.equal(run.status, 0, run.output);
    assert.equal(run.urls.trim(), "https://uaiflow.teste/api/health");
    assert.equal(run.telegram.length, 0);
    assert.match(run.output, /relógio rodou há 1 min/);
  });

  test("relógio parado (503): manda 1 aviso no Telegram com o motivo e termina com falha", () => {
    const motivo = "O relógio (publicação e fila de mensagens) não roda há 42 minutos. Confira o pg_cron no Supabase.";
    const run = rodarMonitor({ codigo: "503", corpo: { ok: false, motivo, relogio: { ultimaVez: null, minutos: 42 }, tokens: { menorPrazoDias: 30 } } }, true);
    assert.equal(run.status, 1);
    assert.equal(run.telegram.length, 1);
    const args = run.telegram[0];
    assert.ok(args.includes(`https://api.telegram.org/bot${TOKEN}/sendMessage`));
    assert.ok(args.includes("chat_id=987654321"));
    assert.ok(args.includes("disable_web_page_preview=true"));
    const texto = args.find((arg) => arg.startsWith("text="));
    assert.equal(texto, `text=UaiFlow: o monitor achou um problema.\nMotivo: ${motivo}\nDetalhes: https://uaiflow.teste/api/health`);
    assert.doesNotMatch(run.output, /TESTE-token-falso/, "o script não escreve o token no registro");
  });

  test("site fora do ar e sem os segredos do Telegram: termina com falha (o GitHub manda e-mail) sem tentar avisar", () => {
    const run = rodarMonitor({ codigo: "000" }, false);
    assert.equal(run.status, 1);
    assert.equal(run.telegram.length, 0);
    assert.match(run.output, /O site não respondeu/);
  });

  test("resposta que não é o relatório de saúde (ex.: página de erro do Netlify): falha com o código", () => {
    const run = rodarMonitor({ codigo: "502", corpo: "<html>Bad Gateway</html>" }, true);
    assert.equal(run.status, 1);
    assert.equal(run.telegram.length, 1);
    assert.match(run.telegram[0].find((arg) => arg.startsWith("text=")) ?? "", /Motivo: O site respondeu com erro 502/);
  });
});

describe("cópia semanal do banco (.github/workflows/backup.yml)", () => {
  const { workflow, steps, step } = loadWorkflow("backup.yml");

  test("roda todo domingo às 06:23 UTC e também na mão", () => {
    assert.deepEqual(workflow.on.schedule, [{ cron: "23 6 * * 0" }]);
    assert.ok("workflow_dispatch" in workflow.on);
    assert.deepEqual(workflow.permissions, { contents: "read" });
  });

  test("pg_dump do Postgres 17 (imagem postgres:17), sem dono nem permissões, gzip e openssl com a senha pelo ambiente", () => {
    const copia = step("copia").run ?? "";
    assert.match(copia, /docker run --rm -e SUPABASE_DB_URL postgres:17 /);
    assert.match(copia, /pg_dump [^\n]*--no-owner --no-privileges/);
    assert.match(copia, /\| gzip -9 \\\n\s*\| openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -pass env:BACKUP_PASSPHRASE -out "\$arquivo"/);
    assert.equal(step("copia").shell, "bash", "pipefail: se o pg_dump falhar, o passo falha");
  });

  test("guarda só o arquivo criptografado, por 90 dias, e só quando a cópia deu certo", () => {
    const upload = steps.find((candidate) => candidate.uses?.startsWith("actions/upload-artifact@"));
    assert.ok(upload);
    assert.equal(upload.if, "steps.segredos.outputs.fazer == 'sim'");
    assert.equal(upload.with?.path, "${{ steps.copia.outputs.arquivo }}");
    assert.equal(upload.with?.["retention-days"], 90);
    assert.equal(upload.with?.["if-no-files-found"], "error");
    assert.match(step("copia").run ?? "", /arquivo="\$nome\.sql\.gz\.enc"/);
  });

  test("nenhum passo imprime a URL do banco", () => {
    for (const candidate of steps) {
      const run = candidate.run ?? "";
      assert.doesNotMatch(run, /secrets\./, `"${candidate.name}": segredo dentro do script (use env:)`);
      assert.doesNotMatch(run, /set -x|set -o xtrace|bash -x/, `"${candidate.name}": modo que imprime os comandos`);
      assert.doesNotMatch(run, /\bprintenv\b|^\s*env\s*$|\bdeclare -p\b|^\s*set\s*$/m, `"${candidate.name}": comando que lista as variáveis`);
      // Cada lugar onde o valor da variável é usado ($SUPABASE_DB_URL) ou repassado (-e SUPABASE_DB_URL).
      const usos = run.split("\n").filter((text) => /\$\{?SUPABASE_DB_URL|-e SUPABASE_DB_URL/.test(text));
      for (const line of usos) {
        const permitido =
          /^\s*if \[ -z "\$SUPABASE_DB_URL" \]; then$/.test(line) ||
          /^\s*docker run --rm -e SUPABASE_DB_URL postgres:17 \\$/.test(line) ||
          /^\s*sh -c 'exec pg_dump --dbname="\$SUPABASE_DB_URL" [^']*' 2> "\$erros" \\$/.test(line) ||
          /^\s*credenciais="\$\{SUPABASE_DB_URL#\*:\/\/\}"$/.test(line) ||
          /^\s*#/.test(line);
        assert.ok(permitido, `"${candidate.name}": uso não previsto da URL do banco: ${line.trim()}`);
      }
    }
    // O erro do pg_dump vai para um arquivo que nunca é mostrado: só "grep -q" (classificar) e "rm -f".
    const copia = step("copia").run ?? "";
    for (const line of copia.split("\n").filter((text) => text.includes("$erros"))) {
      const permitido =
        /^\s*erros="[^"$]+"$/.test(line) ||
        /' 2> "\$erros" \\$/.test(line) ||
        /\bgrep -Eqi? '[^']+' "\$erros"/.test(line) ||
        /^\s*rm -f "\$erros"$/.test(line);
      assert.ok(permitido, `uso não previsto do arquivo de erros do pg_dump: ${line.trim()}`);
    }
    for (const candidate of steps) {
      for (const [name, value] of Object.entries(candidate.env ?? {})) {
        if (value.includes("secrets.SUPABASE_DB_URL")) assert.equal(name, "SUPABASE_DB_URL");
      }
    }
  });

  test("scripts com sintaxe válida", () => assertBashSyntax("backup.yml", steps));

  test("sem SUPABASE_DB_URL: só avisa e termina com sucesso (nada é copiado)", () => {
    const run = runStep(step("segredos"), { SUPABASE_DB_URL: "", BACKUP_PASSPHRASE: "" });
    assert.equal(run.status, 0, run.output);
    assert.equal(run.outputs.fazer, "nao");
    assert.match(run.output, /::warning.*SUPABASE_DB_URL/);
  });

  test("com SUPABASE_DB_URL e sem BACKUP_PASSPHRASE: falha com mensagem clara (nunca sobe sem criptografia)", () => {
    const run = runStep(step("segredos"), { SUPABASE_DB_URL: "postgresql://usuario:senha-teste@banco.invalid:5432/postgres", BACKUP_PASSPHRASE: "" });
    assert.equal(run.status, 1);
    assert.equal(run.outputs.fazer, undefined);
    assert.match(run.output, /::error.*BACKUP_PASSPHRASE.*nunca sobe sem criptografia/);
    assert.doesNotMatch(run.output, /senha-teste|banco\.invalid/);
  });

  test("com os dois segredos: segue para a cópia", () => {
    const run = runStep(step("segredos"), { SUPABASE_DB_URL: "postgresql://usuario:senha-teste@banco.invalid:5432/postgres", BACKUP_PASSPHRASE: "uma senha forte" });
    assert.equal(run.status, 0);
    assert.equal(run.outputs.fazer, "sim");
    assert.doesNotMatch(run.output, /senha-teste|banco\.invalid/);
  });

  test("se algo falhar: aviso no Telegram com o link da execução (se os segredos existirem)", () => {
    const aviso = steps.find((candidate) => candidate.if === "failure()");
    assert.ok(aviso?.run);
    const dir = mkdtempSync(path.join(tmpdir(), "uaiflow-backup-"));
    const run = runStep(aviso, {
      TELEGRAM_BOT_TOKEN: "123456789:TESTE-token-falso-do-robo",
      TELEGRAM_CHAT_ID: "987654321",
      EXECUCAO_URL: "https://github.com/dono/repo/actions/runs/1",
      CURL_FALSO_DIR: dir,
    }, { fakeBin: fakeCommands({ curl: FAKE_CURL }) });
    assert.equal(run.status, 0, run.output);
    const [chamada] = telegramCalls(dir);
    assert.ok(chamada?.includes("chat_id=987654321"));
    assert.equal(chamada.find((arg) => arg.startsWith("text=")), "text=UaiFlow: a cópia semanal do banco falhou.\nVeja o que aconteceu: https://github.com/dono/repo/actions/runs/1");

    const semSegredos = runStep(aviso, { TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", EXECUCAO_URL: "x", CURL_FALSO_DIR: dir }, { fakeBin: fakeCommands({ curl: FAKE_CURL }) });
    assert.equal(semSegredos.status, 0);
    assert.equal(telegramCalls(dir).length, 1, "sem os segredos não tenta mandar");
  });
});
