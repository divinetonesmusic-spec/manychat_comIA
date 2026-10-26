import { NextResponse, type NextRequest } from "next/server";
import { getAppPublico, getSessao, salvarLembrete } from "@/lib/db/apps";
import { temAcesso } from "@/lib/app/rotina";
import { cookieApp } from "@/lib/app/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** POST /a/<slug>/lembrete { ativo, hora, fuso } — o lembrete diário por e-mail é escolha da pessoa (começa desligado). */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const a = await getAppPublico(slug);
  if (!a) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });
  const quem = await getSessao(a.id, request.cookies.get(cookieApp(a.slug))?.value || "");
  if (!quem || !temAcesso(quem.acessoAte)) return NextResponse.json({ error: "Sem assinatura ativa.", codigo: "sem_acesso" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const hora = Number(body.hora);
  await salvarLembrete(quem.id, { ativo: body.ativo === true, hora: Number.isFinite(hora) ? hora : quem.lembreteHora, fuso: typeof body.fuso === "string" ? body.fuso : null });
  return NextResponse.json({ ok: true, ativo: body.ativo === true }, { headers: { "cache-control": "no-store" } });
}
