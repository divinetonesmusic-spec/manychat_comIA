import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { hasDmVideoTables, listarVideos, MIGRATION_0014_DMVIDEO, parseEscopo, parseVideos, salvarVideos } from "@/lib/db/dm-videos";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Os vídeos de resposta da DM de um post (Molde v133, K-DMVIDEO, migração 0014). Cabeçalho x-molde-token.
 *
 * GET  /api/molde/dmvideo?ref=<externalRef>  (ou ?keyword=SONO; &accountId=<uuid> opcional)
 *      → {data: {escopo, videos: [{chave, titulo, palavras, geral, texto, videoUrl, tamanho, duracaoSeg, ordem}]}}
 *        Sem a 0014: {data: {escopo, videos: []}, aviso}.
 * POST /api/molde/dmvideo  {accountId?, externalRef? | keyword?, videos: [{chave, titulo, palavras[], geral?, texto?, videoUrl, tamanho?, duracaoSeg?}]}
 *      → troca os vídeos do post (ou da palavra) pelos da lista; os que saíram são apagados. {data: {escopo, videos}}.
 *        O vídeo sobe antes pelo /api/molde/upload com folder "dmvideos" (pasta protegida do R2). Até 25 MB por vídeo (limite da Meta).
 *        400 com a frase do que está errado; 503 {codigo: "falta_0014"} sem a 0014.
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const escopo = parseEscopo({ accountId: params.get("accountId"), externalRef: params.get("ref"), keyword: params.get("keyword") });
  if ("erro" in escopo) return NextResponse.json({ error: escopo.erro }, { status: 400 });
  try {
    const videos = await listarVideos(escopo);
    if (videos === null) return NextResponse.json({ data: { escopo, videos: [] }, aviso: MIGRATION_0014_DMVIDEO });
    return NextResponse.json({ data: { escopo, videos } });
  } catch (error) {
    console.error("[dm-video] não consegui ler os vídeos:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui ler os vídeos da DM agora. Tente de novo em instantes." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Mande um JSON com externalRef (ou keyword) e videos." }, { status: 400 });
  const escopo = parseEscopo(body);
  if ("erro" in escopo) return NextResponse.json({ error: escopo.erro }, { status: 400 });
  const lidos = parseVideos(body.videos);
  if ("erro" in lidos) return NextResponse.json({ error: lidos.erro }, { status: 400 });
  try {
    if (!(await hasDmVideoTables())) return NextResponse.json({ error: MIGRATION_0014_DMVIDEO, codigo: "falta_0014" }, { status: 503 });
    await salvarVideos(escopo, lidos.videos);
    return NextResponse.json({ data: { escopo, videos: (await listarVideos(escopo)) ?? [] } });
  } catch (error) {
    console.error("[dm-video] não consegui guardar os vídeos:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui guardar os vídeos da DM agora. Tente de novo em instantes." }, { status: 500 });
  }
}
