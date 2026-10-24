import { NextRequest, NextResponse } from "next/server";
import { safeEqualSecret } from "@/lib/secrets";
import { refreshAllFacebookTokens, refreshAllInstagramTokens, refreshAllThreadsTokens, tokenRefreshAlerts } from "@/lib/instagram/token-refresh";
import { notifyTokenAlerts } from "@/lib/notify";
import { readUaiFlowSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return refresh(request);
}

/**
 * POST: o relógio (cabeçalho x-worker-secret) ou o botão «Renovar a conexão» da tela Configurações (sessão do UaiFlow,
 * formulário do próprio site). O botão volta para /configuracoes com o resultado; o relógio recebe o JSON de sempre.
 * GET só com o segredo do relógio (um link ou imagem de outro site não dispara a renovação).
 */
export async function POST(request: NextRequest) {
  if (!request.headers.get("x-worker-secret")) {
    const session = await readUaiFlowSession(request);
    if (!session.ok) return NextResponse.json({ error: "Sessão expirada. Entre novamente para continuar." }, { status: 401 });
    if (!sameOrigin(request)) return NextResponse.json({ error: "Pedido de outro site recusado." }, { status: 403 });
    const result = await runRefresh(request);
    const back = new URL("/configuracoes", request.url);
    back.searchParams.set("renovacao", result.status === 200 ? (result.body.ok ? "ok" : "parcial") : "erro");
    return session.applyCookies(NextResponse.redirect(back, { status: 303 }));
  }
  return refresh(request);
}

/** O formulário veio do próprio UaiFlow (Origin ou, sem ele, Referer do mesmo endereço). */
function sameOrigin(request: NextRequest) {
  const from = request.headers.get("origin") || request.headers.get("referer");
  if (!from) return false;
  try {
    const allowed = new Set([request.nextUrl.origin, process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).origin : ""]);
    return allowed.has(new URL(from).origin);
  } catch {
    return false;
  }
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
  const result = await runRefresh(request);
  return NextResponse.json(result.body, { status: result.status });
}

async function runRefresh(request: NextRequest): Promise<{ status: number; body: Record<string, unknown> & { ok: boolean } }> {
  // Renova TODAS as contas, cada uma com a sua tentativa.
  const resultados = await refreshAllInstagramTokens();
  if (!resultados.length) {
    return { status: 409, body: { ok: false, error: "Instagram não conectado", contas: [] } };
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
  return {
    status: renovadas > 0 ? 200 : 500,
    body: {
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
  };
}
