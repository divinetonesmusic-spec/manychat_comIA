import { NextRequest, NextResponse } from "next/server";
import { safeEqualSecret } from "@/lib/secrets";
import { drainQueue } from "@/lib/queue/drain";
import { runContentCycle } from "@/lib/content/scheduler";
import { recordClockBeat, recordClockSkipped } from "@/lib/health";
import { withDrainLock } from "@/lib/queue/drain-lock";
import { notifyWaitingDms } from "@/lib/dm-alerts";
import { avisarRespostasVideo } from "@/lib/db/dm-videos";
import { cleanupOldRecords } from "@/lib/db/cleanup";
import { runMoldeClock } from "@/lib/molde/relogio";
import { runVendasClock } from "@/lib/vendas/relogio";
import { runAppClock } from "@/lib/app/relogio";
import { runTokenClock } from "@/lib/instagram/token-clock";

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
 * 1) envia a fila de DMs/respostas; 2) publica posts agendados, 1º comentário, automação, resultados e limpeza da mídia;
 * 3) avisa no Telegram as DMs esperando resposta; 4) fila do Molde (trabalhos parados, avisos, aprovações, relatório de
 * domingo); 5) pedidos de depoimento vencidos (e-mail, 0011) e o lembrete diário do app por assinatura (e-mail, 0018); 6) renova os tokens que precisam (a cada 15 min);
 * 7) limpa o banco (1 vez por hora). Só um relógio roda por vez.
 * Tudo dentro de ~9 s para caber no plano grátis de funções serverless.
 */
async function runDrain(request: NextRequest) {
  const providedSecret = request.headers.get("x-worker-secret");
  const expected = process.env.WORKER_SECRET;

  // Em produção o relógio só roda com segredo (no cabeçalho, nunca na URL, que fica em logs).
  if (!expected && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Defina WORKER_SECRET nas variáveis do servidor." }, { status: 503 });
  }
  if (expected && !safeEqualSecret(providedSecret, expected)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Só um relógio por vez (o do pg_cron e os que cada webhook dispara): o segundo sai na hora, com sucesso.
  const locked = await withDrainLock(() => runCycle(request));
  if (!locked.ran) {
    await recordClockSkipped(); // muitas seguidas sem batimento: o /api/health avisa que a trava ficou presa
    return NextResponse.json({ ok: true, skipped: true, motivo: "Outro relógio já está rodando; este saiu sem fazer nada." });
  }
  return NextResponse.json(locked.result);
}

async function runCycle(request: NextRequest) {
  const startedAt = Date.now();
  const totalBudget = Number(process.env.CRON_BUDGET_MS || 9000);
  const deadline = startedAt + totalBudget;
  const limit = Number(request.nextUrl.searchParams.get("limit") || 40);

  const queue = await drainQueue(limit, Math.round(totalBudget * 0.45)).catch((error: unknown) => ({
    processed: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
    stoppedEarly: true,
    error: error instanceof Error ? error.message : "Erro na fila",
  }));

  // O planner fica com o tempo que sobra. O aviso de DMs e a limpeza usam o resto (se não couber, ficam para o próximo minuto).
  const remaining = Math.max(2500, deadline - Date.now());
  const content = await runContentCycle(remaining, { origin: request.nextUrl.origin }).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : "Erro no planner",
  }));

  // DMs esperando resposta há mais de 30 min: 1 aviso por perfil no Telegram (no máximo a cada 2 h). Nunca falha.
  const avisosDm = await notifyWaitingDms({ deadline, origin: request.nextUrl.origin });

  // DM com vídeo (0014): quem respondeu a pergunta da DM vira 1 aviso no Telegram (o que respondeu e qual vídeo sai e quando). Nunca falha.
  const avisosVideo = await avisarRespostasVideo({ deadline });

  // Fila do Molde: trabalhos cujo Mac sumiu voltam para a fila, avisos no Telegram e o relatório de domingo. Nunca falha.
  const molde = await runMoldeClock({ deadline, origin: request.nextUrl.origin }).catch(() => null);

  // Pedido de depoimento N dias depois da compra (só com a 0011 e o e-mail configurado). Nunca falha.
  const vendas = await runVendasClock({ deadline, origin: request.nextUrl.origin });

  // O lembrete diário do app por assinatura (só com a 0018, o e-mail configurado e quem ligou o lembrete). Nunca falha.
  const app = await runAppClock({ deadline, origin: request.nextUrl.origin });

  // Renovação dos tokens de TODAS as conexões que precisam (Instagram, Facebook, Threads), no máximo a cada 15 min, uma
  // por vez no tempo que sobrar, com aviso no Telegram quando falha ou falta pouco para vencer. Nunca falha.
  const tokens = await runTokenClock({ deadline, origin: request.nextUrl.origin });

  // Limpeza do banco (eventos de mais de 90 dias, envios terminados há mais de 30), no máximo 1 vez por hora. Nunca falha.
  const limpeza = await cleanupOldRecords({ deadline });

  // Batimento para o /api/health (migração 0004). Falha ignorada: sem a 0004 o relógio segue normal.
  await recordClockBeat({ ms: Date.now() - startedAt });

  return { ok: true, ...queue, content, avisosDm, avisosVideo, molde, vendas, app, tokens, limpeza, ms: Date.now() - startedAt };
}
