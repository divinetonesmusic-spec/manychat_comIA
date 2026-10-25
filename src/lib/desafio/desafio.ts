/**
 * O desafio de 5 dias no Direct, com e-mail de reserva (Molde v134, K-EMAILCURSO revisto, migração 0017).
 *
 * O caminho de quem comenta a palavra de um post com o desafio:
 *   1 · a resposta privada ao comentário (a única mensagem que a Meta deixa mandar a quem comentou) é o convite, com o
 *       botão «Começar» (resposta rápida). O toque abre a janela de 24 h da Meta.
 *   2 · dia 1 na hora: o texto do dia com o vídeo curto do avatar, o pedido do e-mail «para não perder nenhum dia» (só com o
 *       envio de e-mail configurado) e, por último, a tarefa simples com o botão «Quero o dia 2 amanhã».
 *   3 · cada toque no botão renova a janela de 24 h: o dia seguinte entra na fila para 23 h depois do toque (antes de a janela
 *       fechar) e sai sozinho. A Meta só deixa mandar mensagem automática dentro de 24 h do último gesto da pessoa: nada sai
 *       fora disso (a fila confere de novo na hora de mandar e pula o que passou do prazo).
 *   4 · quem não tocou em 24 h depois do dia recebe o dia seguinte por e-mail (só se deu o e-mail, aceitou e não saiu da
 *       lista), um por dia; um toque no Direct depois disso volta para o Direct.
 *   5 · no fim do dia 5, o convite para a oferta: o link /d/<desafio>/ir?i=<pessoa> conta o toque e leva ao checkout com o
 *       código de compra (mo…) do desafio e da versão (A ou B). A venda que volta com esse código conta como compra.
 *
 * Este arquivo não usa banco nem nada do Node: as regras puras (o pacote, os botões, as horas, o e-mail e a comparação A/B).
 */

export type DesafioIdioma = "pt-BR" | "en-US";
export type DesafioVariante = "A" | "B";
export type DiaDesafio = {
  titulo: string;
  /** o texto da DM do dia (vai junto do vídeo) */
  texto: string;
  /** o vídeo curto do avatar (30 a 60 s), https .mp4/.mov, até 25 MB (o limite da Meta para vídeo na DM) */
  videoUrl: string | null;
  /** a tarefa simples do dia (a última mensagem do dia, com o botão) */
  tarefa: string;
  /** o rótulo do botão (até 20 letras, o limite da Meta) */
  botao: string;
  emailAssunto: string;
  emailTexto: string;
};
export type DesafioOferta = { url: string; rotulo: string; texto: string };
export type DesafioPacote = {
  titulo: string;
  idioma: DesafioIdioma;
  keyword: string;
  convite: string;
  botaoComecar: string;
  pedidoEmail: string;
  emailAnotado: string;
  oferta: DesafioOferta;
  variantes: { A: DiaDesafio[]; B: DiaDesafio[] | null };
  aviso: string;
};

export const DESAFIO_DIAS = 5;
/** O dia seguinte sai 23 h depois do toque: dentro das 24 h que o toque abre. */
export const HORAS_PROXIMO_DIA = 23;
/** Sem toque 24 h depois do dia: o próximo vai por e-mail (com e-mail e consentimento). Por e-mail, 1 dia a cada 24 h. */
export const HORAS_RESERVA = 24;
/** Amostra mínima por versão para declarar a vencedora (o combinado com o dono: 200 inscritos em cada). */
export const AMOSTRA_MINIMA = 200;
export const ORIGEM_DESAFIO = "desafio";
export const DESAFIO_PAYLOAD = "desafio:";
/** Marca do lugar do código de compra no checkout da oferta: a página do Molde põe este texto; o servidor troca. */
export const ORIGEM_MARCA_DESAFIO = "MODESAFIOORIGEM";
export const META_VIDEO_MAX_BYTES = 25 * 1024 * 1024;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

function txt(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\r/g, "").trim().slice(0, max) : "";
}
function tamanho(value: unknown) {
  return typeof value === "string" ? Array.from(value.trim()).length : 0;
}
export function urlHttps(value: unknown) {
  const t = txt(value, 2000);
  if (!/^https:\/\/[^\s]+$/i.test(t)) return null;
  try {
    return new URL(t).protocol === "https:" ? t : null;
  } catch {
    return null;
  }
}
export function slugDesafio(value: unknown) {
  const t = txt(value, 120).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return SLUG_RE.test(t) ? t : "";
}
export function slugValido(value: unknown) {
  return typeof value === "string" && SLUG_RE.test(value);
}

