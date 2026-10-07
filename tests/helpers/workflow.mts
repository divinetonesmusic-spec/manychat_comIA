import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Workflows do GitHub Actions nos testes: lê o YAML de verdade e roda os scripts dos passos aqui,
 * do jeito que o GitHub roda (bash -e, ou bash -eo pipefail com `shell: bash`), com comandos falsos
 * (curl, docker) na frente do PATH. Nada sai para a internet.
 * O js-yaml já vem instalado com o eslint (dependência de desenvolvimento); createRequire evita pedir tipos.
 */
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (text: string) => unknown };

export type Step = { id?: string; name?: string; run?: string; uses?: string; shell?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> };
export type Job = {
  "runs-on": string;
  steps: Step[];
  services?: Record<string, { image: string; env?: Record<string, string>; ports?: string[] }>;
  env?: Record<string, string>;
  permissions?: Record<string, string>;
};
export type Workflow = { name: string; on: Record<string, unknown>; jobs: Record<string, Job>; permissions?: Record<string, string> };

export function loadWorkflow(file: string) {
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
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
  const step = (id: string) => {
    const found = steps.find((candidate) => candidate.id === id);
    assert.ok(found, `${file}: passo com id "${id}" não encontrado`);
    return found;
  };
  return { text, workflow, steps, step };
}

/** Confere a sintaxe de cada script com `bash -n` (as expressões ${{ }} viram texto fixo). */
export function assertBashSyntax(file: string, steps: Step[]) {
  for (const step of steps) {
    if (!step.run) continue;
    const script = step.run.replace(/\$\{\{[^}]*\}\}/g, "EXPRESSAO_DO_GITHUB");
    const result = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    assert.equal(result.status, 0, `${file} › "${step.name ?? step.run.slice(0, 40)}": erro de sintaxe no bash\n${result.stderr}`);
  }
}

export type StepRun = { status: number | null; output: string; outputs: Record<string, string>; dir: string };

/**
 * Roda o script de um passo como o GitHub roda: `bash -e` (padrão) ou `bash -eo pipefail` (`shell: bash`).
 * `env` substitui o `env:` do passo (as expressões ${{ }} não existem aqui). GITHUB_OUTPUT vira um arquivo temporário.
 */
export function runStep(step: Step, env: Record<string, string | undefined>, options: { fakeBin?: string; cwd?: string } = {}): StepRun {
  assert.ok(step.run, "passo sem run");
  assert.doesNotMatch(step.run, /\$\{\{/, "o script não deve ter expressões ${{ }} (use env:)");
  const dir = options.cwd ?? mkdtempSync(path.join(tmpdir(), "uaiflow-passo-"));
  const outputFile = path.join(dir, "github-output.txt");
  writeFileSync(outputFile, "");
  const scriptFile = path.join(dir, "passo.sh");
  writeFileSync(scriptFile, step.run);
  const args = step.shell === "bash" ? ["--noprofile", "--norc", "-eo", "pipefail", scriptFile] : ["-e", scriptFile];
  const basePath = process.env.PATH ?? "/usr/bin:/bin";
  const fullEnv: Record<string, string> = { PATH: options.fakeBin ? `${options.fakeBin}:${basePath}` : basePath, HOME: process.env.HOME ?? dir, GITHUB_OUTPUT: outputFile };
  for (const [key, value] of Object.entries(env)) if (value !== undefined) fullEnv[key] = value;
  const result = spawnSync("bash", args, { cwd: dir, env: fullEnv as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000 });
  const outputs: Record<string, string> = {};
  for (const line of readFileSync(outputFile, "utf8").split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) outputs[line.slice(0, index)] = line.slice(index + 1);
  }
  return { status: result.status, output: `${result.stdout}${result.stderr}`, outputs, dir };
}

/** Pasta com comandos falsos (nome → script bash), para pôr na frente do PATH. */
export function fakeCommands(commands: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "uaiflow-bin-"));
  for (const [name, script] of Object.entries(commands)) {
    const file = path.join(dir, name);
    writeFileSync(file, `#!/usr/bin/env bash\n${script}\n`);
    chmodSync(file, 0o755);
  }
  return dir;
}

/**
 * curl falso: o /api/health devolve CURL_FALSO_CODIGO e CURL_FALSO_CORPO (código 000 = site fora do ar);
 * os envios ao Telegram ficam registrados em $CURL_FALSO_DIR/telegram.log (argumentos separados por \0).
 */
export const FAKE_CURL = String.raw`
out=""; url=""; args=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w|--max-time|--retry|--retry-delay|-X|-d|--data|--data-urlencode|-H) shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  https://api.telegram.org/*)
    printf '%s\0' "${"$"}{args[@]}" >> "$CURL_FALSO_DIR/telegram.log"
    printf '\n' >> "$CURL_FALSO_DIR/telegram.log"
    [ -n "$out" ] && echo '{"ok":true}' > "$out"
    printf '200'
    ;;
  *)
    echo "$url" >> "$CURL_FALSO_DIR/urls.log"
    if [ "$CURL_FALSO_CODIGO" = "000" ]; then printf '000'; echo "curl: (7) Failed to connect" >&2; exit 7; fi
    printf '%s' "$CURL_FALSO_CORPO" > "$out"
    printf '%s' "$CURL_FALSO_CODIGO"
    ;;
esac
`;

/** docker falso: "docker run --rm -e VAR ... IMAGEM comando" roda o comando aqui, só com as variáveis passadas por -e. */
export const FAKE_DOCKER = String.raw`
set -eu
[ "$1" = "run" ] || { echo "docker falso: só sei 'run'" >&2; exit 2; }
shift
vars=("PATH=$PATH")
image=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rm) shift ;;
    -e) name="$2"
        case "$name" in *=*) echo "docker falso: valor na linha de comando (-e $name)" >&2; exit 3 ;; esac
        vars+=("$name=${"$"}{!name-}"); shift 2 ;;
    -*) echo "docker falso: opção não prevista $1" >&2; exit 2 ;;
    *) image="$1"; shift; break ;;
  esac
done
echo "$image" >> "$DOCKER_FALSO_LOG"
exec env -i "${"$"}{vars[@]}" "$@"
`;

/** Lê os envios registrados pelo curl falso: cada envio vira a lista de argumentos. */
export function telegramCalls(dir: string) {
  let text = "";
  try {
    text = readFileSync(path.join(dir, "telegram.log"), "utf8");
  } catch {
    return [];
  }
  return text.split("\0\n").filter(Boolean).map((call) => call.split("\0"));
}
