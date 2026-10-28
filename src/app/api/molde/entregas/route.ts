import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { getR2Config, PASTA_ENTREGAS_R2, r2UploadPrivado } from "@/lib/content/r2";
import { guardarPendentes, isMissing0013, listarEntregas, MIGRATION_0013, novoCodigo, salvarEntrega } from "@/lib/db/funil-molde";
import { extensao, lerEntrega } from "@/lib/funil/entrega";
import { estadoEmailEntrega } from "@/lib/funil/entrega-email";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function falta0013() {
  return NextResponse.json({ error: MIGRATION_0013, codigo: "falta_0013" }, { status: 503 });
}
function moldeDe(value: unknown) {
  const t = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(t) ? t : "";
}

/**
 * POST /api/molde/entregas  { molde, accountId?, id?, slug?, entrega: {titulo, subtitulo, itens, idioma, marca, proximo, aviso},
 *   arquivos: [{tipo: 'pdf'|'html'|'capa', nome, contentType, size}] }
 * Cria (ou atualiza) a página de entrega e devolve um link de envio (PUT, 1 h) para cada arquivo, numa pasta PRIVADA do R2.
 * O robô do Mac manda cada arquivo ({acao:'enviar', path, url, headers}); depois a página chama
 * POST /api/molde/entregas/<id>/publicar, que confere os arquivos e abre /e/<slug>.
 * Resposta: { id, slug, url, ativo, envios: [{tipo, uploadUrl, headers}] }.
 */
export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const molde = moldeDe(body.molde);
  if (!molde) return NextResponse.json({ error: "Falta o projeto do Molde (molde)." }, { status: 400 });
  const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : null;
  if (accountId && !UUID.test(accountId)) return NextResponse.json({ error: "accountId inválido." }, { status: 400 });
  const lido = lerEntrega(body);
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
  if (lido.arquivos.length && !getR2Config()) return NextResponse.json({ error: "O armazenamento (Cloudflare R2) do UaiFlow ainda não foi configurado." }, { status: 503 });
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  try {
    const e = await salvarEntrega({ id, accountId, molde, slug: lido.slug || "material", entrega: lido.entrega });
    const pendentes: Record<string, { key: string; nome: string; contentType: string; size: number }> = {};
    const envios = lido.arquivos.map((a) => {
      const key = `${PASTA_ENTREGAS_R2}/${e.id}/${a.tipo}-${novoCodigo(8)}.${extensao(a)}`;
      pendentes[a.tipo] = { key, nome: a.nome, contentType: a.contentType, size: a.size };
      return { tipo: a.tipo, ...r2UploadPrivado(key, a.size, a.contentType) };
    });
    if (envios.length) await guardarPendentes(e.id, pendentes);
    return NextResponse.json({ data: { id: e.id, slug: e.slug, url: `${getAppBaseUrl(request.url)}/e/${e.slug}`, ativo: e.ativo, envios } });
  } catch (error) {
    if (isMissing0013(error)) return falta0013();
    console.error("[entrega] não consegui guardar:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error && /Outro projeto/.test(error.message) ? error.message : "Não consegui preparar a página de entrega agora. Tente de novo em instantes." }, { status: 500 });
  }
}

/**
 * GET /api/molde/entregas?molde=<projeto> → as páginas de entrega do projeto com os números (visitas, e-mails, PDF, interativo,
 * próximo passo) e, em cada uma, `email: {configurado, faltam}` (K7, v138: o material também vai por e-mail?).
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const molde = moldeDe(request.nextUrl.searchParams.get("molde"));
  if (!molde) return NextResponse.json({ error: "Falta o projeto do Molde (molde)." }, { status: 400 });
  try {
    const base = getAppBaseUrl(request.url);
    const email = estadoEmailEntrega();
    return NextResponse.json({ data: (await listarEntregas(molde)).map((e) => ({ ...e, url: `${base}/e/${e.slug}`, email })) });
  } catch (error) {
    if (isMissing0013(error)) return falta0013();
    console.error("[entrega] não consegui ler:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui ler as páginas de entrega agora. Tente de novo em instantes." }, { status: 500 });
  }
}