/** O rótulo do botão de cada dia (até 20 letras): «Quero o dia 2 amanhã» / «Send day 2 tomorrow». */
export function botaoPadrao(idioma: DesafioIdioma, proximoDia: number) {
  return idioma === "pt-BR" ? `Quero o dia ${proximoDia} amanhã` : `Send day ${proximoDia} tomorrow`;
}

const TEXTOS = {
  "pt-BR": {
    convite: "Que bom que você comentou! Preparei um desafio de 5 dias, aqui no Direct: 1 vídeo curto e 1 tarefa simples por dia. Quer começar?",
    comecar: "Começar o dia 1",
    pedidoEmail: "Para não perder nenhum dia: me passa o seu e-mail? Se um dia você não tocar no botão, o dia chega por e-mail. Só os dias do desafio e, no fim, um convite; dá para sair quando quiser.",
    anotado: "Anotado! Se um dia você não tocar no botão, o dia chega no seu e-mail.",
    combinado: (n: number) => `Combinado! O dia ${n} chega amanhã, por volta desta hora.`,
    jaMarcado: (n: number) => `Já está combinado: o dia ${n} chega amanhã, por volta desta hora.`,
    acabou: "Você já fez os 5 dias. Parabéns por ir até o fim!",
    ofertaRotulo: "Ver o convite",
    verVideo: (n: number) => `Ver o vídeo do dia ${n}`,
    sair: "Não quer mais receber estes e-mails?",
    sairLink: "Sair da lista",
    porque: "Você recebeu este e-mail porque deixou o seu endereço no desafio de 5 dias, no Direct do Instagram.",
  },
  "en-US": {
    convite: "So glad you commented! I made a 5-day challenge, right here in your DMs: 1 short video and 1 simple task a day. Want to start?",
    comecar: "Start day 1",
    pedidoEmail: "So you don't miss a day: what's your email? If you ever forget to tap the button, that day arrives by email. Only the challenge days and, at the end, one invitation; you can leave anytime.",
    anotado: "Got it! If you ever don't tap the button, that day goes to your email.",
    combinado: (n: number) => `Deal! Day ${n} arrives tomorrow, around this time.`,
    jaMarcado: (n: number) => `All set: day ${n} arrives tomorrow, around this time.`,
    acabou: "You've done all 5 days. Congrats on going all the way!",
    ofertaRotulo: "See the invite",
    verVideo: (n: number) => `Watch the day ${n} video`,
    sair: "Don't want these emails anymore?",
    sairLink: "Unsubscribe",
    porque: "You got this email because you left your address in the 5-day challenge, in our Instagram DMs.",
  },
} as const;
export function textosDesafio(idioma: DesafioIdioma) {
  return TEXTOS[idioma];
}

