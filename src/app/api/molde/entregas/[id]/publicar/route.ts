import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { r2Tamanho } from "@/lib/content/r2";
import { getEntregaMolde, isMissing0013, MIGRATION_0013, publicarEntrega } from "@/lib/db/funil-molde";
import { estadoEmailEntrega } from "@/lib/funil/entrega-email";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/molde/entregas/<id>/publicar  { molde }
 * Confere no R2 cada arquivo pedido (existe e tem o tamanho anunciado) e abre a página /e/<slug>. Arquivo que não chegou:
 * erro 409 com a frase (a página manda de novo). A página só abre com o PDF ou a versão interativa.
 * Resposta: { id, slug, url, ativo, temPdf, temHtml, temCapa, email: {configurado, faltam} } — K7 (v138): `email` diz se o
 * material também sai por e-mail para quem se cadastra e, se não, quais variáveis faltam na Netlify (só os nomes).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const molde = typeof body.molde === "string" ? body.molde.trim() : "";
  try {
    const e = await getEntregaMolde(id, molde);
    if (!e) return NextResponse.json({ error: "Página de entrega não encontrada neste projeto." }, { status: 404 });
    const campos: Parameters<typeof publicarEntrega>[1] = {};
    for (const [tipo, p] of Object.entries(e.pendentes ?? {})) {
      const tamanho = await r2Tamanho(p.key);
      if (tamanho === null) return NextResponse.json({ error: `O arquivo (${tipo}) ainda não chegou ao armazenamento. Mande de novo.`, codigo: "arquivo_faltando" }, { status: 409 });
      if (tamanho !== p.size) return NextResponse.json({ error: `O arquivo (${tipo}) chegou com outro tamanho. Mande de novo.`, codigo: "arquivo_diferente" }, { status: 409 });
      if (tipo === "pdf") Object.assign(campos, { pdf_key: p.key, pdf_nome: p.nome });
      if (tipo === "html") campos.html_key = p.key;
      if (tipo === "capa") campos.capa_key = p.key;
    }
    if (!(campos.pdf_key || e.pdf_key || campos.html_key || e.html_key)) return NextResponse.json({ error: "Mande o PDF ou a versão interativa antes de publicar." }, { status: 400 });
    const pub = await publicarEntrega(e.id, campos);
    return NextResponse.json({ data: { id: e.id, slug: e.slug, url: `${getAppBaseUrl(request.url)}/e/${e.slug}`, ativo: Boolean(pub?.ativo), temPdf: Boolean(pub?.pdf_key), temHtml: Boolean(pub?.html_key), temCapa: Boolean(pub?.capa_key), email: estadoEmailEntrega() } });
  } catch (error) {
    if (isMissing0013(error)) return NextResponse.json({ error: MIGRATION_0013, codigo: "falta_0013" }, { status: 503 });
    console.error("[entrega] não consegui publicar:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui conferir os arquivos agora. Tente de novo em instantes." }, { status: 500 });
  }
}
