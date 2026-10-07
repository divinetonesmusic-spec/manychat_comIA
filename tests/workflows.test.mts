import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Workflows do GitHub Actions: o YAML tem que ser válido e cada script tem que passar no `bash -n`.
 * O js-yaml já vem instalado com o eslint (dependência de desenvolvimento); createRequire evita pedir tipos.
 */
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (text: string) => unknown };

type Step = { name?: string; run?: string; uses?: string; shell?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { "runs-on": string; steps: Step[]; services?: Record<string, { image: string; env?: Record<string, string>; ports?: string[] }>; env?: Record<string, string>; container?: unknown };
type Workflow = { name: string; on: Record<string, unknown>; jobs: Record<string, Job>; env?: Record<string, string> };

function loadWorkflow(file: string) {
  const text = readFileSync(`.github/workflows/${file}`, "utf8");
  const workflow = yaml.load(text) as Workflow;
  assert.ok(workflow && typeof workflow === "object", `${file}: YAML vazio`);
  assert.ok(workflow.name, `${file}: sem nome`);
  assert.ok(workflow.on, `${file}: sem gatilho (on)`);
  assert.ok(workflow.jobs && Object.keys(workflow.jobs).length, `${file}: sem jobs`);
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    assert.ok(job["runs-on"], `${file}/${jobName}: sem runs-on`);
    assert.ok(Array.isArray(job.steps) && job.steps.length, `${file}/${jobName}: sem passos`);
    for (const step of job.steps) assert.ok(step.run || step.uses, `${file}/${jobName}: passo sem run nem uses`);
  }
  return { text, workflow, steps: Object.values(workflow.jobs).flatMap((job) => job.steps) };
}

/** Confere a sintaxe de cada script com `bash -n` (as expressões ${{ }} viram texto fixo). */
function assertBashSyntax(file: string, steps: Step[]) {
  for (const step of steps) {
    if (!step.run) continue;
    const script = step.run.replace(/\$\{\{[^}]*\}\}/g, "EXPRESSAO_DO_GITHUB");
    const result = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    assert.equal(result.status, 0, `${file} › "${step.name ?? step.run.slice(0, 40)}": erro de sintaxe no bash\n${result.stderr}`);
  }
}

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
