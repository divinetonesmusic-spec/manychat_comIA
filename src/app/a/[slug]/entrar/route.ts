import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { criarLinkAcesso, getAppPublico, getAssinantePorEmail } from "@/lib/db/apps";
import { emailValido } from "@/lib/db/funil-molde";
import { passouDoLimite } from "@/lib/funil/limite";
import { temAcesso } from "@/lib/app/rotina";
import { emailEntrar, emailSemAssinatura, voltar } from "@/lib/app/web";
import { emailConfig, enviarEmail } from "@/lib/vendas/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST /a/<slug>/entrar (o formulário «Já assinei»): manda o link e o código de entrar para o e-mail da compra. A resposta na tela
 * é sempre a mesma (não diz a ninguém se um e-mail assina ou não); quem não tem a assinatura recebe, no e-mail dele, o convite.
 * Poucas tentativas seguidas por internet e por e-mail (o limite dos formulários da 0013).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const a = await getAppPublico(slug);
  if (!a) return new NextResponse("Página não encontrada.", { status: 404 });
  const form = await request.formData().catch(() => null);
  const pagina = `/a/${a.slug}`;
  if (String(form?.get("site") ?? "")) return voltar(request, pagina); // robô: nada sai
  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  if (!emailValido(email)) return voltar(request, `${pagina}?erro=email#entrar`);
  const config = emailConfig();
  if (!config) return voltar(request, `${pagina}?erro=semEmail#entrar`);
  if (await passouDoLimite(request, "app", email)) return voltar(request, `${pagina}?erro=limite#entrar`);
  try {
    const base = getAppBaseUrl(request.url);
    const assinante = await getAssinantePorEmail(a.id, email);
    if (assinante && temAcesso(assinante.acessoAte)) {
      const { token, codigo } = await criarLinkAcesso(assinante.id);
      await enviarEmail(config, { para: email, ...emailEntrar(a.app, `${base}${pagina}/link/${token}`, codigo) });
    } else {
      await enviarEmail(config, { para: email, ...emailSemAssinatura(a.app, `${base}${pagina}/assinar`) });
    }
    return voltar(request, `${pagina}?enviado=${encodeURIComponent(email)}#entrar`);
  } catch (error) {
    console.error("[app] não consegui mandar o link de entrar:", error instanceof Error ? error.message : error);
    return voltar(request, `${pagina}?erro=rede#entrar`);
  }
}
