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
  getFila,
  isMissing0016,
  itemEsperandoMotivo,
  largarMotivo,
  listarAvatares,
  RASCUNHO_MINUTOS,
  type AvatarRow,
  type FilaDecision,
  type FilaPedido,
  type FilaRow,
  type FilaState,
} from "@/lib/molde/fila";
import { formatSaoPauloTime } from "@/lib/time";
import { answerCallback, editTelegramMessage, sendTelegramWithButtons, telegramBotConfig, type InlineButton } from "@/lib/telegram/api";
import { callbacksEnabled, signCallback, type CallbackPayload } from "@/lib/telegram/callback-data";

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

/** Texto da mensagem de aprovação de um item da fila. */
export function filaApprovalText(item: FilaRow, options: { decided?: boolean } = {}) {
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

export function filaDecisionLine(d: Pick<FilaDecision, "decisao" | "via" | "em" | "nota">) {
  const hora = formatSaoPauloTime(new Date(d.em));
  const onde = d.via === "telegram" ? "pelo Telegram" : "pela página";
  if (d.decisao === "aprovar") return `Aprovado às ${hora} (${onde}).`;
  return `Pedido para refazer às ${hora} (${onde})${d.nota ? `: «${shorten(d.nota, 300)}»` : ""}.`;
}

function approvalButtons(item: FilaRow): InlineButton[][] | null {
  if (!callbacksEnabled()) return null;
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
    const sent = await sendTelegramWithButtons(filaApprovalText(item), approvalButtons(item), { timeoutMs: options.timeoutMs, preview: Boolean(previewLink(item)) });
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
    if (!item.telegram_msg_id || !item.decisao || !telegramBotConfig()) return false;
    return (await editTelegramMessage(Number(item.telegram_msg_id), `${filaApprovalText(item, { decided: true })}\n\n${filaDecisionLine(item.decisao)}`, options)).ok;
  } catch (error) {
    console.error("[fila] não consegui mostrar a decisão no Telegram:", error instanceof Error ? error.message : error);
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

function textoDoPedido(item: FilaRow, avatar: AvatarRow | null) {
  const p = item.pedido ?? {};
  const custo = custoDoPedido(p, avatar);
  const quem = item.avatar ? ` para ${item.avatar}${avatar?.conta ? ` (@${avatar.conta})` : ""}` : "";
  const linhas = p.comando === "fotos"
    ? [`Pedido: ${p.n ?? 1} foto${(p.n ?? 1) > 1 ? "s" : ""}${quem}: «${shorten(p.texto ?? "", 300)}».`,
      `Custo estimado: ≈ ${usd(custo.usd)}${custo.padrao ? " (estimativa padrão: abra a página uma vez para eu saber o preço do seu gerador)" : ""}. As fotos saem no gerador do seu Mac quando a página do Molde estiver aberta.`]
    : [`Pedido: um Reel novo${quem} sobre «${shorten(p.texto ?? "", 300)}».`,
      `Custo: ${usd(0)} agora. Ele entra no 1º dia livre do calendário; o roteiro usa o seu plano do Claude.`,
      Number(avatar?.precos?.reel) > 0 ? `Produzir o vídeo depois custa ≈ ${usd(Number(avatar?.precos?.reel))}, com outra confirmação.` : "Produzir o vídeo depois é outro pedido, com outra confirmação."];
  linhas.push("Nada gasta até você tocar em «Confirmar».");
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
    if (payload.action === "a" || payload.action === "r") {
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
      const outcome = await decidirFila(item.id, { decisao: "aprovar", via: "telegram", por, rodada: payload.version });
      if (!outcome.ok) {
        await reply("Este pedido não espera mais aprovação.");
        return { acao: "fechado" as const };
      }
      await reply("Aprovado.");
      await edit(`${filaApprovalText(outcome.item, { decided: true })}\n\n${filaDecisionLine(outcome.item.decisao!)}`);
      return { acao: "aprovar" as const };
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
