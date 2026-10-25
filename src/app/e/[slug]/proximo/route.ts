import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { getEntregaPublica, registrarEventoEntrega } from "@/lib/db/funil-molde";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** GET /e/<slug>/proximo — o convite para o próximo degrau: conta o toque e leva ao link que o Molde mandou (o link que conta cliques). */
export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const e = await getEntregaPublica(slug);
  const link = e?.pacote?.proximo?.link;
  if (!e || !link || !/^https:\/\//i.test(link)) return NextResponse.redirect(new URL(e ? `/e/${e.slug}` : "/", getAppBaseUrl(request.url)), { status: 302 });
  await registrarEventoEntrega(e.id, "proximo", null, null).catch((err: unknown) => console.error("[entrega] toque no próximo passo não contado:", err));
  return NextResponse.redirect(link, { status: 302, headers: { "cache-control": "no-store" } });
}