function lerDia(raw: unknown, i: number, idioma: DesafioIdioma, erros: string[], avisos: string[], rotulo: string): DiaDesafio {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const n = i + 1;
  const titulo = txt(r.titulo, 120);
  const texto = txt(r.texto, 1000);
  const tarefa = txt(r.tarefa, 900);
  if (!texto) erros.push(`${rotulo}: o dia ${n} está sem o texto da DM.`);
  if (!tarefa) erros.push(`${rotulo}: o dia ${n} está sem a tarefa.`);
  if (tamanho(r.texto) > 1000) erros.push(`${rotulo}: o texto do dia ${n} passa de 1000 letras (o limite da Meta).`);
  if (tamanho(r.tarefa) > 900) erros.push(`${rotulo}: a tarefa do dia ${n} passa de 900 letras.`);
  let videoUrl: string | null = null;
  if (r.videoUrl !== undefined && r.videoUrl !== null && r.videoUrl !== "") {
    videoUrl = urlHttps(r.videoUrl);
    if (!videoUrl) erros.push(`${rotulo}: o vídeo do dia ${n} precisa ser um endereço https.`);
    else if (!/\.(mp4|mov)$/i.test(new URL(videoUrl).pathname)) erros.push(`${rotulo}: o vídeo do dia ${n} precisa ser .mp4 ou .mov.`);
    const bytes = Number(r.tamanho);
    if (Number.isFinite(bytes) && bytes > META_VIDEO_MAX_BYTES) erros.push(`${rotulo}: o vídeo do dia ${n} passa de 25 MB (o limite da Meta para vídeo na DM).`);
  } else if (n === 1) {
    avisos.push(`${rotulo}: o dia 1 está sem vídeo (vai só o texto).`);
  }
  const botaoBruto = txt(r.botao, 40);
  if (botaoBruto && Array.from(botaoBruto).length > 20) erros.push(`${rotulo}: o botão do dia ${n} passa de 20 letras (o limite da Meta).`);
  const botao = n < DESAFIO_DIAS ? botaoBruto || botaoPadrao(idioma, n + 1) : "";
  const emailAssunto = txt(r.emailAssunto, 150) || (idioma === "pt-BR" ? `Dia ${n} do desafio${titulo ? `: ${titulo}` : ""}` : `Day ${n} of the challenge${titulo ? `: ${titulo}` : ""}`);
  const emailTexto = txt(r.emailTexto, 4000) || [texto, tarefa].filter(Boolean).join("\n\n");
  return { titulo, texto, videoUrl, tarefa, botao, emailAssunto, emailTexto };
}

function lerVariante(raw: unknown, idioma: DesafioIdioma, erros: string[], avisos: string[], rotulo: string) {
  const dias = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { dias?: unknown }).dias) ? (raw as { dias: unknown[] }).dias : null;
  if (!dias) {
    erros.push(`${rotulo}: mande os ${DESAFIO_DIAS} dias.`);
    return [];
  }
  if (dias.length !== DESAFIO_DIAS) erros.push(`${rotulo}: o desafio tem exatamente ${DESAFIO_DIAS} dias (vieram ${dias.length}).`);
  return dias.slice(0, DESAFIO_DIAS).map((d, i) => lerDia(d, i, idioma, erros, avisos, rotulo));
}

export type DesafioLido = { ok: true; pacote: DesafioPacote; avisos: string[] } | { ok: false; erros: string[] };

/**
 * Confere o pacote que a página do Molde manda (POST /api/molde/desafio). Regras: idioma pt-BR ou en-US; 5 dias na versão A
 * (e, se vier, 5 na B), cada um com texto e tarefa (até 1000 e 900 letras), vídeo https .mp4/.mov até 25 MB, botão até 20
 * letras; a oferta com o checkout https. Os textos que faltam (convite, botão, pedido do e-mail) ganham o padrão do idioma.
 */
export function lerDesafio(raw: unknown): DesafioLido {
  const erros: string[] = [];
  const avisos: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, erros: ["Mande o desafio (um objeto)."] };
  const r = raw as Record<string, unknown>;
  const idioma: DesafioIdioma = r.idioma === "en-US" || r.idioma === "en" ? "en-US" : "pt-BR";
  const T = TEXTOS[idioma];
  const titulo = txt(r.titulo, 120);
  if (!titulo) erros.push("O desafio está sem título.");
  const botaoComecar = txt(r.botaoComecar, 40) || T.comecar;
  if (Array.from(botaoComecar).length > 20) erros.push("O botão «Começar» passa de 20 letras (o limite da Meta).");
  const ofertaRaw = r.oferta && typeof r.oferta === "object" ? (r.oferta as Record<string, unknown>) : {};
  const ofertaUrl = urlHttps(ofertaRaw.url);
  if (!ofertaUrl) erros.push("A oferta do fim do dia 5 precisa do link do checkout (https).");
  const ofertaRotulo = txt(ofertaRaw.rotulo, 40) || T.ofertaRotulo;
  if (Array.from(ofertaRotulo).length > 20) erros.push("O botão da oferta passa de 20 letras (o limite da Meta).");
  const variantesRaw = r.variantes && typeof r.variantes === "object" ? (r.variantes as Record<string, unknown>) : { A: r.dias };
  const A = lerVariante(variantesRaw.A, idioma, erros, avisos, "Versão A");
  const B = variantesRaw.B === undefined || variantesRaw.B === null ? null : lerVariante(variantesRaw.B, idioma, erros, avisos, "Versão B");
  if (erros.length) return { ok: false, erros };
  return {
    ok: true,
    avisos,
    pacote: {
      titulo,
      idioma,
      keyword: txt(r.keyword, 40).toUpperCase(),
      convite: txt(r.convite, 1000) || T.convite,
      botaoComecar,
      pedidoEmail: txt(r.pedidoEmail, 900) || T.pedidoEmail,
      emailAnotado: txt(r.emailAnotado, 600) || T.anotado,
      oferta: { url: ofertaUrl as string, rotulo: ofertaRotulo, texto: txt(ofertaRaw.texto, 900) },
      variantes: { A, B },
      aviso: txt(r.aviso, 200),
    },
  };
}

