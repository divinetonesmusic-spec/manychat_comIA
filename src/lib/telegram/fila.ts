import { query } from "@/lib/db/client";
import {
  cancelarRascunho,
  confirmarRascunho,
  contarFila,
  criarRascunho,
  custoDoPedido,
  decidirFila,
  escolherAvatar,
  esperarMotivo,
  FILA_STATES,
  FOTOS_MAX,
  gastoDoMes,
  getFila,
  isMissing0016,
  itemEsperandoMotivo,
  largarMotivo,
  listarAvatares,
  RASCUNHO_MINUTOS,
  type AvatarRow,
  type Decisao,
  type DecisaoVia,
  type FilaDecision,
  type FilaPedido,
  type FilaRow,
  type FilaState,
} from "@/lib/molde/fila";
import { formatSaoPauloTime } from "@/lib/time";
import { answerCallback, editTelegramMessage, sendTelegramWithButtons, telegramBotConfig, type InlineButton } from "@/lib/telegram/api";
import { callbacksEnabled, signCallback, type CallbackPayload } from "@/lib/telegram/callback-data";
import { atualizarProgresso } from "@/lib/telegram/progresso";

/**
 * O Telegram da fila única (Molde v134, F-MCP parte 1): APROVAR e PEDIR.
 *
 * Aprovar: quando um item da fila fica «para aprovar», sai a prévia com «Aprovar» / «Refazer». «Refazer» pede o motivo em
 * texto (a próxima mensagem da conversa, em até 15 min); só então a decisão vale. A página aplica a decisão no pedido dela
 * com a mesma regra da Caixa de aprovações (nada é gerado de novo sozinho).
 *
 * Pedir: comandos em português no chat do robô. «/reel <tema>» (ou «/novo reel <tema>») e «/fotos [1 a 4] <descrição>».
 * Com vários avatares, os botões de cada um; depois, o custo e o 2º toque «Confirmar · US$ X». Nada entra na fila (e nada
 * gasta) com 1 toque só. «/status» mostra a fila; «/ajuda» os comandos; «/cancelar» larga a espera do motivo.
 * Só a conversa TELEGRAM_CHAT_ID (e, se definido, só as pessoas de TELEGRAM_ALLOWED_USER_IDS) chega aqui (o webhook confere).
 * Nada aqui lança erro para o webhook: a resposta é sempre uma frase.
 */

const ESTADO_NOME: Record<FilaState, string> = {
  rascunho: "rascunho",
  na_fila: "na fila",
  produzindo: "produzindo",
  na_revisao: "na revisão",
  para_aprovar: "para aprovar",
  aprovado: "aprovado",
  refazer: "para refazer",
  pronto: "pronto",
  erro: "com erro",
  cancelado: "cancelado",
};

const TIPO_NOME: Record<string, string> = {
  fotos: "as fotos",
  flow_video: "o vídeo do gerador de cenas",
  reel_final: "o vídeo final",
  heygen: "o vídeo do avatar",
  voz: "a narração",
  reel: "o Reel",
  produto: "o produto",
  ebook: "o ebook",
  lp: "a página de venda",
  quiz: "o quiz",
  marca: "a marca",
  carrossel: "o carrossel",
  stories: "os stories",
};
const tipoNome = (tipo: string) => TIPO_NOME[tipo] ?? "o pedido";

export const usd = (value: number) => `US$ ${(Math.round(value * 100) / 100).toFixed(2).replace(".", ",")}`;

