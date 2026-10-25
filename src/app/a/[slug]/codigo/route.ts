import { NextResponse, type NextRequest } from "next/server";
import { getAppPublico, usarCodigo } from "@/lib/db/apps";
import { emailValido } from "@/lib/db/funil-molde";
import { passouDoLimite } from "@/lib/funil/limite";
import { comSessao, voltar } from "@/lib/app/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST /a/<slug>/codigo (o código de 6 números do e-mail): no iPhone o link do e-mail abre no Safari, fora do app instalado; o
 * código entra no próprio app. 5 códigos errados vencem o link (e o limite dos formulários conta cada tentativa).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const a = await getAppPublico(slug);
  if (!a) return new NextResponse("Página não encontrada.", { status: 404 });
  const form = await request.formData().catch(() => null);
  const pagina = `/a/${a.slug}`;
  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  const numero = String(form?.get("codigo") ?? "").replace(/\D/g, "");
  const volta = `${pagina}?enviado=${encodeURIComponent(email)}`;
  if (!emailValido(email)) return voltar(request, `${pagina}?erro=email#entrar`);
  if (await passouDoLimite(request, "app", "")) return voltar(request, `${volta}&erro=limite#entrar`);
  try {
    const r = await usarCodigo(a.id, email, numero);
    if ("erro" in r) return voltar(request, `${volta}&erro=codigo#entrar`);
    return comSessao(voltar(request, pagina), request, a.slug, r.sessao);
  } catch (error) {
    console.error("[app] não consegui conferir o código:", error instanceof Error ? error.message : error);
    return voltar(request, `${volta}&erro=rede#entrar`);
  }
}
