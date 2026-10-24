import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { AccountNotFoundError, isMissingTables, listLinksWithClicks, MIGRATION_0012_LINKS, upsertTrackedLink } from "@/lib/db/tracked-links";
import { ORIGEM_RE } from "@/lib/vendas/origem";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_0006 = "Falta colar a atualização 0006 no Supabase (veja docs/ATUALIZACAO_0006.md).";

function missingMigration() {
  return NextResponse.json({ error: MISSING_0006, codigo: "falta_0006" }, { status: 503 });
}

function linkUrl(request: NextRequest, slug: string) {
  return `${getAppBaseUrl(request.url)}/l/${slug}`;
}

/**
 * POST /api/molde/links  { accountId?, externalRef, destino, rotulo?, origem?, destinoComOrigem? }
 * Cria o link rastreado do Reel (ou devolve o que já existe; se o destino mudou, atualiza o destino e os cliques continuam).
 * Contrato v131 (0012): `origem` = o código do post (mo + até 7 letras/números) e `destinoComOrigem` = o checkout com esse
 * código nos parâmetros da plataforma. O /l/<código> passa a levar ao `destinoComOrigem` (sem ele, ao `destino`), e a venda
 * que volta com a origem acha o post. Campo inválido é ignorado (o link funciona como antes) e a resposta traz `aviso`.
 */
export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const externalRef = typeof body.externalRef === "string" ? body.externalRef.trim() : "";
  if (!externalRef) return NextResponse.json({ error: "Falta externalRef (id do item no Molde)." }, { status: 400 });
  const destino = typeof body.destino === "string" ? body.destino.trim() : "";
  if (!/^https:\/\/[^\s/]/i.test(destino) || !canParseUrl(destino)) {
    return NextResponse.json({ error: "O link de destino precisa começar com https://" }, { status: 400 });
  }
  const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : null;
  if (accountId && !UUID.test(accountId)) return NextResponse.json({ error: "accountId inválido." }, { status: 400 });
  const rotulo = typeof body.rotulo === "string" ? body.rotulo.trim().slice(0, 200) : undefined;
  const avisos: string[] = [];
  const origemPedida = typeof body.origem === "string" ? body.origem.trim().toLowerCase() : "";
  const origem = ORIGEM_RE.test(origemPedida) ? origemPedida : null;
  if (origemPedida && !origem) avisos.push("origem ignorada: use mo + até 7 letras/números.");
  const comOrigemPedido = typeof body.destinoComOrigem === "string" ? body.destinoComOrigem.trim() : "";
  const destinoComOrigem = comOrigemPedido && sameHost(comOrigemPedido, destino) ? comOrigemPedido.slice(0, 2000) : null;
  if (comOrigemPedido && !destinoComOrigem) avisos.push("destinoComOrigem ignorado: precisa ser https:// e do mesmo endereço do destino.");

  try {
    const link = await upsertTrackedLink({ accountId, externalRef, destino, rotulo, origem, destinoComOrigem });
    if (link.semOrigem) avisos.push(MIGRATION_0012_LINKS);
    const data = {
      externalRef: link.externalRef,
      slug: link.slug,
      url: linkUrl(request, link.slug),
      destino: link.destino,
      criado: link.criado,
      ...(link.origem !== undefined ? { origem: link.origem, destinoComOrigem: link.destinoComOrigem ?? null } : {}),
    };
    // "aviso" (só acréscimo) vai também dentro de "data", porque o robô do Mac devolve só o "data" à página.
    const aviso = avisos.length ? avisos.join(" ") : undefined;
    return NextResponse.json({ data: aviso ? { ...data, aviso } : data, ...(aviso ? { aviso } : {}) }, { status: link.criado ? 201 : 200 });
  } catch (error) {
    if (isMissingTables(error)) return missingMigration();
    if (error instanceof AccountNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    console.error("[links] não consegui criar o link:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui criar o link agora. Tente de novo em instantes." }, { status: 500 });
  }
}

/** GET /api/molde/links?refs=a,b&accountId=  → links e cliques (total, 7 dias, 30 dias, por origem). */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const accountId = params.get("accountId") || null;
  if (accountId && !UUID.test(accountId)) return NextResponse.json({ error: "accountId inválido." }, { status: 400 });
  const refs = (params.get("refs") || "").split(",").map((ref) => ref.trim()).filter(Boolean).slice(0, 200);

  try {
    const links = await listLinksWithClicks({ accountId, refs });
    return NextResponse.json({
      data: links.map((link) => ({
        externalRef: link.externalRef,
        accountId: link.accountId,
        slug: link.slug,
        url: linkUrl(request, link.slug),
        destino: link.destino,
        cliques: link.cliques,
      })),
    });
  } catch (error) {
    if (isMissingTables(error)) return missingMigration();
    console.error("[links] não consegui ler os links:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui ler os links agora. Tente de novo em instantes." }, { status: 500 });
  }
}

/** O checkout com a origem só vale se for https:// e do mesmo endereço (host) do destino: o link nunca leva a outro site. */
function sameHost(value: string, destino: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host === new URL(destino).host;
  } catch {
    return false;
  }
}

function canParseUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
