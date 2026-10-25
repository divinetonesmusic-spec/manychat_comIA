import { query } from "@/lib/db/client";
import { getAppBaseUrl } from "@/lib/env";
import { emailConfig, enviarEmail } from "@/lib/vendas/email";

/**
 * Confirmação dupla (opcional, 0013): DESLIGADA por padrão. Liga com FUNIL_CONFIRMACAO_DUPLA=1 nas variáveis do Netlify, e só
 * funciona com o envio de e-mail configurado (RESEND_API_KEY + EMAIL_REMETENTE, os mesmos do pedido de depoimento). Ligada:
 * quem marca «quero receber dicas e ofertas» recebe UM e-mail com o link /lista/confirmar/<chave>; só depois do toque a pessoa
 * conta como «na lista» (leads.confirmado_em). O resultado do quiz e o download da entrega NUNCA esperam a confirmação.
 * Nenhum outro e-mail sai daqui: a sequência de e-mails continua desligada (K-EMAILCURSO).
 */
export function confirmacaoDuplaLigada() {
  return process.env.FUNIL_CONFIRMACAO_DUPLA === "1" && Boolean(emailConfig());
}

const TEXTOS = {
  "pt-BR": { assunto: "Confirme o seu e-mail", corpo: "Toque no link para confirmar que quer receber dicas e ofertas por e-mail:", fim: "Se não foi você, ignore este e-mail: você não entra na lista." },
  "en-US": { assunto: "Please confirm your email", corpo: "Tap the link to confirm you want to receive tips and offers by email:", fim: "If this wasn't you, just ignore this email: you won't be added to the list." },
} as const;

/** Manda o e-mail de confirmação (uma vez por hora por pessoa, no máximo). Nunca lança: um erro só vai ao log. */
export async function pedirConfirmacao(lead: { id: string; email: string; codigoLead: string; consentimento: boolean; confirmadoEm: string | null }, idioma: string) {
  if (!confirmacaoDuplaLigada() || !lead.consentimento || lead.confirmadoEm) return false;
  try {
    const { rowCount } = await query(
      "update public.leads set confirmacao_enviada_em = now() where id = $1 and (confirmacao_enviada_em is null or confirmacao_enviada_em < now() - interval '1 hour')",
      [lead.id],
    );
    if (!rowCount) return false;
    const T = idioma === "pt-BR" ? TEXTOS["pt-BR"] : TEXTOS["en-US"];
    const base = getAppBaseUrl();
    const link = `${base}/lista/confirmar/${lead.codigoLead}`;
    const sair = `${base}/lista/sair/${lead.codigoLead}`;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await enviarEmail(emailConfig()!, {
      para: lead.email,
      assunto: T.assunto,
      texto: `${T.corpo}\n${link}\n\n${T.fim}`,
      html: `<p>${esc(T.corpo)}</p><p><a href="${esc(link)}">${esc(link)}</a></p><p>${esc(T.fim)}</p>`,
      descadastrarUrl: sair,
    });
    return true;
  } catch (error) {
    console.error("[lista] não consegui mandar a confirmação:", error instanceof Error ? error.message : error);
    return false;
  }
}

/** O toque no link do e-mail de confirmação. true = achou. */
export async function confirmarLead(codigoLead: string) {
  if (!/^[a-z0-9]{12,40}$/.test(codigoLead)) return false;
  const { rowCount } = await query("update public.leads set confirmado_em = coalesce(confirmado_em, now()), atualizado_em = now() where chave = $1 and descadastrado_em is null", [codigoLead]);
  return (rowCount ?? 0) > 0;
}
