import { NextResponse, type NextRequest } from "next/server";
import { getAppPublico } from "@/lib/db/apps";
import { manifestDe } from "@/lib/app/pwa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** GET /a/<slug>/manifest.webmanifest — o nome, o ícone e as cores da marca do avatar (o «Adicionar à tela de início»). */
export async function GET(_request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const a = await getAppPublico(slug);
  if (!a) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });
  return new NextResponse(JSON.stringify(manifestDe(a.slug, a.app)), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=300" } });
}
