import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import {
  cancelJob,
  decideJob,
  failJob,
  finishJob,
  forceCost,
  heartbeatJob,
  jobView,
  requestApproval,
  retryJob,
  type JobRow,
  type WorkerOutcome,
} from "@/lib/molde/jobs";
import { answer, failure, FORCE_PHRASE, jsonObject, parsePreview, readBody, text, UUID, workerName } from "@/lib/molde/jobs-http";
import { decisionLine, reflectJobDecision, sendJobApproval } from "@/lib/telegram/approvals";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string; acao: string }> };

const NOT_FOUND = "Trabalho não encontrado.";

/**
 * POST /api/molde/jobs/<id>/<acao>
 * Do robô (precisam de `worker`, o mesmo nome que pegou o trabalho):
 *   batimento { worker, etapa?, progresso? }   renova o prazo de 10 min e grava o andamento
 *   concluir  { worker, resultado? }           "pronto"
 *   erro      { worker, erro, tentarDeNovo? }  "erro" (ou de volta à fila, se tentarDeNovo e ainda há tentativas)
 *   aprovacao { worker, previa, resultado? }   "esperando_aprovacao" + mensagem no Telegram com «Aprovar» / «Refazer»
 * Da página:
 *   decidir   { decisao: "aprovar" | "refazer", nota?, por?, rodada? }
 *   cancelar  {}
 *   repetir   {}                               depois de "erro" ou "cancelado": volta para a fila do começo
 *   forcar    { confirmo: "passar do teto" }   este trabalho pode passar do teto de gastos do mês
 * Detalhes e exemplos: docs/API_MOLDE_JOBS.md.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id, acao } = await params;
  const body = await readBody(request);
  if (!UUID.test(id)) return answer(NOT_FOUND, 404);

  try {
    switch (acao) {
      case "batimento": {
        const worker = workerName(body.worker);
        if (!worker) return answer("Falta o nome do Mac (worker).", 400);
        const etapa = body.etapa === undefined || body.etapa === null ? null : text(body.etapa, 120);
        if (body.etapa !== undefined && body.etapa !== null && !etapa) return answer("A etapa precisa ter de 1 a 120 letras.", 400);
        const progresso = body.progresso === undefined || body.progresso === null ? null : Number(body.progresso);
        if (progresso !== null && (!Number.isFinite(progresso) || progresso < 0 || progresso > 100)) return answer("O progresso precisa ser um número de 0 a 100.", 400);
        return workerAnswer(await heartbeatJob(id, worker, { etapa, progresso: progresso === null ? null : Math.round(progresso) }));
      }
      case "concluir": {
        const worker = workerName(body.worker);
        if (!worker) return answer("Falta o nome do Mac (worker).", 400);
        const resultado = jsonObject(body.resultado);
        if (resultado === null) return answer("O resultado precisa ser um objeto JSON de até 64 KB.", 400);
        return workerAnswer(await finishJob(id, worker, resultado ?? null));
      }
      case "erro": {
        const worker = workerName(body.worker);
        if (!worker) return answer("Falta o nome do Mac (worker).", 400);
        const erro = text(body.erro, 1000);
        if (!erro) return answer("Mande o erro (uma frase em português, até 1000 letras).", 400);
        return workerAnswer(await failJob(id, worker, erro, body.tentarDeNovo === true));
      }
      case "aprovacao": {
        const worker = workerName(body.worker);
        if (!worker) return answer("Falta o nome do Mac (worker).", 400);
        const previa = parsePreview(body.previa);
        if ("error" in previa) return answer(previa.error, 400);
        const resultado = jsonObject(body.resultado);
        if (resultado === null) return answer("O resultado precisa ser um objeto JSON de até 64 KB.", 400);
        const outcome = await requestApproval(id, worker, previa, resultado ?? null);
        if (!outcome.ok) return workerAnswer(outcome);
        // A mensagem com «Aprovar» / «Refazer» sai agora; se o Telegram falhar, o relógio tenta de novo em alguns minutos.
        const telegram = await sendJobApproval(id);
        return NextResponse.json({ data: jobView(outcome.job), telegram });
      }
      case "decidir": {
        const decisao = body.decisao;
        if (decisao !== "aprovar" && decisao !== "refazer") return answer('Decisão inválida. Use "aprovar" ou "refazer".', 400);
        const nota = body.nota === undefined || body.nota === null || body.nota === "" ? null : text(body.nota, 1000);
        if (body.nota && !nota) return answer("A nota precisa ter até 1000 letras.", 400);
        const por = body.por === undefined || body.por === null ? null : text(body.por, 80);
        const rodada = body.rodada === undefined || body.rodada === null ? null : Number(body.rodada);
        if (rodada !== null && !Number.isInteger(rodada)) return answer("rodada inválida.", 400);
        const outcome = await decideJob(id, { decisao, via: "pagina", por, nota, rodada });
        if (outcome.ok) {
          await reflectJobDecision(outcome.job, { timeoutMs: 4000 });
          return NextResponse.json({ data: jobView(outcome.job) });
        }
        if (outcome.motivo === "not-found") return answer(NOT_FOUND, 404);
        if (outcome.motivo === "already") {
          return answer(`Este trabalho já foi decidido: ${decisionLine(outcome.job.aprovacao!)}`, 409, { data: jobView(outcome.job) });
        }
        if (outcome.motivo === "old-round") return answer("Esta prévia é antiga: o Molde já mandou outra. Veja a mais nova.", 409, { data: jobView(outcome.job) });
        return answer("Este trabalho não está esperando aprovação.", 409, { data: jobView(outcome.job) });
      }
      case "cancelar": {
        const outcome = await cancelJob(id);
        if (outcome.ok) return NextResponse.json({ data: jobView(outcome.job) });
        if (outcome.motivo === "not-found") return answer(NOT_FOUND, 404);
        return answer("Este trabalho já terminou; não dá mais para cancelar.", 409, { data: jobView(outcome.job) });
      }
      case "repetir": {
        const outcome = await retryJob(id);
        if (outcome.ok) return NextResponse.json({ data: jobView(outcome.job) });
        if (outcome.motivo === "not-found") return answer(NOT_FOUND, 404);
        return answer('Só dá para tentar de novo um trabalho com "erro" ou "cancelado".', 409, { data: jobView(outcome.job) });
      }
      case "forcar": {
        if (body.confirmo !== FORCE_PHRASE) {
          return answer(`Para liberar este trabalho a passar do teto do mês, mande confirmo: "${FORCE_PHRASE}" (só depois de a dona confirmar).`, 400);
        }
        const job = await forceCost(id);
        return job ? NextResponse.json({ data: jobView(job) }) : answer(NOT_FOUND, 404);
      }
      default:
        return answer("Ação inválida. Use batimento, concluir, erro, aprovacao, decidir, cancelar, repetir ou forcar.", 404);
    }
  } catch (error) {
    return failure(error, `não consegui fazer "${acao}"`);
  }
}

/** Resposta das ações do robô: 200 com o trabalho, 404, ou 409 quando o trabalho não está mais com este Mac. */
function workerAnswer(outcome: WorkerOutcome) {
  if (outcome.ok) return NextResponse.json({ data: jobView(outcome.job) });
  if (outcome.motivo === "not-found") return answer(NOT_FOUND, 404);
  return answer(notYoursText(outcome.job), 409, { estado: outcome.job.estado, data: jobView(outcome.job) });
}

function notYoursText(job: JobRow) {
  if (job.estado === "cancelado") return "Este trabalho foi cancelado. Pare o que estiver fazendo nele.";
  if (job.estado === "rodando") return "Este trabalho está com outro Mac agora. Pare o que estiver fazendo nele.";
  if (job.estado === "pronto") return "Este trabalho já está pronto.";
  if (job.estado === "erro") return "Este trabalho está com erro; ele só volta se a dona pedir para tentar de novo.";
  return "Este trabalho não está mais com este Mac (passou o prazo de 10 minutos sem batimento e ele voltou para a fila). Pare o que estiver fazendo nele.";
}
