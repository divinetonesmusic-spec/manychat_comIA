import { NextResponse, type NextRequest } from "next/server";
import { getAppPublico } from "@/lib/db/apps";
import { swScript } from "@/lib/app/pwa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** GET /a/<slug>/sw.js — o service worker do app (escopo /a/<slug>): abrir e tocar sem internet. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const a = await getAppPublico(slug);
  if (!a) return new NextResponse("// app não encontrado", { status: 404, headers: { "content-type": "text/javascript; charset=utf-8" } });
  return new NextResponse(swScript(a.slug, a.versao), {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": `/a/${a.slug}` },
  });
}
