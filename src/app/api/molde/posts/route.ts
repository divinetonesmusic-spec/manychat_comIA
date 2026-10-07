import { NextRequest, NextResponse } from "next/server";
import { listPostsBySource } from "@/lib/db/content-planner";
import { parsePostPackage } from "@/lib/content/package";
import { ContentError, savePostPackage } from "@/lib/content/service";
import { PUBLISH_NOW_NOTICE, translateError } from "@/lib/content/scheduler";
import { checkMoldeToken, publicView } from "@/lib/content/molde-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET  /api/molde/posts?accountId=&refs=a,b   situação dos posts que vieram do Molde (status, link, resultados).
 * POST /api/molde/posts                        recebe o pacote do Reel/Carrossel (idempotente por externalRef).
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const refs = (params.get("refs") || "").split(",").map((ref) => ref.trim()).filter(Boolean).slice(0, 200);
  const posts = await listPostsBySource({ source: "molde", accountId: params.get("accountId"), externalRefs: refs, limit: Number(params.get("limit") || 200) });
  return NextResponse.json({ data: posts.map(publicView) });
}

export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parsePostPackage(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.value.externalRef) return NextResponse.json({ error: "Falta externalRef (id do item no Molde)." }, { status: 400 });

  try {
    const { post, created } = await savePostPackage({ ...parsed.value, source: "molde" }, parsed.publishNow);
    // "notice" é campo novo (só acréscimo): o "Publicar agora" não publica na hora, o relógio termina em até 2 min.
    const data = post ? { ...publicView(post), ...(parsed.publishNow && post.status === "publishing" ? { notice: PUBLISH_NOW_NOTICE } : {}) } : null;
    return NextResponse.json({ data, created }, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ContentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: translateError(error) }, { status: 500 });
  }
}
