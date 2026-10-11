import { NextResponse } from "next/server";
import { readHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — pública (vigiada pelo monitor do GitHub). Sem segredo e sem @ de conta.
 * { ok, relogio: { ultimaVez, minutos }, tokens: { menorPrazoDias }, mac: { ultimaVez, minutos } } e, quando ok = false,
 * `motivo` (HTTP 503). `mac` = a última vez que o robô do Mac pediu trabalho à fila do Molde (não muda o ok).
 */
export async function GET() {
  const report = await readHealth();
  return NextResponse.json(report, { status: report.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