/** Os dias da versão da pessoa (a B só existe se o desafio tiver a B; senão vale a A). */
export function diasDa(pacote: DesafioPacote, variante: DesafioVariante) {
  return variante === "B" && pacote.variantes.B ? pacote.variantes.B : pacote.variantes.A;
}

/** O payload das respostas rápidas: desafio:<slug>:comecar (o convite) e desafio:<slug>:prox (o botão de cada dia). */
export function payloadDesafio(slug: string, acao: "comecar" | "prox") {
  return `${DESAFIO_PAYLOAD}${slug}:${acao}`;
}
export function lerPayloadDesafio(payload: string | null | undefined) {
  if (!payload || !payload.startsWith(DESAFIO_PAYLOAD)) return null;
  const [slug, acao] = payload.slice(DESAFIO_PAYLOAD.length).split(":");
  if (!slugValido(slug) || (acao !== "comecar" && acao !== "prox")) return null;
  return { slug, acao: acao as "comecar" | "prox" };
}

/** O que a página manda no pacote do post (automationOptions.desafio): { id } do desafio publicado. */
export function parseDesafioPost(value: unknown): { id: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const id = typeof (value as { id?: unknown }).id === "string" ? ((value as { id: string }).id).trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? { id } : undefined;
}

/** O primeiro e-mail que aparece num texto (a pessoa responde o pedido no Direct), ou null. */
export function emailNoTexto(texto: string | null | undefined) {
  const m = String(texto ?? "").match(/[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}/i);
  if (!m) return null;
  const email = m[0].replace(/[.]+$/, "").toLowerCase();
  return email.length <= 254 ? email : null;
}

/** A versão de quem entra: a que tem menos gente (empate → A). Sem a versão B, sempre A. */
export function sortearVariante(temB: boolean, contagem: { A: number; B: number }): DesafioVariante {
  if (!temB) return "A";
  return contagem.B < contagem.A ? "B" : "A";
}

