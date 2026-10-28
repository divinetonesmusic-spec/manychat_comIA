import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { getEntregaPublica, getLeadDaEntrega } from "@/lib/db/funil-molde";
import { COOKIE_ENTREGA_DIAS, cookieEntrega } from "@/lib/funil/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; codigo: string }> };

/**
 * GET /e/<slug>/m/<código> — o link do e-mail do material (K7, v138): o código é o da pessoa na Lista própria (o mesmo do link
 * de sair da lista). Confere que ela é da lista desta entrega, libera o download de novo (o mesmo cookie de 30 dias do
 * formulário) e leva à página, já com «Baixar o PDF». Código que não confere: a página com o formulário (nada vaza).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { slug, codigo } = await params;
  const e = await getEntregaPublica(slug);
  if (!e) return new NextResponse("Página não encontrada.", { status: 404 });
  const pagina = `/e/${e.slug}`;
  const lead = await getLeadDaEntrega(codigo, e).catch((err: unknown) => {
    console.error("[entrega] não consegui conferir o link do e-mail:", err instanceof Error ? err.message : err);
    return null;
  });
  const destino = new URL(`${pagina}${lead ? "" : "?erro=acesso"}#receber`, getAppBaseUrl(request.url));
  const resposta = NextResponse.redirect(destino, { status: 302, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  if (lead) resposta.cookies.set(cookieEntrega(e.slug), lead.chave, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: pagina, maxAge: COOKIE_ENTREGA_DIAS * 86400 });
  return resposta;
}
