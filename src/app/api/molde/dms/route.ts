import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { isMissingTables, listPending, refreshPending } from "@/lib/db/dm-pending";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_0006 = "Falta colar a atualização 0006 no Supabase (veja docs/ATUALIZACAO_0006.md).";

/**
 * GET /api/molde/dms?accountId=
 * DMs que ninguém respondeu (e as que mudaram nas últimas 48 h), com a conversa recente para o rascunho.
 * Antes de responder, põe em dia o que passou do prazo de 24 h e o que já saiu (ou não saiu) da fila de envios.
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const accountId = request.nextUrl.searchParams.get("accountId") || null;
  if (accountId && !UUID.test(accountId)) return NextResponse.json({ error: "accountId inválido." }, { status: 400 });

  try {
    await refreshPending({ accountId });
    return NextResponse.json({ data: await listPending({ accountId }) });
  } catch (error) {
    if (isMissingTables(error)) return NextResponse.json({ error: MISSING_0006, codigo: "falta_0006" }, { status: 503 });
    console.error("[dms] não consegui ler as mensagens sem resposta:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui ler as mensagens agora. Tente de novo em instantes." }, { status: 500 });
  }
}