/** O checkout da oferta com o código de compra: no lugar da marca, ou em ?src= (sem a marca). null = endereço ruim. */
export function checkoutComCodigo(base: string, codigo: string) {
  try {
    const comCodigo = base.includes(ORIGEM_MARCA_DESAFIO) ? base.split(ORIGEM_MARCA_DESAFIO).join(codigo) : base;
    const url = new URL(comCodigo);
    if (!base.includes(ORIGEM_MARCA_DESAFIO) && !url.searchParams.has("src")) url.searchParams.set("src", codigo);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export type NumerosVariante = { inscritos: number; dia5: number; compras: number };
export type Comparacao = { vencedora: DesafioVariante | null; frase: string; minimo: number; p: number | null };

function normalCdf(z: number) {
  // aproximação de Abramowitz e Stegun (7.1.26), erro < 1,5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
/** Teste de duas proporções (bicaudal): o p-valor da diferença entre a/na e b/nb. */
export function pDuasProporcoes(a: number, na: number, b: number, nb: number) {
  if (na <= 0 || nb <= 0) return 1;
  const p = (a + b) / (na + nb);
  const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
  if (!se) return 1;
  const z = (a / na - b / nb) / se;
  return 2 * (1 - normalCdf(Math.abs(z)));
}
const pct = (x: number, n: number) => (n ? Math.round((x / n) * 1000) / 10 : 0);

/**
 * A comparação A/B: a vencedora só sai com 200 inscritos (ou mais) em CADA versão e a diferença de compras por inscrito
 * com p < 0,05 (teste de duas proporções). Antes disso, a frase diz quanto falta; a chegada ao dia 5 aparece como pista,
 * nunca decide.
 */
export function compararVariantes(A: NumerosVariante, B: NumerosVariante | null, minimo = AMOSTRA_MINIMA): Comparacao {
  if (!B) return { vencedora: null, frase: "Só uma versão neste desafio.", minimo, p: null };
  const falta = Math.max(0, minimo - A.inscritos) + Math.max(0, minimo - B.inscritos);
  const pista = `Chegaram ao dia 5: A ${pct(A.dia5, A.inscritos)} %, B ${pct(B.dia5, B.inscritos)} %. Compraram: A ${pct(A.compras, A.inscritos)} %, B ${pct(B.compras, B.inscritos)} %.`;
  if (A.inscritos < minimo || B.inscritos < minimo) {
    return { vencedora: null, frase: `Ainda sem vencedora: cada versão precisa de ${minimo} inscritos (A tem ${A.inscritos}, B tem ${B.inscritos}; faltam ${falta}). ${pista}`, minimo, p: null };
  }
  if (!A.compras && !B.compras) return { vencedora: null, frase: `Ainda sem vencedora: nenhuma compra nas duas versões. ${pista}`, minimo, p: null };
  const p = pDuasProporcoes(A.compras, A.inscritos, B.compras, B.inscritos);
  if (p >= 0.05) return { vencedora: null, frase: `Empate por enquanto: a diferença de compras ainda pode ser sorte (p = ${p.toFixed(2)}). Continue até a diferença ficar clara. ${pista}`, minimo, p };
  const v: DesafioVariante = A.compras / A.inscritos >= B.compras / B.inscritos ? "A" : "B";
  return { vencedora: v, frase: `A versão ${v} vende mais por inscrito (p = ${p.toFixed(3)}). ${pista}`, minimo, p };
}

function escapar(texto: string) {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
function paragrafos(texto: string) {
  return texto.split(/\n{2,}/).map((p) => `<p>${escapar(p).replace(/\n/g, "<br>")}</p>`).join("\n");
}

/** O e-mail de reserva de um dia (texto e HTML simples), com o vídeo, a tarefa, a oferta no dia 5 e o «sair da lista». */
export function emailDoDia(input: { pacote: DesafioPacote; dia: DiaDesafio; n: number; ofertaUrl: string | null; descadastrarUrl: string; enderecoPostal?: string | null }) {
  const { pacote, dia, n } = input;
  const T = TEXTOS[pacote.idioma];
  const oferta = n === DESAFIO_DIAS && input.ofertaUrl ? { url: input.ofertaUrl, rotulo: pacote.oferta.rotulo, texto: pacote.oferta.texto } : null;
  const linhas = [
    dia.emailTexto,
    ...(dia.videoUrl ? ["", `${T.verVideo(n)}: ${dia.videoUrl}`] : []),
    ...(dia.emailTexto.includes(dia.tarefa) ? [] : ["", dia.tarefa]),
    ...(oferta ? ["", ...(oferta.texto ? [oferta.texto] : []), `${oferta.rotulo}: ${oferta.url}`] : []),
    "",
    "—",
    T.porque,
    `${T.sair} ${input.descadastrarUrl}`,
    ...(input.enderecoPostal ? [input.enderecoPostal] : []),
    ...(pacote.aviso ? [pacote.aviso] : []),
  ];
  const botao = (url: string, rotulo: string) => `<p><a href="${escapar(url)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${escapar(rotulo)}</a></p>`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111;max-width:560px">
${paragrafos(dia.emailTexto)}
${dia.videoUrl ? botao(dia.videoUrl, T.verVideo(n)) : ""}
${dia.emailTexto.includes(dia.tarefa) ? "" : paragrafos(dia.tarefa)}
${oferta ? `${oferta.texto ? paragrafos(oferta.texto) : ""}${botao(oferta.url, oferta.rotulo)}` : ""}
<p style="font-size:12px;color:#777">${escapar(T.porque)}<br>${escapar(T.sair)} <a href="${escapar(input.descadastrarUrl)}">${escapar(T.sairLink)}</a>.${input.enderecoPostal ? `<br>${escapar(input.enderecoPostal)}` : ""}${pacote.aviso ? `<br>${escapar(pacote.aviso)}` : ""}</p>
</div>`;
  return { assunto: dia.emailAssunto, texto: linhas.join("\n"), html };
}
