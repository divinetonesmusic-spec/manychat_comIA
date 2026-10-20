import { NextResponse, type NextRequest } from "next/server";
import { descadastrar, getCompradorPorToken } from "@/lib/db/funil";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/** Sair da lista (link do rodapé do e-mail e o botão «cancelar inscrição» do Gmail, que manda POST). */
async function sair(request: NextRequest, { params }: Params) {
  const { token } = await params;
  const comprador = await getCompradorPorToken(token);
  if (!comprador) return new NextResponse("Link não encontrado.", { status: 404 });
  await descadastrar(token);
  if (request.method === "POST") return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL(`/depoimento/${token}?saiu=1`, request.url), { status: 303 });
}

export const GET = sair;
export const POST = sair;
