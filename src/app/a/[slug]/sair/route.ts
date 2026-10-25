import { NextResponse, type NextRequest } from "next/server";
import { getAppPublico, sairDaSessao } from "@/lib/db/apps";
import { cookieApp, voltar } from "@/lib/app/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** POST /a/<slug>/sair — sai deste aparelho (a sessão é apagada e o cookie também). */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const a = await getAppPublico(slug);
  if (!a) return new NextResponse("Página não encontrada.", { status: 404 });
  await sairDaSessao(request.cookies.get(cookieApp(a.slug))?.value || "");
  const resposta = voltar(request, `/a/${a.slug}`);
  resposta.cookies.set(cookieApp(a.slug), "", { path: `/a/${a.slug}`, maxAge: 0 });
  return resposta;
}
