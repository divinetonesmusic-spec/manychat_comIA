import { NextRequest, NextResponse } from "next/server";
import { safeEqualSecret } from "@/lib/secrets";
import { refreshAllFacebookTokens, refreshAllInstagramTokens, refreshAllThreadsTokens, tokenRefreshAlerts } from "@/lib/instagram/token-refresh";
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
    return NextResponse.json({ error: "Defina WORKER_SECRET nas variáveis do servidor." }, { status: 503 });
  }
  if (expected && !safeEqualSecret(providedSecret, expected)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Renova TODAS as contas, cada uma com a sua tentativa.
  const resultados = await refreshAllInstagramTokens();
  if (!resultados.length) {
    return NextResponse.json({ ok: false, error: "Instagram não conectado", contas: [] }, { status: 409 });
  }

  // Conexões pelo Facebook (música do Instagram): renovadas junto; uma falha aqui não muda o resultado das contas.
  const facebook = await refreshAllFacebookTokens().catch((error) => {
    console.warn("[token] renovação das conexões pelo Facebook falhou", error instanceof Error ? error.message.slice(0, 200) : error);
    return [];
  });

  // Conexões do Threads (0010): renovadas junto; uma falha aqui também não muda o resultado das contas.
  const threads = await refreshAllThreadsTokens().catch((error) => {
    console.warn("[token] renovação das conexões do Threads falhou", error instanceof Error ? error.message.slice(0, 200) : error);
    return [];
  });

  // Aviso no Telegram (se configurado): contas que não renovaram e contas vencendo em menos de 10 dias.
  await notifyTokenAlerts(tokenRefreshAlerts([...resultados, ...facebook, ...threads]), request.nextUrl.origin);

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
      // campo novo (só acréscimo): as conexões pelo Facebook, no mesmo formato
      ...(facebook.length
        ? {
            facebook: facebook.map((resultado) =>
              resultado.ok
                ? { username: resultado.username, ok: true, expiresAt: resultado.expiresAt, ...(resultado.skipped ? { pulada: true } : {}) }
                : { username: resultado.username, ok: false, erro: resultado.error },
            ),
          }
        : {}),
      // campo novo (só acréscimo): as conexões do Threads, no mesmo formato
      ...(threads.length
        ? {
            threads: threads.map((resultado) =>
              resultado.ok
                ? { username: resultado.username, ok: true, expiresAt: resultado.expiresAt, ...(resultado.skipped ? { pulada: true } : {}) }
                : { username: resultado.username, ok: false, erro: resultado.error },
            ),
          }
        : {}),
    },
    { status: renovadas > 0 ? 200 : 500 },
  );
}
