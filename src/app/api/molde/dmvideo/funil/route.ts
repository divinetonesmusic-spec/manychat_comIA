import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { funilPorRefs, hasDmVideoTables, MIGRATION_0014_DMVIDEO, NOTA_VIDEO_VISTO, REFERENCIAS_FUNIL } from "@/lib/db/dm-videos";
import { hasVendasTable } from "@/lib/db/redes";
import { vendasPorRefs } from "@/lib/db/vendas";
import { refsDaUrl } from "@/lib/molde/refs";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/molde/dmvideo/funil?refs=<a>,<b>[&views=1200,300] (cabeçalho x-molde-token; Molde v133)
 * → {data: [{ref, comentarios, responderam, videos, cliques, compras, views, comSinalDeVisto, porVideo: [{chave, enviados, cliques}],
 *    gargalo: {etapa, tipo: trafego|conversa|pagina|nenhum, frase, taxas}}], referencias, nota, aviso?}
 * `views` (opcional) vem na mesma ordem dos refs e só entra na conta do gargalo. Compras = vendas aprovadas com a origem do post
 * (0012), no último ano. Até 200 refs. `nota` diz o que a Meta não informa (se a pessoa assistiu ao vídeo).
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const refs = refsDaUrl(request.nextUrl);
  const viewsTxt = (request.nextUrl.searchParams.get("views") || "").split(",");
  const views = new Map<string, number>();
  refs.forEach((ref, i) => {
    const n = Number(viewsTxt[i]);
    if (Number.isFinite(n) && n > 0) views.set(ref, Math.round(n));
  });
  try {
    const compras = new Map<string, number>();
    if (refs.length && (await hasVendasTable())) {
      const { vendas } = await vendasPorRefs({ refs, desde: new Date(Date.now() - 365 * 86_400_000) });
      for (const v of vendas) if (v.ref && v.status === "aprovada") compras.set(v.ref, (compras.get(v.ref) ?? 0) + 1);
    }
    const data = await funilPorRefs(refs, compras, views);
    const aviso = (await hasDmVideoTables()) ? undefined : MIGRATION_0014_DMVIDEO;
    return NextResponse.json({ data, referencias: REFERENCIAS_FUNIL, nota: NOTA_VIDEO_VISTO, ...(aviso ? { aviso } : {}) });
  } catch (error) {
    console.error("[dm-video] não consegui montar o funil:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui montar o funil da DM agora. Tente de novo em instantes." }, { status: 500 });
  }
}
