/**
 * K7 (Molde v138) · o e-mail com o material grátis. Quem deixa o e-mail na página de entrega (/e/<slug>) recebe na caixa de
 * entrada o link para baixar de novo quando quiser (/e/<slug>/m/<código da pessoa>), o que tem dentro e o convite para o
 * próximo degrau, na língua do avatar e com o link de sair da lista. O download na tela continua na hora: o e-mail é um
 * reforço, nunca uma espera.
 *
 * O envio usa o mesmo serviço do pedido de depoimento (Resend, src/lib/vendas/email.ts): só com RESEND_API_KEY e
 * EMAIL_REMETENTE nas variáveis da Netlify. Sem elas, nada sai por e-mail e o Molde mostra quais variáveis faltam
 * (estadoEmailEntrega, nas respostas de /api/molde/entregas). Não precisa de atualização do banco: o limite dos formulários
 * da 0013 (3 envios por e-mail por hora) já impede que alguém encha a caixa de outra pessoa.
 */
import { emailConfig, enviarEmail, type EmailConfig } from "@/lib/vendas/email";

export const VARIAVEIS_EMAIL = ["RESEND_API_KEY", "EMAIL_REMETENTE"] as const;

export type EstadoEmailEntrega = { configurado: boolean; faltam: string[] };

/** O envio de e-mail está pronto? E, se não, quais variáveis faltam na Netlify (só os nomes; nenhum valor). */
export function estadoEmailEntrega(env: Record<string, string | undefined> = process.env): EstadoEmailEntrega {
  const faltam = VARIAVEIS_EMAIL.filter((k) => !String(env[k] ?? "").trim());
  return { configurado: faltam.length === 0, faltam: [...faltam] };
}

const TEXTOS = {
  "pt-BR": {
    assunto: (t: string) => `Seu material: ${t}`,
    ola: (n: string | null) => (n ? `Oi, ${n}!` : "Oi!"),
    aqui: "Aqui está o material que você pediu. Guarde este e-mail: o link funciona sempre que quiser baixar de novo.",
    botao: "Baixar o material",
    dentro: "O que tem dentro",
    proximo: "Quando terminar, o próximo passo",
    sair: "Não quer mais receber e-mails desta lista?",
    sairLink: "Sair da lista",
  },
  "en-US": {
    assunto: (t: string) => `Your material: ${t}`,
    ola: (n: string | null) => (n ? `Hi, ${n}!` : "Hi!"),
    aqui: "Here is the material you asked for. Keep this email: the link works whenever you want to download it again.",
    botao: "Download the material",
    dentro: "What's inside",
    proximo: "When you're done, the next step",
    sair: "Don't want emails from this list anymore?",
    sairLink: "Unsubscribe",
  },
} as const;

function escapar(texto: string) {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
function cor(value: string | undefined, padrao: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : padrao;
}

export type EmailEntregaInput = {
  titulo: string;
  subtitulo?: string;
  itens?: string[];
  idioma?: string | null;
  nome?: string | null;
  baixarUrl: string;
  sairUrl: string;
  proximo?: { titulo: string; texto?: string; url: string | null } | null;
  marca?: { nome?: string; primaria?: string; textoPrimaria?: string } | null;
  enderecoPostal?: string | null;
};

/** O e-mail do material (assunto, texto e HTML simples, com o link de sair da lista). Puro: não manda nada. */
export function emailDaEntrega(input: EmailEntregaInput) {
  const T = input.idioma === "pt-BR" || !input.idioma ? TEXTOS["pt-BR"] : TEXTOS["en-US"];
  const primeiro = input.nome ? input.nome.trim().split(/\s+/)[0].slice(0, 40) : null;
  const itens = (input.itens ?? []).filter(Boolean).slice(0, 6);
  const prox = input.proximo && input.proximo.titulo && input.proximo.url && /^https:\/\//i.test(input.proximo.url) ? input.proximo : null;
  const assinatura = input.marca?.nome ? input.marca.nome.slice(0, 80) : "";
  const linhas = [
    T.ola(primeiro),
    "",
    T.aqui,
    "",
    `${input.titulo}${input.subtitulo ? ` · ${input.subtitulo}` : ""}`,
    `${T.botao}: ${input.baixarUrl}`,
    ...(itens.length ? ["", `${T.dentro}:`, ...itens.map((i) => `- ${i}`)] : []),
    ...(prox ? ["", `${T.proximo}: ${prox.titulo}${prox.texto ? ` (${prox.texto})` : ""}`, prox.url as string] : []),
    ...(assinatura ? ["", assinatura] : []),
    "",
    `${T.sair} ${input.sairUrl}`,
    ...(input.enderecoPostal ? [input.enderecoPostal] : []),
  ];
  const fundoBotao = cor(input.marca?.primaria, "#111111");
  const textoBotao = cor(input.marca?.textoPrimaria, "#FFFFFF");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111">
<p>${escapar(T.ola(primeiro))}</p>
<p>${escapar(T.aqui)}</p>
<p><strong>${escapar(input.titulo)}</strong>${input.subtitulo ? `<br>${escapar(input.subtitulo)}` : ""}</p>
<p><a href="${escapar(input.baixarUrl)}" style="display:inline-block;background:${fundoBotao};color:${textoBotao};padding:12px 18px;border-radius:8px;text-decoration:none">${escapar(T.botao)}</a></p>
${itens.length ? `<p>${escapar(T.dentro)}:</p><ul>${itens.map((i) => `<li>${escapar(i)}</li>`).join("")}</ul>` : ""}
${prox ? `<p>${escapar(T.proximo)}: <a href="${escapar(prox.url as string)}">${escapar(prox.titulo)}</a>${prox.texto ? ` · ${escapar(prox.texto)}` : ""}</p>` : ""}
${assinatura ? `<p>${escapar(assinatura)}</p>` : ""}
<p style="font-size:12px;color:#777">${escapar(T.sair)} <a href="${escapar(input.sairUrl)}">${escapar(T.sairLink)}</a>.${input.enderecoPostal ? `<br>${escapar(input.enderecoPostal)}` : ""}</p>
</div>`;
  return { assunto: T.assunto(input.titulo).slice(0, 180), texto: linhas.join("\n"), html };
}

export type ResultadoEnvio = "enviado" | "sem_config" | "erro";

/**
 * Manda o material para a pessoa. Nunca lança: sem as variáveis, "sem_config"; um erro do serviço vai ao log e vira "erro"
 * (o download na tela já foi liberado). config: para os testes; o padrão é o das variáveis da Netlify.
 */
export async function mandarMaterial(input: EmailEntregaInput & { para: string }, config: EmailConfig | null = emailConfig()): Promise<ResultadoEnvio> {
  if (!config) return "sem_config";
  try {
    const m = emailDaEntrega({ ...input, enderecoPostal: input.enderecoPostal ?? config.enderecoPostal });
    await enviarEmail(config, { para: input.para, assunto: m.assunto, texto: m.texto, html: m.html, descadastrarUrl: input.sairUrl });
    return "enviado";
  } catch (error) {
    console.error("[entrega] não consegui mandar o material por e-mail:", error instanceof Error ? error.message : error);
    return "erro";
  }
}
