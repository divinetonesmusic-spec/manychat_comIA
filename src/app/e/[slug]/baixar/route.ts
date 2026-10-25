import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { r2DownloadUrl } from "@/lib/content/r2";
import { getEntregaPublica, getLeadPorCodigo, registrarEventoEntrega } from "@/lib/db/funil-molde";
import { nomeDeArquivo } from "@/lib/funil/entrega";
import { cookieEntrega, LINK_HTML_SEG, LINK_PDF_SEG } from "@/lib/funil/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /e/<slug>/baixar?tipo=pdf|html — só para quem já deixou o e-mail (o cookie desta página). Conta o download e leva
 * ao link assinado do R2: o PDF baixa (10 min de prazo); a versão interativa abre no navegador (6 h). Sem o cookie, volta
 * para o formulário. O arquivo nunca fica público.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const e = await getEntregaPublica(slug);
  if (!e) return new NextResponse("Página não encontrada.", { status: 404 });
  const voltar = (q: string) => NextResponse.redirect(new URL(`/e/${e.slug}${q}#receber`, getAppBaseUrl(request.url)), { status: 302, headers: { "cache-control": "no-store" } });
  const lead = await getLeadPorCodigo(request.cookies.get(cookieEntrega(e.slug))?.value || "");
  if (!lead) return voltar("?erro=acesso");
  const tipo = request.nextUrl.searchParams.get("tipo") === "html" ? "html" : "pdf";
  const key = tipo === "pdf" ? e.pdf_key : e.html_key;
  if (!key) return voltar("");
  const destino = tipo === "pdf"
    ? r2DownloadUrl(key, LINK_PDF_SEG, undefined, { baixarComo: nomeDeArquivo(e.pdf_nome || e.titulo, "pdf"), tipo: "application/pdf" })
    : r2DownloadUrl(key, LINK_HTML_SEG, undefined, { tipo: "text/html; charset=utf-8" });
  await registrarEventoEntrega(e.id, tipo, null, null).catch((err: unknown) => console.error("[entrega] download não contado:", err));
  return NextResponse.redirect(destino, { status: 302, headers: { "cache-control": "no-store" } });
}
