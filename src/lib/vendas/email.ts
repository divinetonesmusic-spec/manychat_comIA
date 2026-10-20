/**
 * Envio de e-mail do UaiFlow (pedido de depoimento). Usa a API HTTP do Resend (sem biblioteca), só quando
 * RESEND_API_KEY e EMAIL_REMETENTE estão nas variáveis do servidor. Sem elas, nada sai por e-mail: o painel mostra o
 * link de cada pedido para mandar à mão. A chave nunca aparece em erro nem em log.
 */
export type EmailConfig = { apiKey: string; remetente: string; responderPara: string | null; enderecoPostal: string | null };

export function emailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim() || "";
  const remetente = process.env.EMAIL_REMETENTE?.trim() || "";
  if (!apiKey || !remetente) return null;
  return {
    apiKey,
    remetente,
    responderPara: process.env.EMAIL_RESPONDER_PARA?.trim() || null,
    enderecoPostal: process.env.EMAIL_ENDERECO_POSTAL?.trim() || null,
  };
}

export const EMAIL_TIMEOUT_MS = 6000;

export class EmailError extends Error {}

export type EmailMensagem = { para: string; assunto: string; texto: string; html: string; descadastrarUrl?: string | null };

export async function enviarEmail(config: EmailConfig, mensagem: EmailMensagem, timeoutMs = EMAIL_TIMEOUT_MS) {
  const headers: Record<string, string> = {};
  if (mensagem.descadastrarUrl) {
    headers["List-Unsubscribe"] = `<${mensagem.descadastrarUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.remetente,
        to: [mensagem.para],
        subject: mensagem.assunto,
        text: mensagem.texto,
        html: mensagem.html,
        ...(config.responderPara ? { reply_to: config.responderPara } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new EmailError(error instanceof Error && error.name === "TimeoutError" ? "O serviço de e-mail não respondeu a tempo." : "Não consegui falar com o serviço de e-mail.");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new EmailError(`O serviço de e-mail recusou (${response.status})${payload.message ? `: ${String(payload.message).slice(0, 160)}` : "."}`);
  }
  return ((await response.json().catch(() => ({}))) as { id?: string }).id ?? null;
}

function escapar(texto: string) {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** O e-mail do pedido de depoimento (texto e HTML simples), com o link de sair da lista. */
export function emailPedidoDepoimento(input: { nome: string | null; produtoNome: string | null; formularioUrl: string; descadastrarUrl: string; enderecoPostal?: string | null }) {
  const ola = input.nome ? `Oi, ${input.nome.split(" ")[0]}!` : "Oi!";
  const produto = input.produtoNome || "o que você comprou";
  const assunto = `Como está sendo com ${produto}?`;
  const linhas = [
    ola,
    "",
    `Faz alguns dias que você começou com ${produto}. O que funcionou para você até agora?`,
    "",
    "Se puder, responda em 1 minuto por este link (pode mandar um print também):",
    input.formularioUrl,
    "",
    "Só usamos o que você escrever se você marcar «autorizo usar» no formulário.",
    "",
    "Obrigado!",
    "",
    `Não quer mais receber estes e-mails? ${input.descadastrarUrl}`,
    ...(input.enderecoPostal ? [input.enderecoPostal] : []),
  ];
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111">
<p>${escapar(ola)}</p>
<p>Faz alguns dias que você começou com ${escapar(produto)}. <strong>O que funcionou para você até agora?</strong></p>
<p>Se puder, responda em 1 minuto (pode mandar um print também):</p>
<p><a href="${escapar(input.formularioUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Responder</a></p>
<p style="font-size:14px;color:#555">Só usamos o que você escrever se você marcar «autorizo usar» no formulário.</p>
<p>Obrigado!</p>
<p style="font-size:12px;color:#777">Não quer mais receber estes e-mails? <a href="${escapar(input.descadastrarUrl)}">Sair da lista</a>.${input.enderecoPostal ? `<br>${escapar(input.enderecoPostal)}` : ""}</p>
</div>`;
  return { assunto, texto: linhas.join("\n"), html };
}
