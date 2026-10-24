import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { contagemDms } from "@/lib/db/dm-contagem";
import { refsDaUrl } from "@/lib/molde/refs";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/molde/dms/contagem?refs=<a>,<b> (cabeçalho x-molde-token; contrato v131 da página)
 * → `{"data": [{ref, disparadas, botao, responderam?, clicaram?}]}` (o robô do Mac entrega a lista à página).
 * `disparadas` = as DMs que a palavra do comentário disparou (saíram); `botao` = pessoas que tocaram no botão da DM.
 * Com a sequência de DM (0012): `responderam` e `clicaram` (no link do passo 3). Até 200 refs.
 * (Esta pasta é estática: vem antes da rota /api/molde/dms/<id>, então "contagem" nunca é lido como o id de uma mensagem.)
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const refs = refsDaUrl(request.nextUrl);
  try {
    return NextResponse.json({ data: await contagemDms(refs) });
  } catch (error) {
    console.error("[dms] não consegui contar as DMs:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui contar as DMs agora. Tente de novo em instantes." }, { status: 500 });
  }
}
