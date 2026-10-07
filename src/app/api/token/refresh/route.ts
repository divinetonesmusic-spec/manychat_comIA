import { NextRequest, NextResponse } from "next/server";
import { refreshAllInstagramTokens, tokenRefreshAlerts } from "@/lib/instagram/token-refresh";
import { notifyTokenAlerts } from "@/lib/notify";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return refresh(request);
}

export async function POST(request: NextRequest) {
  return refresh(request);
}

async function refresh(request: NextRequest) {
  const providedSecret = request.headers.get("x-worker-secret");
  const expected = process.env.WORKER_SECRET;

  if (!expected && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Defina WORKER_SECRET nas variaveis do servidor." }, { status: 503 });
  }
  if (expected && providedSecret !== expected) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  // Renova TODAS as contas, cada uma com a sua tentativa.
  const resultados = await refreshAllInstagramTokens();
  if (!resultados.length) {
    return NextResponse.json({ ok: false, error: "Instagram nao conectado", contas: [] }, { status: 409 });
  }

  // Aviso no Telegram (se configurado): contas que não renovaram e contas vencendo em menos de 10 dias.
  await notifyTokenAlerts(tokenRefreshAlerts(resultados), request.nextUrl.origin);

  const renovadas = resultados.filter((resultado) => resultado.ok).length;
  return NextResponse.json(
    {
      // ok = todas renovadas; o status HTTP é 200 se pelo menos uma renovou e 500 só se todas falharam.
      ok: renovadas === resultados.length,
      contas: resultados.map((resultado) =>
        resultado.ok
          ? { username: resultado.username, ok: true, expiresAt: resultado.expiresAt, ...(resultado.skipped ? { pulada: true } : {}) }
          : { username: resultado.username, ok: false, erro: resultado.error },
      ),
    },
    { status: renovadas > 0 ? 200 : 500 },
  );
}
