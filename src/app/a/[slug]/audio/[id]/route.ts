import { NextResponse, type NextRequest } from "next/server";
import { r2DownloadUrl } from "@/lib/content/r2";
import { getAppPublico, getSessao } from "@/lib/db/apps";
import { temAcesso } from "@/lib/app/rotina";
import { cookieApp } from "@/lib/app/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; id: string }> };

/** Quanto vale o link do áudio: o bastante para o celular baixar e guardar (ele guarda para tocar sem internet). */
const LINK_AUDIO_SEG = 15 * 60;

/**
 * GET /a/<slug>/audio/<id>[?link=1] — só para quem tem a assinatura ativa (a sessão deste aparelho): o link assinado do R2 (15 min),
 * em JSON (?link=1, o app) ou levando a ele. O app baixa direto do R2 (o CORS do balde já aceita o endereço do UaiFlow), guarda no
 * aparelho e toca dali (sem internet também). Sem sessão ou sem acesso: 403, e nada do áudio sai.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { slug, id } = await params;
  const a = await getAppPublico(slug);
  if (!a) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });
  const quem = await getSessao(a.id, request.cookies.get(cookieApp(a.slug))?.value || "");
  if (!quem || !temAcesso(quem.acessoAte)) return NextResponse.json({ error: "Sem assinatura ativa.", codigo: "sem_acesso" }, { status: 403, headers: { "cache-control": "no-store" } });
  const audio = a.audios[id];
  if (!audio) return NextResponse.json({ error: "Áudio não encontrado." }, { status: 404 });
  const link = r2DownloadUrl(audio.key, LINK_AUDIO_SEG, undefined, { tipo: audio.contentType });
  // ?link=1 (o app): o link em JSON, e o app baixa direto do R2 (sem redirecionar de um endereço para outro, que alguns navegadores
  // tratam como pedido de outra origem sem o CORS); sem ele, leva ao áudio (abrir o endereço no navegador).
  if (request.nextUrl.searchParams.get("link") === "1") return NextResponse.json({ url: link, tipo: audio.contentType, validoSeg: LINK_AUDIO_SEG }, { headers: { "cache-control": "no-store" } });
  return NextResponse.redirect(link, { status: 302, headers: { "cache-control": "no-store" } });
}
