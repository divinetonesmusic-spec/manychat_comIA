import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { R2Error } from "@/lib/content/r2";
import { erro, falta0020, moldeDe, UUID } from "@/lib/molde/paginas-http";
import { baseDasPaginas, isMissing0020, listarPaginas, PAGINA_MAX_BYTES, paginaView, salvarPagina, SLUG, slugDe } from "@/lib/molde/paginas";

export const runtime = "nodejs";
export const maxDuration = 30;

const MB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;

/**
 * POST /api/molde/paginas  { id?, slug?, titulo, html, molde, accountId?, publicada? }
 * Cria ou atualiza a página de venda (pelo mesmo id, ou pelo mesmo slug no mesmo projeto) e põe no ar em /v/<slug>.
 * Resposta: 201 (nova) ou 200 (atualizada) { id, slug, url, tamanho, publicada, criada }. Contrato: docs/API_MOLDE_PAGINAS.md.
 */
export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const declarado = Number(request.headers.get("content-length") || 0);
  if (declarado > PAGINA_MAX_BYTES * 1.3) {
    return erro(413, "grande_demais", `A página tem ${MB(declarado)}: o máximo é ${MB(PAGINA_MAX_BYTES)}. Diminua as imagens (use JPG ou WEBP menores) e mande de novo.`);
  }
  const bruto = await request.json().catch(() => null);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return erro(400, "pedido_invalido", "Mande um JSON com titulo, html e molde.");
  const body = bruto as Record<string, unknown>;

  const molde = moldeDe(body.molde);
  if (!molde) return erro(400, "pedido_invalido", "Falta o projeto do Molde (molde): letras, números, _ . : - (até 80).");
  const titulo = typeof body.titulo === "string" ? body.titulo.trim() : "";
  if (!titulo || Array.from(titulo).length > 200) return erro(400, "pedido_invalido", "Falta o título da página (titulo, até 200 letras).");
  if (typeof body.html !== "string" || !body.html.trim()) return erro(400, "pedido_invalido", "Falta o HTML da página (html).");
  const tamanho = Buffer.byteLength(body.html, "utf8");
  if (tamanho > PAGINA_MAX_BYTES) {
    return erro(413, "grande_demais", `A página tem ${MB(tamanho)}: o máximo é ${MB(PAGINA_MAX_BYTES)}. Diminua as imagens (use JPG ou WEBP menores) e mande de novo.`);
  }
  const id = body.id === undefined || body.id === null || body.id === "" ? null : typeof body.id === "string" && UUID.test(body.id) ? body.id.toLowerCase() : undefined;
  if (id === undefined) return erro(400, "pedido_invalido", "id inválido (precisa ser o id que o UaiFlow devolveu).");
  let slug: string | null = null;
  if (body.slug !== undefined && body.slug !== null && body.slug !== "") {
    slug = typeof body.slug === "string" ? slugDe(body.slug) : "";
    if (!slug || !SLUG.test(slug)) return erro(400, "pedido_invalido", "slug inválido: use de 3 a 60 letras sem acento, números e hífen (ex.: oracao-da-manha).");
  }
  const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : null;
  if (accountId && !UUID.test(accountId)) return erro(400, "pedido_invalido", "accountId inválido.");
  if (body.publicada !== undefined && typeof body.publicada !== "boolean") return erro(400, "pedido_invalido", "publicada precisa ser true ou false.");

  try {
    const r = await salvarPagina({ id, slug, titulo, html: body.html, molde, accountId, publicada: body.publicada !== false });
    if (!r.ok) {
      return r.motivo === "conta"
        ? erro(400, "conta", "Esta conta (accountId) não existe no UaiFlow.")
        : erro(404, "nao_achou", "Página não encontrada neste projeto (confira o id e o molde).");
    }
    const v = paginaView(r.pagina, baseDasPaginas(getAppBaseUrl(request.url)));
    return NextResponse.json({ id: v.id, slug: v.slug, url: v.url, tamanho: v.tamanho, publicada: v.publicada, criada: r.criada }, { status: r.criada ? 201 : 200 });
  } catch (error) {
    if (isMissing0020(error)) return falta0020();
    if (error instanceof R2Error || (error as { name?: string })?.name === "TimeoutError") {
      console.error("[paginas] o R2 não guardou:", error instanceof Error ? error.message : error);
      return erro(502, "armazenamento", "O armazenamento (Cloudflare R2) não guardou a página agora. Mande de novo em instantes.");
    }
    console.error("[paginas] não consegui guardar:", error instanceof Error ? error.message : error);
    return erro(500, "passageiro", "Não consegui guardar a página agora. Tente de novo em instantes.");
  }
}

/** GET /api/molde/paginas?molde=<projeto> → { data: [<página>] } (as 100 mais recentes do projeto, com as fora do ar). */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const molde = moldeDe(request.nextUrl.searchParams.get("molde"));
  if (!molde) return erro(400, "pedido_invalido", "Falta o projeto do Molde (?molde=).");
  try {
    const base = baseDasPaginas(getAppBaseUrl(request.url));
    return NextResponse.json({ data: (await listarPaginas(molde)).map((p) => paginaView(p, base)) });
  } catch (error) {
    if (isMissing0020(error)) return falta0020();
    console.error("[paginas] não consegui ler:", error instanceof Error ? error.message : error);
    return erro(500, "passageiro", "Não consegui ler as páginas agora. Tente de novo em instantes.");
  }
}
