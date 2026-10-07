import { NextRequest, NextResponse } from "next/server";
import { listContentPosts } from "@/lib/db/repositories";
import { listContentPostsInRange } from "@/lib/db/content-planner";
import { parsePostPackage } from "@/lib/content/package";
import { ContentError, savePostPackage } from "@/lib/content/service";
import { PUBLISH_NOW_NOTICE, runContentCycle, translateError } from "@/lib/content/scheduler";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET  /api/content?accountId=&from=&to=   lista (ou um intervalo do calendário) e avança o que estiver publicando.
 * POST /api/content                          cria um post com o pacote completo: agenda, rascunho ou publica agora.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const accountId = params.get("accountId");
  const from = params.get("from");
  const to = params.get("to");

  // Sem esperar o relógio: dá um empurrão curto nos posts vencidos/em processamento.
  if (params.get("sync") !== "0") await runContentCycle(3500, { light: true, origin: request.nextUrl.origin }).catch(() => null);

  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return NextResponse.json({ error: "Intervalo de datas invalido." }, { status: 400 });
    }
    return NextResponse.json({ data: await listContentPostsInRange({ accountId, from: fromDate, to: toDate }) });
  }
  return NextResponse.json({ data: await listContentPosts(Number(params.get("limit") || 80), accountId) });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parsePostPackage(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const { post } = await savePostPackage({ ...parsed.value, source: parsed.value.source ?? "manual" }, parsed.publishNow);
    const warning = post?.status === "publishing" ? `${PUBLISH_NOW_NOTICE} O UaiFlow publica sozinho, faz o 1º comentário e liga a automação.` : undefined;
    return NextResponse.json({ data: post, warning }, { status: post?.status === "failed" ? 502 : warning ? 202 : 200 });
  } catch (error) {
    if (error instanceof ContentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: translateError(error) }, { status: 500 });
  }
}
