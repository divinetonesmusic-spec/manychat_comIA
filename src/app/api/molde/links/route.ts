import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { AccountNotFoundError, isMissingTables, listLinksWithClicks, upsertTrackedLink } from "@/lib/db/tracked-links";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_0006 = "Falta colar a atualização 0006 no Supabase (veja docs/ATUALIZACAO_0006.md).";

function missingMigration() {
  return NextResponse.json({ error: MISSING_0006 }, { status: 503 });
}

function linkUrl(request: NextRequest, slug: string) {
  return `${getAppBaseUrl(request.url)}/l/${slug}`;
}

/**
 * POST /api/molde/links  { accountId?, externalRef, destino, rotulo? }
 * Cria o link rastreado do Reel (ou devolve o que já existe; se o destino mudou, atualiza o destino e os cliques continuam).
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

  try {
    const link = await upsertTrackedLink({ accountId, externalRef, destino, rotulo });
    return NextResponse.json(
      { data: { externalRef: link.externalRef, slug: link.slug, url: linkUrl(request, link.slug), destino: link.destino, criado: link.criado } },
      { status: link.criado ? 201 : 200 },
    );
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

function canParseUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