function shorten(text: string, max: number) {
  const clean = String(text ?? "").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function previewLink(item: Pick<FilaRow, "previa">) {
  const p = item.previa ?? {};
  return p.video || p.imagem || p.audio || p.link || null;
}

// ---------- aprovar ----------

/** O que cada decisão mostra no botão (e, no pedido de gasto, o custo no «Aprovar»). */
const BOTAO: Record<Decisao, string> = {
  aprovar: "Aprovar",
  refazer: "Refazer",
  corrigir: "Corrigir",
  publicar: "Publicar mesmo assim",
  gravar: "Gravar",
  "nao-gravar": "Não gravar",
  completar: "Completar na página",
  cancelar: "Cancelar",
};
/** A letra do botão (callback-data.ts). «completar» não tem botão: é na página. */
const LETRA: Partial<Record<Decisao, "a" | "r" | "k" | "p" | "g" | "o" | "e">> = {
  aprovar: "a", refazer: "r", corrigir: "k", publicar: "p", gravar: "g", "nao-gravar": "o", cancelar: "e",
};
export const DECISAO_DA_LETRA: Record<string, Decisao> = { a: "aprovar", k: "corrigir", p: "publicar", g: "gravar", o: "nao-gravar", e: "cancelar" };

const MOTIVO_TITULO: Record<string, string> = {
  revisor: "o revisor reprovou",
  publico: "vai a público e precisa do seu sim",
  gasto: "vai gastar e precisa do seu sim",
  "faltam-dados": "faltam dados",
  pecas: "quer mudar uma peça do projeto",
};

/** O pedido de aprovação do orquestrador: o motivo, a pergunta, os achados do revisor (na hora) e o custo. */
function orquestradorApprovalText(item: FilaRow, gasto: { gastoUsd: number; limiteUsd: number } | null, options: { decided?: boolean }) {
  const a = item.aprovacao!;
  const avatar = item.avatar ? ` de ${item.avatar}` : "";
  const versao = item.rodada > 1 ? ` Versão ${item.rodada}.` : "";
  const link = previewLink(item);
  const lines: Array<string | null> = [
    `Molde: «${shorten(item.titulo || item.tipo, 80)}»${avatar}: ${MOTIVO_TITULO[a.motivo] ?? "precisa do seu sim"}.${versao}`,
    a.pergunta ? `\n${shorten(a.pergunta, 500)}` : null,
    a.resumo ? `\n${shorten(a.resumo, 900)}` : null,
  ];
  if (a.achados?.length) {
    lines.push(`\nO revisor achou ${a.achados.length} problema${a.achados.length > 1 ? "s" : ""}:`);
    a.achados.slice(0, 12).forEach((x, i) => {
      const partes = [x.lugar ? `${shorten(x.lugar, 80)}:` : null, x.trecho ? `«${shorten(x.trecho, 160)}»` : null, x.porque ? `— ${shorten(x.porque, 220)}` : null];
      lines.push(`${i + 1}. ${partes.filter(Boolean).join(" ")}${x.troca ? `\n   Troca: «${shorten(x.troca, 160)}»` : ""}`);
    });
    if (a.achados.length > 12) lines.push(`… e mais ${a.achados.length - 12} (veja na página).`);
  }
  if (a.custo != null) {
    lines.push(`\nCusto: ≈ ${usd(a.custo)}.${gasto ? ` Gasto do mês até agora: ${usd(gasto.gastoUsd)} de ${usd(gasto.limiteUsd)}.` : ""}`);
  }
  if (link) lines.push(`\nPrévia: ${link}`);
  if (!options.decided) {
    if (!callbacksEnabled()) lines.push("\nDecida pela página do Molde.");
    else if (a.motivo === "revisor") lines.push("\n«Corrigir» aplica só as trocas do revisor; «Refazer» pergunta o que mudar; «Publicar mesmo assim» é escolha sua.");
    else if (a.opcoes.includes("completar")) lines.push("\nAbra a página do Molde para completar (ou toque em «Cancelar»).");
    else if (a.opcoes.includes("refazer")) lines.push("\nToque numa opção («Refazer» pergunta o que mudar).");
  }
  return lines.filter((l) => l !== null).join("\n");
}

/** Texto da mensagem de aprovação de um item da fila. */
export function filaApprovalText(item: FilaRow, options: { decided?: boolean; gasto?: { gastoUsd: number; limiteUsd: number } | null } = {}) {
  if (item.aprovacao) return orquestradorApprovalText(item, options.gasto ?? null, options);
  const avatar = item.avatar ? ` de ${item.avatar}` : "";
  const versao = item.rodada > 1 ? ` Versão ${item.rodada}.` : "";
  const link = previewLink(item);
  const lines = [
    `Molde: ${tipoNome(item.tipo)} «${shorten(item.titulo || item.tipo, 80)}»${avatar} está pronto para aprovar.${versao}`,
    item.previa?.texto ? `\n${shorten(item.previa.texto, 700)}` : null,
    link ? `\nPrévia: ${link}` : null,
  ];
  if (!options.decided) {
    lines.push(callbacksEnabled()
      ? "\nToque em «Aprovar» ou em «Refazer» (aí eu pergunto o que mudar)."
      : "\nAprove pela página do Molde.");
  }
  return lines.filter(Boolean).join("\n");
}

const ONDE: Record<DecisaoVia, string> = { telegram: "pelo Telegram", pagina: "pela página", mcp: "pelo Claude" };
const DECIDIDO: Record<Decisao, string> = {
  aprovar: "Aprovado",
  refazer: "Pedido para refazer",
  corrigir: "Pedido para corrigir (só as trocas do revisor)",
  publicar: "Publicar mesmo assim (escolha do dono)",
  gravar: "Gravar",
  "nao-gravar": "Não gravar",
  completar: "Completado",
  cancelar: "Cancelado",
};

export function filaDecisionLine(d: Pick<FilaDecision, "decisao" | "via" | "em" | "nota">) {
  const hora = formatSaoPauloTime(new Date(d.em));
  const onde = ONDE[d.via] ?? "pela página";
  return `${DECIDIDO[d.decisao] ?? "Decidido"} às ${hora} (${onde})${d.nota ? `: «${shorten(d.nota, 300)}»` : ""}.`;
}

function approvalButtons(item: FilaRow): InlineButton[][] | null {
  if (!callbacksEnabled()) return null;
  if (item.aprovacao) {
    const a = item.aprovacao;
    const botoes: Array<InlineButton & { decisao: Decisao }> = [];
    for (const decisao of a.opcoes) {
      const letra = LETRA[decisao];
      const data = letra ? signCallback({ kind: "f", action: letra, id: item.id, version: item.rodada }) : null;
      if (!data) continue;
      const texto = decisao === "aprovar" && a.motivo === "gasto" && a.custo != null ? `Aprovar o gasto · ${usd(a.custo)}` : BOTAO[decisao];
      botoes.push({ text: texto, callback_data: data, decisao });
    }
    // de 2 em 2; «Publicar mesmo assim» e «Cancelar» em linhas próprias, embaixo
    const linhas: InlineButton[][] = [];
    const principais = botoes.filter((x) => x.decisao !== "publicar" && x.decisao !== "cancelar");
    for (let i = 0; i < principais.length; i += 2) linhas.push(principais.slice(i, i + 2));
    for (const fim of ["publicar", "cancelar"] as const) {
      const x = botoes.find((y) => y.decisao === fim);
      if (x) linhas.push([x]);
    }
    const limpo = linhas.map((linha) => linha.map(({ text, callback_data }) => ({ text, callback_data })));
    return limpo.length ? limpo : null;
  }
  const aprovar = signCallback({ kind: "f", action: "a", id: item.id, version: item.rodada });
  const refazer = signCallback({ kind: "f", action: "r", id: item.id, version: item.rodada });
  return aprovar && refazer ? [[{ text: "Aprovar", callback_data: aprovar }, { text: "Refazer", callback_data: refazer }]] : null;
}

/** Manda a aprovação do item (se ele ainda espera). Grava a tentativa e o número da mensagem. Nunca lança. */
export async function sendFilaApproval(id: string, options: { timeoutMs?: number } = {}) {
  try {
    if (!telegramBotConfig()) return false;
    const item = await getFila(id);
    if (!item || item.estado !== "para_aprovar") return false;
    await query("update public.molde_fila set telegram_aviso_em = now() where id = $1 and rodada = $2", [item.id, item.rodada]);
    const gasto = item.aprovacao?.custo != null ? await gastoDoMes().catch(() => null) : null;
    const sent = await sendTelegramWithButtons(filaApprovalText(item, { gasto }), approvalButtons(item), { timeoutMs: options.timeoutMs, preview: Boolean(previewLink(item)) });
    if (!sent.ok) return false;
    if (sent.messageId) await query("update public.molde_fila set telegram_msg_id = $3 where id = $1 and rodada = $2", [item.id, item.rodada, sent.messageId]);
    return true;
  } catch (error) {
    console.error("[fila] não consegui mandar a aprovação no Telegram:", error instanceof Error ? error.message : error);
    return false;
  }
}

/** A decisão veio da página: a mensagem do Telegram passa a mostrar o que foi decidido (sem botões). Nunca lança. */
export async function reflectFilaDecision(item: FilaRow, options: { timeoutMs?: number } = {}) {
  try {
    await atualizarProgresso([{ id: item.id }], options); // 0020 · a mensagem de progresso do vídeo também
    if (!item.telegram_msg_id || !item.decisao || !telegramBotConfig()) return false;
    return (await editTelegramMessage(Number(item.telegram_msg_id), `${filaApprovalText(item, { decided: true })}\n\n${filaDecisionLine(item.decisao)}`, options)).ok;
  } catch (error) {
    console.error("[fila] não consegui mostrar a decisão no Telegram:", error instanceof Error ? error.message : error);
    return false;
  }
}

/** O orquestrador desistiu de um item (erro final): o dono vê no Telegram, sem botões. Nunca lança. */
export async function sendFilaErro(item: FilaRow, options: { timeoutMs?: number } = {}) {
  try {
    if (!telegramBotConfig()) return false;
    const avatar = item.avatar ? ` de ${item.avatar}` : "";
    const texto = `Molde: «${shorten(item.titulo || item.tipo, 80)}»${avatar} parou com erro: ${shorten(item.erro ?? "sem detalhe", 500)}\nVeja na página do Molde (painel «Fila») e peça de novo se quiser.`;
    return (await sendTelegramWithButtons(texto, null, options)).ok;
  } catch (error) {
    console.error("[fila] não consegui avisar o erro no Telegram:", error instanceof Error ? error.message : error);
    return false;
  }
}

// ---------- pedir ----------

export const AJUDA = [
  "Molde pelo Telegram. Comandos:",
  "/reel <tema> · um Reel novo no calendário do avatar (o roteiro usa o seu plano do Claude).",
  "/fotos <descrição> · 1 foto do avatar (ou /fotos 3 <descrição>, até 4).",
  "/status · o que está na fila de cada avatar.",
  "/cancelar · desiste do que eu estiver esperando.",
  "Nada gasta com 1 toque: antes de entrar na fila eu mostro o custo e você toca em «Confirmar».",
].join("\n");

/** Lê um comando de texto. null = não é comando. */
export function lerComando(texto: string): { comando: "ajuda" | "status" | "cancelar" | "reel" | "fotos"; resto: string; n?: number } | null {
  const t = String(texto ?? "").trim();
  if (!t.startsWith("/")) return null;
  const m = /^\/([a-zçãé]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(t);
  if (!m) return null;
  let cmd = m[1].toLowerCase();
  let resto = (m[2] ?? "").trim();
  if (cmd === "novo" || cmd === "nova") {
    const sub = /^(reel|reels|fotos?|foto)\b\s*([\s\S]*)$/i.exec(resto);
    if (!sub) return { comando: "ajuda", resto: "" };
    cmd = sub[1].toLowerCase();
    resto = sub[2].trim();
  }
  if (cmd === "start" || cmd === "ajuda" || cmd === "help") return { comando: "ajuda", resto: "" };
  if (cmd === "status" || cmd === "fila") return { comando: "status", resto: "" };
  if (cmd === "cancelar") return { comando: "cancelar", resto: "" };
  if (cmd === "reel" || cmd === "reels") return { comando: "reel", resto };
  if (cmd === "foto" || cmd === "fotos") {
    const n = /^(\d{1,2})\s+([\s\S]+)$/.exec(resto);
    if (n) return { comando: "fotos", resto: n[2].trim(), n: Number(n[1]) };
    return { comando: "fotos", resto, n: 1 };
  }
  return { comando: "ajuda", resto: "" };
}

/** O pedido com o custo (o mesmo texto no Telegram e no Claude/MCP; muda só o último passo). */
export function textoDoPedido(item: FilaRow, avatar: AvatarRow | null, canal: "telegram" | "mcp" = "telegram") {
  const p = item.pedido ?? {};
  const custo = custoDoPedido(p, avatar);
  const quem = item.avatar ? ` para ${item.avatar}${avatar?.conta ? ` (@${avatar.conta})` : ""}` : "";
  const linhas = p.comando === "fotos"
    ? [`Pedido: ${p.n ?? 1} foto${(p.n ?? 1) > 1 ? "s" : ""}${quem}: «${shorten(p.texto ?? "", 300)}».`,
      `Custo estimado: ≈ ${usd(custo.usd)}${custo.padrao ? " (estimativa padrão: abra a página uma vez para eu saber o preço do seu gerador)" : ""}. As fotos saem no gerador do seu Mac quando a página do Molde estiver aberta.`]
    : [`Pedido: um Reel novo${quem} sobre «${shorten(p.texto ?? "", 300)}».`,
      `Custo: ${usd(0)} agora. Ele entra no 1º dia livre do calendário; o roteiro usa o seu plano do Claude.`,
      Number(avatar?.precos?.reel) > 0 ? `Produzir o vídeo depois custa ≈ ${usd(Number(avatar?.precos?.reel))}, com outra confirmação.` : "Produzir o vídeo depois é outro pedido, com outra confirmação."];
  linhas.push(canal === "mcp"
    ? `Nada gasta até a ferramenta «confirmar» ser chamada com o id ${item.id} (o pedido vale por ${RASCUNHO_MINUTOS} minutos).`
    : "Nada gasta até você tocar em «Confirmar».");
  return linhas.join("\n");
}

function confirmButtons(item: FilaRow): InlineButton[][] | null {
  const c = signCallback({ kind: "f", action: "c", id: item.id, version: 0 });
  const x = signCallback({ kind: "f", action: "x", id: item.id, version: 0 });
  if (!c || !x) return null;
  return [[{ text: `Confirmar · ${usd(Number(item.custo_estimado_usd))}`, callback_data: c }, { text: "Cancelar", callback_data: x }]];
}

function avatarButtons(item: FilaRow, avatares: AvatarRow[]): InlineButton[][] | null {
  const opcoes = item.pedido?.opcoes ?? [];
  const linhas: InlineButton[][] = [];
  opcoes.forEach((projeto, indice) => {
    const a = avatares.find((x) => x.projeto === projeto);
    const data = signCallback({ kind: "f", action: "v", id: item.id, version: indice });
    if (a && data) linhas.push([{ text: a.conta ? `${a.nome || a.projeto} (@${a.conta})` : a.nome || a.projeto, callback_data: data }]);
  });
  const x = signCallback({ kind: "f", action: "x", id: item.id, version: 0 });
  if (!x || !linhas.length) return null;
  linhas.push([{ text: "Cancelar", callback_data: x }]);
  return linhas;
}

/** «Gasto em outubro: US$ 3,20 de US$ 50,00 (sobra US$ 46,80).» (a mesma conta do «status_do_mes» do MCP) */
export async function linhaDoGasto() {
  const g = await gastoDoMes();
  return `Gasto em ${g.mes}: ${usd(g.gastoUsd)} de ${usd(g.limiteUsd)} (${g.passou ? "passou do limite" : `sobra ${usd(g.sobraUsd)}`}).`;
}

async function statusTexto() {
  const porProjeto = await contarFila();
  const projetos = Object.entries(porProjeto);
  if (!projetos.length) return "A fila do Molde está vazia (últimos 30 dias).";
  const ordem: FilaState[] = FILA_STATES.filter((e) => e !== "rascunho");
  const linhas = projetos.map(([projeto, p]) => {
    const partes = ordem.filter((e) => p.estados[e]).map((e) => `${p.estados[e]} ${ESTADO_NOME[e]}`);
    return `${p.avatar || projeto}: ${partes.join(", ")}`;
  });
  const esperando = await query<{ n: string }>("select count(*) as n from public.molde_fila where origem = 'telegram' and estado = 'na_fila' and pedido_id is null");
  const n = Number(esperando.rows[0]?.n ?? 0);
  if (n) linhas.push(`\n${n} pedido${n > 1 ? "s" : ""} do Telegram esperando a página do Molde abrir.`);
  linhas.push(`\n${await linhaDoGasto()}`);
  return `Fila do Molde (últimos 30 dias):\n${linhas.join("\n")}`;
}

export type TelegramMessage = { message_id?: number; chat?: { id?: number | string }; from?: { id?: number; username?: string; first_name?: string }; text?: string };

/** Uma mensagem de texto da conversa do dono (já conferida). Nunca lança. */
export async function handleMessage(message: TelegramMessage) {
  const responder = (text: string, buttons: InlineButton[][] | null = null) => sendTelegramWithButtons(text, buttons);
  const texto = String(message.text ?? "").trim();
  const por = message.from?.username ? `@${message.from.username}` : message.from?.first_name ?? null;
  try {
    const cmd = lerComando(texto);
    if (!cmd) {
      if (!texto) return { acao: "vazio" as const };
      const item = await itemEsperandoMotivo();
      if (!item) {
        await responder(`Não entendi. ${AJUDA}`);
        return { acao: "ajuda" as const };
      }
      const outcome = await decidirFila(item.id, { decisao: "refazer", nota: texto.slice(0, 1000), via: "telegram", por, rodada: item.rodada });
      if (!outcome.ok) {
        await largarMotivo();
        await responder(outcome.motivo === "not-found" ? "Este pedido não existe mais." : "Este pedido não espera mais aprovação: nada mudou.");
        return { acao: "fechado" as const };
      }
      if (item.telegram_msg_id) await editTelegramMessage(Number(item.telegram_msg_id), `${filaApprovalText(outcome.item, { decided: true })}\n\n${filaDecisionLine(outcome.item.decisao!)}`);
      await atualizarProgresso([{ id: outcome.item.id }]);
      await responder(`Anotado: refazer «${shorten(outcome.item.titulo, 80)}» com «${shorten(texto, 200)}». A página mostra o pedido de ajuste e o botão de refazer (que pergunta o custo antes).`);
      return { acao: "refazer" as const };
    }
    if (cmd.comando === "ajuda") {
      await responder(AJUDA);
      return { acao: "ajuda" as const };
    }
    if (cmd.comando === "status") {
      await responder(await statusTexto());
      return { acao: "status" as const };
    }
    if (cmd.comando === "cancelar") {
      await largarMotivo();
      await responder("Pronto: não estou esperando nada. Os botões das mensagens de antes continuam valendo.");
      return { acao: "cancelar" as const };
    }
    if (!cmd.resto) {
      await responder(cmd.comando === "reel" ? "Diga o tema: /reel <tema>. Ex.: /reel 3 erros de quem guarda dinheiro na poupança" : "Diga o que quer na foto: /fotos <descrição>. Ex.: /fotos 2 tomando café na varanda de manhã");
      return { acao: "faltou" as const };
    }
    const n = cmd.comando === "fotos" ? Math.min(FOTOS_MAX, Math.max(1, cmd.n ?? 1)) : undefined;
    const avatares = await listarAvatares();
    if (!avatares.length) {
      await responder("Ainda não conheço os seus avatares: abra a página do Molde uma vez (com o Mac ligado) para ela mandar a lista.");
      return { acao: "sem_avatar" as const };
    }
    const pedido: FilaPedido = { comando: cmd.comando, texto: cmd.resto.slice(0, 500), ...(n ? { n } : {}) };
    const item = await criarRascunho(pedido, avatares);
    if (avatares.length === 1) {
      await responder(textoDoPedido(item, avatares[0]), confirmButtons(item));
    } else {
      await responder(`Para qual avatar? (${cmd.comando === "fotos" ? `${n} foto${(n ?? 1) > 1 ? "s" : ""}` : "Reel"}: «${shorten(pedido.texto ?? "", 200)}»)\nO pedido vale por ${RASCUNHO_MINUTOS} minutos.`, avatarButtons(item, avatares));
    }
    return { acao: "rascunho" as const, id: item.id };
  } catch (error) {
    if (isMissing0016(error)) {
      await responder("Falta colar a atualização 0016 no Supabase para pedir e aprovar pela fila do Molde.");
      return { acao: "sem_migracao" as const };
    }
    console.error("[fila] não consegui atender a mensagem:", error instanceof Error ? error.message : error);
    await responder("Não consegui fazer isso agora. Tente de novo em instantes.");
    return { acao: "erro" as const };
  }
}

type CallbackLike = { id: string; from?: { username?: string; first_name?: string }; message?: { message_id?: number; text?: string } };

/** Um toque num botão da fila (kind f; já conferido: a conversa, quem tocou e a assinatura). Nunca lança. */
export async function handleFilaCallback(payload: CallbackPayload, callback: CallbackLike) {
  const messageId = callback.message?.message_id;
  const edit = async (text: string, buttons: InlineButton[][] | null = null) => {
    if (typeof messageId === "number") await editTelegramMessage(messageId, text, { buttons });
  };
  const reply = (text: string) => answerCallback(callback.id, text);
  const por = callback.from?.username ? `@${callback.from.username}` : callback.from?.first_name ?? null;
  try {
    if (payload.action === "a" || payload.action === "r" || DECISAO_DA_LETRA[payload.action]) {
      const item = await getFila(payload.id);
      if (!item) {
        await reply("Este pedido não existe mais.");
        return { acao: "sumiu" as const };
      }
      if (payload.version !== item.rodada) {
        await reply("Esta prévia é antiga: veja a mensagem mais nova.");
        await edit(`${callback.message?.text ?? "Molde"}\n\nPrévia antiga: o Molde mandou uma versão nova.`);
        return { acao: "antigo" as const };
      }
      if (item.estado !== "para_aprovar") {
        const frase = item.decisao && Number(item.decisao.rodada) === item.rodada ? `Já estava decidido: ${filaDecisionLine(item.decisao)}` : `Este pedido não espera mais aprovação (está ${ESTADO_NOME[item.estado]}).`;
        await reply(frase);
        await edit(`${filaApprovalText(item, { decided: true })}\n\n${frase}`);
        return { acao: "repetido" as const };
      }
      if (payload.action === "r") {
        await esperarMotivo(item.id);
        await reply("O que você quer mudar? Escreva numa mensagem.");
        await sendTelegramWithButtons(`O que você quer mudar em «${shorten(item.titulo, 80)}»${item.avatar ? ` (${item.avatar})` : ""}? Responda com uma mensagem (até 15 min). /cancelar desiste.`, null);
        return { acao: "motivo" as const };
      }
      const decisao = DECISAO_DA_LETRA[payload.action];
      const outcome = await decidirFila(item.id, { decisao, via: "telegram", por, rodada: payload.version });
      if (!outcome.ok) {
        await reply(outcome.motivo === "opcao" ? "Esta opção não vale para este pedido." : "Este pedido não espera mais aprovação.");
        return { acao: "fechado" as const };
      }
      await reply(DECIDIDO[decisao]);
      await edit(`${filaApprovalText(outcome.item, { decided: true })}\n\n${filaDecisionLine(outcome.item.decisao!)}`);
      await atualizarProgresso([{ id: outcome.item.id }]);
      return { acao: decisao === "aprovar" ? ("aprovar" as const) : decisao };
    }

    // pedir: escolher o avatar, confirmar (o 2º toque) ou cancelar
    const outcome = payload.action === "v" ? await escolherAvatar(payload.id, payload.version)
      : payload.action === "c" ? await confirmarRascunho(payload.id, por)
        : await cancelarRascunho(payload.id);
    if (!outcome.ok) {
      const frases: Record<string, string> = {
        "not-found": "Este pedido não existe mais.",
        expirado: "Este pedido passou do prazo. Mande o comando de novo.",
        ja: outcome.item?.estado === "cancelado" ? "Este pedido já foi cancelado." : "Este pedido já foi confirmado: está na fila.",
        "sem-avatar": "Não achei esse avatar. Mande o comando de novo.",
      };
      await reply(frases[outcome.motivo]);
      if (outcome.motivo !== "ja") await edit(`${callback.message?.text ?? "Molde"}\n\n${frases[outcome.motivo]}`);
      return { acao: outcome.motivo === "ja" ? ("repetido" as const) : ("fechado" as const) };
    }
    const item = outcome.item;
    if (payload.action === "v") {
      const avatar = (await listarAvatares()).find((a) => a.projeto === item.projeto) ?? null;
      await reply(item.avatar || "Avatar escolhido.");
      await edit(textoDoPedido(item, avatar), confirmButtons(item));
      return { acao: "avatar" as const };
    }
    if (payload.action === "x") {
      await reply("Cancelado.");
      await edit(`${callback.message?.text ?? "Molde"}\n\nCancelado (${formatSaoPauloTime(new Date())}). Nada foi pedido.`);
      return { acao: "cancelado" as const };
    }
    await reply("Confirmado: está na fila.");
    await edit(`${callback.message?.text ?? "Molde"}\n\nConfirmado às ${formatSaoPauloTime(new Date())}: ${usd(Number(item.custo_estimado_usd))}. A página do Molde faz quando abrir no avatar ${item.avatar || item.projeto} (se passar do seu limite do mês, ela pergunta de novo).`);
    return { acao: "confirmado" as const, id: item.id };
  } catch (error) {
    if (isMissing0016(error)) {
      await reply("Falta colar a atualização 0016 no Supabase.");
      return { acao: "sem_migracao" as const };
    }
    console.error("[fila] não consegui atender o toque:", error instanceof Error ? error.message : error);
    await reply("Não consegui fazer isso agora. Tente de novo em instantes.");
    return { acao: "erro" as const };
  }
}
