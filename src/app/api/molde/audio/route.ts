import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { AudioSearchError, safeAudioError, searchAudioForAccount } from "@/lib/facebook/audio";

export const runtime = "nodejs";

/**
 * GET /api/molde/audio?conta=<id da conta>&q=<busca>&tipo=music|original_sound   (x-molde-token)
 * A mesma busca de música da tela Conteúdo, para a página do Molde (pelo robô do Mac). Sem q: as em alta.
 * Resposta: { data: { conta, username, q, tipo, emAlta, musicas: [{ id, titulo, artista, duracaoMs, duracao, tipo,
 * capaUrl, previaUrl, linkPrevia, usuario }] } }. Erros: { error, codigo } (sem_conta, conta_nao_encontrada,
 * sem_facebook, facebook_vencido, falta_0009, tipo_invalido, meta).
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  try {
    const data = await searchAudioForAccount({ accountId: params.get("conta") || params.get("accountId"), q: params.get("q"), tipo: params.get("tipo") });
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof AudioSearchError) return NextResponse.json({ error: error.message, codigo: error.codigo }, { status: error.status });
    return NextResponse.json({ error: safeAudioError(error), codigo: "meta" }, { status: 502 });
  }
}
