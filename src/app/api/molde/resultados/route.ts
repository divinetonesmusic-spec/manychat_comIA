import { NextRequest, NextResponse } from "next/server";
import { listPublishedPosts } from "@/lib/db/content-planner";
import { checkMoldeToken, resultView } from "@/lib/content/molde-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Número inteiro positivo do parâmetro, ou o padrão; nunca acima do máximo. */
function limited(value: string | null, fallback: number, max: number) {
  const number = Math.floor(Number(value));
  if (!value || !Number.isFinite(number) || number < 1) return fallback;
  return Math.min(number, max);
}

/**
 * GET /api/molde/resultados?accountId=&dias=90&limite=200
 * Todos os posts publicados (de qualquer origem: Molde ou tela Conteúdo) com os números, do mais novo para o mais velho.
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const accountId = params.get("accountId") || null;
  if (accountId && !UUID.test(accountId)) return NextResponse.json({ error: "accountId inválido." }, { status: 400 });
  try {
    const posts = await listPublishedPosts({
      accountId,
      dias: limited(params.get("dias"), 90, 365),
      limite: limited(params.get("limite"), 200, 500),
    });
    return NextResponse.json({ data: posts.map(resultView) });
  } catch (error) {
    console.error("[resultados] não consegui ler os posts publicados:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui ler os resultados agora. Tente de novo em instantes." }, { status: 500 });
  }
}
