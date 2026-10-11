import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { query } from "@/lib/db/client";
import { capUsd, createJob, JobAccountNotFoundError, jobView, listJobs, monthKey, monthSpendUsd } from "@/lib/molde/jobs";
import { answer, failure, FORCE_PHRASE, jsonObject, parseStates, readBody, text, TIPO, UUID } from "@/lib/molde/jobs-http";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/molde/jobs?projeto=&estado=na_fila,rodando&tipo=&limite=50
 * Os trabalhos (mais recentes primeiro), os gastos do mês contra o teto e quando o Mac pediu trabalho pela última vez.
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const estados = parseStates(params.get("estado"));
  if (estados === "invalid") return answer("Estado inválido. Use: na_fila, rodando, esperando_aprovacao, aprovado, recusado, pronto, erro ou cancelado.", 400);
  const tipo = params.get("tipo");
  if (tipo && !TIPO.test(tipo)) return answer("Tipo inválido.", 400);
  const limite = Math.min(200, Math.max(1, Number(params.get("limite")) || 50));

  try {
    const jobs = await listJobs({ projeto: params.get("projeto"), estados, tipo, limite });
    const gasto = await monthSpendUsd();
    const mac = await query<{ atualizado_em: Date; valor: { worker?: string } }>("select atualizado_em, valor from public.app_status where chave = 'molde_mac'");
    return NextResponse.json({
      data: jobs.map(jobView),
      gastos: { mes: monthKey(), gastoUsd: gasto, tetoUsd: capUsd() },
      mac: { ultimaVez: mac.rows[0]?.atualizado_em ? new Date(mac.rows[0].atualizado_em).toISOString() : null, worker: mac.rows[0]?.valor?.worker ?? null },
    });
  } catch (error) {
    return failure(error, "não consegui listar os trabalhos");
  }
}

/**
 * POST /api/molde/jobs  { projeto, tipo, ref, titulo?, accountId?, payload?, custoEstimadoUsd?, prioridade?, forcarCusto?, confirmo? }
 * Põe um trabalho na fila. O mesmo (projeto, tipo, ref) devolve o que já existe (200, criado: false) sem mudar nada.
 * forcarCusto: true (passar do teto do mês) só vale com confirmo: "passar do teto".
 */
export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = await readBody(request);

  const tipo = typeof body.tipo === "string" ? body.tipo.trim() : "";
  if (!TIPO.test(tipo)) return answer("Tipo inválido: use letras minúsculas, números e _ (ex.: reel_pipeline).", 400);
  const ref = text(body.ref, 200);
  if (!ref) return answer("Falta a referência (ref) do trabalho, com até 200 letras.", 400);
  const projeto = body.projeto === undefined || body.projeto === "" ? "" : text(body.projeto, 200);
  if (projeto === null) return answer("O nome do projeto precisa ter até 200 letras.", 400);
  const titulo = body.titulo === undefined || body.titulo === "" ? "" : text(body.titulo, 200);
  if (titulo === null) return answer("O título precisa ter até 200 letras.", 400);
  const accountId = body.accountId ?? null;
  if (accountId !== null && (typeof accountId !== "string" || !UUID.test(accountId))) return answer("accountId inválido.", 400);
  const payload = jsonObject(body.payload);
  if (payload === null) return answer("O payload precisa ser um objeto JSON de até 64 KB.", 400);
  const custo = body.custoEstimadoUsd === undefined ? 0 : Number(body.custoEstimadoUsd);
  if (!Number.isFinite(custo) || custo < 0 || custo > 1000) return answer("custoEstimadoUsd precisa ser um número de 0 a 1000.", 400);
  const prioridade = body.prioridade === undefined ? 0 : Number(body.prioridade);
  if (!Number.isInteger(prioridade) || prioridade < -100 || prioridade > 100) return answer("prioridade precisa ser um número inteiro de -100 a 100.", 400);
  const forcarCusto = body.forcarCusto === true;
  if (forcarCusto && body.confirmo !== FORCE_PHRASE) {
    return answer(`Para passar do teto de gastos do mês, mande também confirmo: "${FORCE_PHRASE}" (só depois de a dona confirmar).`, 400);
  }

  try {
    const { job, criado } = await createJob({
      projeto: projeto ?? "",
      tipo,
      ref,
      titulo: titulo ?? "",
      accountId: accountId as string | null,
      payload: payload ?? {},
      custoEstimadoUsd: Math.round(custo * 10_000) / 10_000,
      prioridade,
      forcarCusto,
    });
    return NextResponse.json({ data: jobView(job), criado }, { status: criado ? 201 : 200 });
  } catch (error) {
    if (error instanceof JobAccountNotFoundError) return answer("Perfil não encontrado.", 404);
    return failure(error, "não consegui criar o trabalho");
  }
}
