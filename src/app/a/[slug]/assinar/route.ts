import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { getAppPublico } from "@/lib/db/apps";
import { origemValida } from "@/lib/funil/quiz";
import { checkoutComOrigem } from "@/lib/app/pacote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /a/<slug>/assinar?o=<código do post> — leva ao link de pagamento da assinatura com a origem do post (o mesmo código «mo…» que
 * o link que conta cliques usa: a venda volta no aviso com ele). Sem link de pagamento ainda: volta para a página do app.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const a = await getAppPublico(slug);
  if (!a) return new NextResponse("Página não encontrada.", { status: 404 });
  const origem = origemValida(request.nextUrl.searchParams.get("o")) ?? origemValida(request.nextUrl.searchParams.get("utm_content"));
  const destino = checkoutComOrigem(a.app.checkout, origem);
  return NextResponse.redirect(destino ?? new URL(`/a/${a.slug}`, getAppBaseUrl(request.url)), { status: 302, headers: { "cache-control": "no-store" } });
}
