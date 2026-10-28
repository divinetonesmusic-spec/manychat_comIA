import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { emailValido, getEntregaPublica, registrarEventoEntrega, salvarLead } from "@/lib/db/funil-molde";
import { deValido, origemValida } from "@/lib/funil/quiz";
import { textosDe } from "@/lib/funil/textos";
import { COOKIE_ENTREGA_DIAS, cookieEntrega } from "@/lib/funil/web";
import { passouDoLimite } from "@/lib/funil/limite";
import { pedirConfirmacao } from "@/lib/funil/confirmacao";
import { mandarMaterial } from "@/lib/funil/entrega-email";
import { lerMarca } from "@/lib/funil/marca";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function voltar(request: NextRequest, caminho: string) {
  return NextResponse.redirect(new URL(caminho, getAppBaseUrl(request.url)), { status: 303, headers: { "cache-control": "no-store" } });
}

/**
 * POST /e/<slug>/email (o formulário da página de entrega): guarda a pessoa na Lista própria (com a origem e o
 * consentimento que ela marcou) e libera o download (cookie de 30 dias, só desta página).
 * K7 (v138): e manda o material por e-mail (o link /e/<slug>/m/<código> para baixar de novo quando quiser), quando o envio de
 * e-mail está configurado (RESEND_API_KEY + EMAIL_REMETENTE). Sem ele, ou se o serviço falhar, o download na tela continua
 * na hora; ?enviado=1 só quando o e-mail saiu.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const e = await getEntregaPublica(slug);
  if (!e) return new NextResponse("Página não encontrada.", { status: 404 });
  const form = await request.formData().catch(() => null);
  const pagina = `/e/${e.slug}`;
  if (String(form?.get("site") ?? "")) return voltar(request, pagina); // robô: não grava
  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  if (!emailValido(email)) return voltar(request, `${pagina}?erro=email#receber`);
  if (await passouDoLimite(request, "entrega", email)) return voltar(request, `${pagina}?erro=limite#receber`);
  const origem = origemValida(form?.get("o"));
  const de = deValido(String(form?.get("de") ?? "") || null);
  try {
    const lead = await salvarLead({
      accountId: e.account_id,
      molde: e.molde,
      email,
      nome: String(form?.get("nome") ?? "").trim().slice(0, 80) || null,
      fonte: "entrega",
      origem,
      de,
      entregaId: e.id,
      consentimento: form?.get("consentimento") === "on",
      consentimentoTexto: textosDe(e.pacote?.idioma).consentimento,
    });
    await registrarEventoEntrega(e.id, "email", origem, de);
    const confirmar = await pedirConfirmacao(lead, e.pacote?.idioma ?? "pt-BR");
    const base = getAppBaseUrl(request.url);
    const marca = lerMarca(e.pacote?.marca);
    const proximo = e.pacote?.proximo;
    const envio = await mandarMaterial({
      para: lead.email,
      titulo: e.titulo,
      subtitulo: e.pacote?.subtitulo,
      itens: e.pacote?.itens,
      idioma: e.pacote?.idioma,
      nome: String(form?.get("nome") ?? "").trim().slice(0, 80) || null,
      baixarUrl: `${base}${pagina}/m/${lead.codigoLead}`,
      sairUrl: `${base}/lista/sair/${lead.codigoLead}`,
      proximo: proximo && proximo.link ? { titulo: proximo.titulo, texto: proximo.texto, url: `${base}${pagina}/proximo` } : null,
      marca: { nome: marca.nome, primaria: marca.primaria, textoPrimaria: marca.textoPrimaria },
    });
    const q = [confirmar ? "confirmar=1" : "", envio === "enviado" ? "enviado=1" : ""].filter(Boolean).join("&");
    const resposta = voltar(request, `${pagina}${q ? `?${q}` : ""}#receber`);
    resposta.cookies.set(cookieEntrega(e.slug), lead.codigoLead, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: pagina, maxAge: COOKIE_ENTREGA_DIAS * 86400 });
    return resposta;
  } catch (error) {
    console.error("[entrega] não consegui guardar o e-mail:", error instanceof Error ? error.message : error);
    return voltar(request, `${pagina}?erro=rede#receber`);
  }
}
