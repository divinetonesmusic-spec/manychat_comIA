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
