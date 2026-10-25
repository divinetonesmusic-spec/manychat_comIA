import { NextResponse, type NextRequest } from "next/server";
import { getAppPublico, getSessao, registrarUso } from "@/lib/db/apps";
import { temAcesso } from "@/lib/app/rotina";
import { cookieApp } from "@/lib/app/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST /a/<slug>/uso { noite, fuso, em? } — o toque no áudio do dia conta o dia (no fuso do aparelho). Tocado sem internet, o app
 * guarda e manda depois, com o momento do toque (`em`, até 3 dias para trás): o dia certo entra nos dias seguidos.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const a = await getAppPublico(slug);
  if (!a) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });
  const quem = await getSessao(a.id, request.cookies.get(cookieApp(a.slug))?.value || "");
  if (!quem || !temAcesso(quem.acessoAte)) return NextResponse.json({ error: "Sem assinatura ativa.", codigo: "sem_acesso" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const noite = Math.round(Number(body.noite));
  const em = typeof body.em === "string" ? new Date(body.em) : null;
  const agora = Date.now();
  const momento = em && !Number.isNaN(em.getTime()) && em.getTime() <= agora + 60_000 && em.getTime() >= agora - 3 * 86_400_000 ? em : new Date();
  const novo = await registrarUso(quem.id, { fuso: typeof body.fuso === "string" ? body.fuso : null, noite: noite >= 1 && noite <= a.app.dias.length ? noite : null, agora: momento });
  return NextResponse.json({ ok: true, novo }, { headers: { "cache-control": "no-store" } });
}
