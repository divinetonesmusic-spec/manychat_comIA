import { NextRequest, NextResponse } from "next/server";
import { readUaiFlowSession } from "@/lib/session";
import { AudioSearchError, safeAudioError, searchAudioForAccount } from "@/lib/facebook/audio";

export const runtime = "nodejs";

/**
 * GET /api/instagram/audio?conta=<id da conta>&q=<busca>&tipo=music|original_sound
 * Busca músicas da biblioteca do Instagram (Audio API, pela conexão do Facebook da conta). Sem q: as em alta.
 * Só com a sessão do UaiFlow (o proxy já barra; a rota confere de novo). Nunca devolve token.
 */
export async function GET(request: NextRequest) {
  const session = await readUaiFlowSession(request);
  if (!session.ok) return NextResponse.json({ error: "Sessão expirada. Entre novamente para continuar." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  try {
    const data = await searchAudioForAccount({ accountId: params.get("conta") || params.get("accountId"), q: params.get("q"), tipo: params.get("tipo") });
    return session.applyCookies(NextResponse.json({ data }));
  } catch (error) {
    if (error instanceof AudioSearchError) return session.applyCookies(NextResponse.json({ error: error.message, codigo: error.codigo }, { status: error.status }));
    return session.applyCookies(NextResponse.json({ error: safeAudioError(error), codigo: "meta" }, { status: 502 }));
  }
}
