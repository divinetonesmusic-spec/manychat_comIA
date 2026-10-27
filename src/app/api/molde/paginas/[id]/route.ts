import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { baseDasPaginas, isMissing0020, paginaView, tirarDoAr } from "@/lib/molde/paginas";
import { erro, falta0020, moldeDe, UUID } from "@/lib/molde/paginas-http";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/molde/paginas/<id>[?molde=<projeto>] → tira a página do ar (/v/<slug> passa a responder «Página não
 * encontrada»). O conteúdo fica guardado: um POST com o mesmo id põe de volta. Resposta: { id, slug, url, publicada: false }.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id } = await params;
  if (!UUID.test(id)) return erro(404, "nao_achou", "Página não encontrada.");
  const moldeParam = request.nextUrl.searchParams.get("molde");
  const molde = moldeParam ? moldeDe(moldeParam) : null;
  if (moldeParam && !molde) return erro(400, "pedido_invalido", "molde inválido.");
  try {
    const p = await tirarDoAr(id.toLowerCase(), molde);
    if (!p) return erro(404, "nao_achou", "Página não encontrada.");
    const v = paginaView(p, baseDasPaginas(getAppBaseUrl(request.url)));
    return NextResponse.json({ id: v.id, slug: v.slug, url: v.url, publicada: false });
  } catch (error) {
    if (isMissing0020(error)) return falta0020();
    console.error("[paginas] não consegui tirar do ar:", error instanceof Error ? error.message : error);
    return erro(500, "passageiro", "Não consegui tirar a página do ar agora. Tente de novo em instantes.");
  }
}
