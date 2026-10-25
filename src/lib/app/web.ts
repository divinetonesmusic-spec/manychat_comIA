/**
 * Pequenas regras das páginas públicas do app por assinatura (/a/<slug>, 0018): o cookie da sessão do aparelho, o redirecionar
 * de volta e os e-mails (o link de entrar e o lembrete). Os e-mails saem pelo mesmo envio do UaiFlow (Resend: RESEND_API_KEY +
 * EMAIL_REMETENTE, os do pedido de depoimento).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import type { AppPacote } from "@/lib/app/pacote";
import { textosApp } from "@/lib/app/textos";
import { SESSAO_DIAS } from "@/lib/db/apps";

/** O cookie da sessão deste app, só para /a/<slug>. */
export function cookieApp(slug: string) {
  return `uf_a_${slug.replace(/-/g, "_")}`;
}

export function voltar(request: NextRequest, caminho: string) {
  return NextResponse.redirect(new URL(caminho, getAppBaseUrl(request.url)), { status: 303, headers: { "cache-control": "no-store" } });
}

export function comSessao(resposta: NextResponse, request: NextRequest, slug: string, sessao: string) {
  resposta.cookies.set(cookieApp(slug), sessao, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: `/a/${slug}`, maxAge: SESSAO_DIAS * 86400 });
  return resposta;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** O e-mail com o link e o código de entrar. */
export function emailEntrar(app: AppPacote, link: string, codigo: string) {
  const T = textosApp(app.idioma);
  const assunto = T.emailLinkAssunto(app.titulo);
  const texto = [T.emailLinkTexto, link, "", T.emailLinkCodigo, codigo, "", T.emailLinkFim].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111">
<p>${esc(T.emailLinkTexto)}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${esc(T.entrar)}</a></p>
<p>${esc(T.emailLinkCodigo)} <strong style="font-size:22px;letter-spacing:4px">${esc(codigo)}</strong></p>
<p style="font-size:14px;color:#555">${esc(T.emailLinkFim)}</p>
</div>`;
  return { assunto, texto, html };
}

/** O e-mail de quem pediu o link sem ter a assinatura (não diz isso a quem digitou o e-mail na página: vai só para a caixa dele). */
export function emailSemAssinatura(app: AppPacote, assinarUrl: string) {
  const T = textosApp(app.idioma);
  return {
    assunto: T.emailSemAssinaturaAssunto(app.titulo),
    texto: `${T.emailSemAssinatura}\n${assinarUrl}`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111"><p>${esc(T.emailSemAssinatura)}</p><p><a href="${esc(assinarUrl)}">${esc(assinarUrl)}</a></p></div>`,
  };
}

/** O lembrete diário: o texto do avatar, a noite de hoje, o botão e o «sair» (o endereço postal no rodapé, se houver). */
export function emailLembrete(app: AppPacote, input: { noite: number; appUrl: string; sairUrl: string; enderecoPostal: string | null }) {
  const T = textosApp(app.idioma);
  const noite = T.noite(input.noite, app.dias.length);
  const dia = app.dias[input.noite - 1];
  const linhas = [app.lembrete.texto, "", `${noite}${dia ? ` · ${dia.titulo}` : ""}`, input.appUrl, "", `${T.emailLembreteSair} ${input.sairUrl}`, ...(input.enderecoPostal ? [input.enderecoPostal] : [])];
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111">
<p>${esc(app.lembrete.texto)}</p>
<p><strong>${esc(noite)}</strong>${dia ? ` · ${esc(dia.titulo)}` : ""}</p>
<p><a href="${esc(input.appUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${esc(T.emailLembreteBotao)}</a></p>
<p style="font-size:12px;color:#777">${esc(T.emailLembreteSair)} <a href="${esc(input.sairUrl)}">${esc(T.sairLembreteBotao)}</a>.${input.enderecoPostal ? `<br>${esc(input.enderecoPostal)}` : ""}${app.aviso ? `<br>${esc(app.aviso)}` : ""}</p>
</div>`;
  return { assunto: app.lembrete.assunto, texto: linhas.join("\n"), html };
}
