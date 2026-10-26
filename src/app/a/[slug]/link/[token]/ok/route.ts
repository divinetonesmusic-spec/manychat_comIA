import { NextResponse, type NextRequest } from "next/server";
import { getAppPublico, usarLink } from "@/lib/db/apps";
import { comSessao, voltar } from "@/lib/app/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; token: string }> };

/** POST /a/<slug>/link/<token>/ok — o botão da página do link: entra neste aparelho (o link vale uma vez, por 30 minutos). */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug, token } = await params;
  const a = await getAppPublico(slug);
  if (!a) return new NextResponse("Página não encontrada.", { status: 404 });
  const sessao = await usarLink(a.id, token);
  if (!sessao) return voltar(request, `/a/${a.slug}?erro=vencido#entrar`);
  return comSessao(voltar(request, `/a/${a.slug}`), request, a.slug, sessao);
}
