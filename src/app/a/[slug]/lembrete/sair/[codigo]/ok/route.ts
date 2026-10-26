import { NextResponse, type NextRequest } from "next/server";
import { getAppPublico, sairDoLembrete } from "@/lib/db/apps";
import { voltar } from "@/lib/app/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; codigo: string }> };

/**
 * POST /a/<slug>/lembrete/sair/<codigo>/ok — desliga o lembrete. É também o endereço do «cancelar inscrição» de um toque do
 * e-mail (cabeçalho List-Unsubscribe-Post): o programa de e-mail manda o POST direto.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug, codigo } = await params;
  const a = await getAppPublico(slug);
  if (!a) return new NextResponse("Página não encontrada.", { status: 404 });
  if (!(await sairDoLembrete(codigo))) return new NextResponse("Não encontrado.", { status: 404 });
  return voltar(request, `/a/${a.slug}/lembrete/sair/${codigo}?ok=1`);
}
