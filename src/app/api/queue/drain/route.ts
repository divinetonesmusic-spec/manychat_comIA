import { NextRequest, NextResponse } from "next/server";
import { drainQueue } from "@/lib/queue/drain";
import { runContentCycle } from "@/lib/content/scheduler";
import { recordClockBeat } from "@/lib/health";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  return runDrain(request);
}

export async function POST(request: NextRequest) {
  return runDrain(request);
}

/**
 * Relógio do sistema (chamado a cada minuto pelo pg_cron do Supabase):
 * 1) envia a fila de DMs/respostas; 2) publica posts agendados, 1º comentário, automação, resultados e limpeza.
 * Tudo dentro de ~9 s para caber no plano grátis de funções serverless.
 */
async function runDrain(request: NextRequest) {
  const providedSecret = request.headers.get("x-worker-secret");
  const expected = process.env.WORKER_SECRET;

  // Em produção o relógio só roda com segredo (no cabeçalho, nunca na URL, que fica em logs).
  if (!expected && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Defina WORKER_SECRET nas variaveis do servidor." }, { status: 503 });
  }
  if (expected && providedSecret !== expected) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const startedAt = Date.now();
  const totalBudget = Number(process.env.CRON_BUDGET_MS || 9000);
  const limit = Number(request.nextUrl.searchParams.get("limit") || 40);

  const queue = await drainQueue(limit, Math.round(totalBudget * 0.45)).catch((error: unknown) => ({
    processed: 0,
    sent: 0,
    failed: 0,
    stoppedEarly: true,
    error: error instanceof Error ? error.message : "Erro na fila",
  }));

  const remaining = Math.max(2500, totalBudget - (Date.now() - startedAt));
  const content = await runContentCycle(remaining, { origin: request.nextUrl.origin }).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : "Erro no planner",
  }));

  // Batimento para o /api/health (migração 0004). Falha ignorada: sem a 0004 o relógio segue normal.
  await recordClockBeat({ ms: Date.now() - startedAt });

  return NextResponse.json({ ok: true, ...queue, content, ms: Date.now() - startedAt });
}
