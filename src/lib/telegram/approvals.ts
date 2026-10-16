import { query } from "@/lib/db/client";
import { clearDraft, isMissingTables, queueReply, readDraft, saveDraftTelegramMessage, type DraftRow } from "@/lib/db/dm-pending";
import { decideJob, getJob, isMissing0008, type JobApproval, type JobRow } from "@/lib/molde/jobs";
import { formatSaoPauloTime } from "@/lib/time";
import { answerCallback, editTelegramMessage, sendTelegramWithButtons, telegramBotConfig, type InlineButton } from "@/lib/telegram/api";
import { callbacksEnabled, signCallback, verifyCallback } from "@/lib/telegram/callback-data";

/**
 * Aprovar pelo Telegram: as mensagens com botões e o que acontece quando a dona toca neles.
 * (a) Trabalho do Molde esperando aprovação: «Aprovar» / «Refazer».
 * (b) Resposta de DM preparada pelo Molde: «Mandar» / «Não mandar».
 * Os botões só aparecem com TELEGRAM_WEBHOOK_SECRET definido (sem ele, a mensagem diz para aprovar pela página).
 */

const TIPOS: Record<string, { nome: string; pronto: string }> = {
  reel_pipeline: { nome: "o vídeo", pronto: "ficou pronto" },
  montar: { nome: "a montagem", pronto: "ficou pronta" },
  narrar: { nome: "a narração", pronto: "ficou pronta" },
  narrar_tratar: { nome: "o áudio da narração", pronto: "ficou pronto" },
  versoes: { nome: "as versões", pronto: "ficaram prontas" },
};

function tipoLabel(tipo: string) {
  return TIPOS[tipo] ?? { nome: "o trabalho", pronto: "ficou pronto" };
}

function shorten(text: string, max: number) {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function previewLink(job: Pick<JobRow, "previa">) {
  const previa = job.previa ?? {};
  return previa.video || previa.imagem || previa.audio || previa.link || null;
}

/** Texto da mensagem de aprovação (sem a linha final de instrução quando `decided`). */
export function jobApprovalText(job: JobRow, options: { decided?: boolean } = {}) {
  const { nome, pronto } = tipoLabel(job.tipo);
  const titulo = shorten(job.titulo || job.ref, 80);
  const conta = job.account_username ? ` (@${job.account_username})` : "";
  const versao = job.rodada > 1 ? ` Versão ${job.rodada}.` : "";
  const link = previewLink(job);
  const lines = [
    `UaiFlow: ${nome} «${titulo}»${conta} ${pronto}.${versao}`,
    job.previa?.texto ? `\n${shorten(job.previa.texto, 700)}` : null,
    link ? `\nPrévia: ${link}` : null,
    job.previa?.audio && job.previa.audio !== link ? `Áudio: ${job.previa.audio}` : null,
  ];
  if (!options.decided) {
    lines.push(callbacksEnabled()
      ? "\nToque em «Aprovar» para seguir ou em «Refazer» para o Molde fazer de novo."
      : `\nAprove pela página do Molde.`);
  }
  return lines.filter(Boolean).join("\n");
}

/** Ex.: "Aprovado às 21:04 (pelo Telegram)." / "Pedido para refazer às 21:04 (pela página)." */
export function decisionLine(aprovacao: Pick<JobApproval, "decisao" | "via" | "em">) {
  const hora = formatSaoPauloTime(new Date(aprovacao.em));
  const onde = aprovacao.via === "telegram" ? "pelo Telegram" : "pela página";
  return aprovacao.decisao === "aprovar" ? `Aprovado às ${hora} (${onde}).` : `Pedido para refazer às ${hora} (${onde}).`;
}

function jobButtons(job: JobRow): InlineButton[][] | null {
  if (!callbacksEnabled()) return null;
  const aprovar = signCallback({ kind: "j", action: "a", id: job.id, version: job.rodada });
  const refazer = signCallback({ kind: "j", action: "r", id: job.id, version: job.rodada });
  if (!aprovar || !refazer) return null;
  return [[{ text: "Aprovar", callback_data: aprovar }, { text: "Refazer", callback_data: refazer }]];
}

/**
 * Manda a mensagem de aprovação do trabalho (se ele ainda espera aprovação). Grava a tentativa (telegram_aviso_em) e,
 * se deu certo, o número da mensagem (para editar depois). Nunca lança erro. Devolve true se mandou.
 */
export async function sendJobApproval(jobId: string, options: { timeoutMs?: number } = {}) {
  try {
    if (!telegramBotConfig()) return false;
    const job = await getJob(jobId);
    if (!job || job.estado !== "esperando_aprovacao") return false;
    await query("update public.molde_jobs set telegram_aviso_em = now() where id = $1 and rodada = $2", [job.id, job.rodada]);
    const sent = await sendTelegramWithButtons(jobApprovalText(job), jobButtons(job), { timeoutMs: options.timeoutMs, preview: Boolean(previewLink(job)) });
    if (!sent.ok) return false;
    if (sent.messageId) {
      await query("update public.molde_jobs set telegram_msg_id = $3 where id = $1 and rodada = $2", [job.id, job.rodada, sent.messageId]);
    }
    return true;
  } catch (error) {
    console.error("[aprovacao] não consegui mandar a aprovação no Telegram:", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Depois da decisão pela página: a mensagem do Telegram passa a mostrar o que foi decidido (sem botões). Nunca lança. */
export async function reflectJobDecision(job: JobRow, options: { timeoutMs?: number } = {}) {
  try {
    if (!job.telegram_msg_id || !job.aprovacao || !telegramBotConfig()) return false;
    const result = await editTelegramMessage(Number(job.telegram_msg_id), `${jobApprovalText(job, { decided: true })}\n\n${decisionLine(job.aprovacao)}`, options);
    return result.ok;
  } catch {
    return false;
  }
}

// ---------- DMs ----------

/** Texto da pergunta «Mandar» / «Não mandar» de uma resposta de DM. */
export function dmDraftText(draft: DraftRow, options: { decided?: boolean } = {}) {
  const pessoa = draft.username ? `@${draft.username}` : "uma pessoa";
  const perfil = draft.account_username ? ` (Direct de @${draft.account_username})` : "";
  const ultima = draft.messages?.at(-1)?.texto;
  const lines = [
    `UaiFlow: resposta pronta para ${pessoa}${perfil}.`,
    ultima ? `\nA pessoa escreveu: «${shorten(ultima, 400)}»` : null,
    `\nResposta: «${shorten(draft.draft_text ?? draft.reply_text ?? "", 900)}»`,
  ];
  if (!options.decided) {
    lines.push(callbacksEnabled() ? "\nToque em «Mandar» para enviar ou em «Não mandar»." : "\nMande pela página do Molde.");
  }
  return lines.filter(Boolean).join("\n");
}

/** Manda a pergunta do rascunho `seq` (se ainda for o rascunho atual). Nunca lança. */
export async function sendDmDraftApproval(id: string, seq: number, options: { timeoutMs?: number } = {}) {
  try {
    if (!telegramBotConfig()) return false;
    const draft = await readDraft(id);
    if (!draft || draft.status !== "aguardando" || draft.draft_seq !== seq || !draft.draft_text) return false;
    await query("update public.dm_pending set telegram_aviso_em = now() where id = $1 and draft_seq = $2", [id, seq]);
    const mandar = signCallback({ kind: "d", action: "m", id, version: seq });
    const naoMandar = signCallback({ kind: "d", action: "n", id, version: seq });
    const buttons = callbacksEnabled() && mandar && naoMandar ? [[{ text: "Mandar", callback_data: mandar }, { text: "Não mandar", callback_data: naoMandar }]] : null;
    const sent = await sendTelegramWithButtons(dmDraftText(draft), buttons, options);
    if (!sent.ok) return false;
    if (sent.messageId) await saveDraftTelegramMessage(id, seq, sent.messageId);
    return true;
  } catch (error) {
    console.error("[aprovacao] não consegui mandar a resposta de DM no Telegram:", error instanceof Error ? error.message : error);
    return false;
  }
}

/** A resposta saiu pela página: a pergunta no Telegram (se houver) passa a dizer isso. Nunca lança. */
export async function reflectDmSentFromPage(id: string) {
  try {
    if (!telegramBotConfig()) return false;
    const draft = await readDraft(id);
    if (!draft?.telegram_msg_id) return false;
    const line = `Mandada às ${formatSaoPauloTime(new Date())} (pela página).`;
    return (await editTelegramMessage(Number(draft.telegram_msg_id), `${dmDraftText(draft, { decided: true })}\n\n${line}`)).ok;
  } catch {
    return false;
  }
}

// ---------- Toque num botão ----------

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from?: { id?: number; username?: string; first_name?: string };
  message?: { message_id?: number; chat?: { id?: number | string }; text?: string };
};

/** O que fazer com um toque num botão (já conferido que veio do Telegram e da conversa certa). Nunca lança. */
export async function handleCallback(callback: TelegramCallbackQuery) {
  const messageId = callback.message?.message_id;
  const edit = async (text: string) => {
    if (typeof messageId === "number") await editTelegramMessage(messageId, text);
  };
  const reply = (text: string) => answerCallback(callback.id, text);
  const payload = verifyCallback(callback.data);
  if (!payload) {
    await reply("Este botão não vale mais.");
    return { acao: "invalido" as const };
  }
  const por = callback.from?.username ? `@${callback.from.username}` : callback.from?.first_name ?? null;

  try {
    if (payload.kind === "j") {
      const decisao = payload.action === "a" ? "aprovar" : "refazer";
      const outcome = await decideJob(payload.id, { decisao, via: "telegram", por, rodada: payload.version });
      if (!outcome.ok && outcome.motivo === "not-found") {
        await reply("Este trabalho não existe mais.");
        await edit(`${callback.message?.text ?? "UaiFlow"}\n\nEste trabalho não existe mais.`);
        return { acao: "sumiu" as const };
      }
      if (outcome.ok || outcome.motivo === "already") {
        const job = outcome.job;
        const aprovacao = job.aprovacao as JobApproval;
        const line = decisionLine(aprovacao);
        await reply(outcome.ok ? (decisao === "aprovar" ? "Aprovado." : "Pedido para refazer.") : `Já estava decidido: ${line}`);
        await edit(`${jobApprovalText(job, { decided: true })}\n\n${line}`);
        return { acao: outcome.ok ? decisao : ("repetido" as const) };
      }
      if (outcome.motivo === "old-round") {
        await reply("Esta prévia é antiga: veja a mensagem mais nova.");
        await edit(`${callback.message?.text ?? "UaiFlow"}\n\nPrévia antiga: o Molde mandou uma versão nova.`);
        return { acao: "antigo" as const };
      }
      const estado = outcome.job.estado === "cancelado" ? "Este trabalho foi cancelado." : "Este trabalho não espera mais aprovação.";
      await reply(estado);
      await edit(`${jobApprovalText(outcome.job, { decided: true })}\n\n${estado}`);
      return { acao: "fechado" as const };
    }

    // DM
    const draft = await readDraft(payload.id);
    if (!draft) {
      await reply("Esta conversa não existe mais.");
      return { acao: "sumiu" as const };
    }
    if (draft.draft_seq !== payload.version) {
      await reply("Este rascunho é antigo: veja a mensagem mais nova.");
      await edit(`${callback.message?.text ?? "UaiFlow"}\n\nRascunho antigo: o Molde preparou outro.`);
      return { acao: "antigo" as const };
    }
    const hora = formatSaoPauloTime(new Date());
    if (payload.action === "n") {
      const cleared = await clearDraft(payload.id, payload.version);
      await reply(cleared ? "Não mandada." : "Nada a fazer: esta resposta já foi resolvida.");
      if (cleared) await edit(`${dmDraftText(draft, { decided: true })}\n\nNão mandada (${hora}). A conversa continua esperando no Molde.`);
      return { acao: cleared ? ("nao_mandar" as const) : ("repetido" as const) };
    }
    if (draft.status !== "aguardando" || !draft.draft_text) {
      const jaFoi = draft.reply_text && draft.status !== "aguardando" && ["na_fila", "enviada"].includes(draft.status);
      const frase = jaFoi ? "Esta resposta já foi mandada." : "Esta conversa não espera mais resposta.";
      await reply(frase);
      await edit(`${dmDraftText(draft, { decided: true })}\n\n${frase}`);
      return { acao: "repetido" as const };
    }
    const outcome = await queueReply(payload.id, draft.draft_text);
    const frases: Record<string, string> = {
      ok: `Mandada às ${hora} (pelo Telegram). Ela sai na fila de envio em instantes.`,
      closed: "Esta resposta já foi mandada.",
      expired: "Passou o prazo de 24 h do Instagram para responder esta pessoa.",
      "opted-out": "Esta pessoa pediu para não receber mensagens.",
      "not-found": "Esta conversa não existe mais.",
    };
    await reply(outcome === "ok" ? "Resposta na fila de envio." : frases[outcome]);
    await edit(`${dmDraftText(draft, { decided: true })}\n\n${frases[outcome]}`);
    return { acao: outcome === "ok" ? ("mandar" as const) : ("fechado" as const) };
  } catch (error) {
    if (isMissing0008(error) || isMissingTables(error)) {
      await reply("Falta colar a atualização 0008 no Supabase.");
      return { acao: "sem_migracao" as const };
    }
    console.error("[telegram] não consegui atender o toque no botão:", error instanceof Error ? error.message : error);
    await reply("Não consegui fazer isso agora. Tente de novo em instantes.");
    return { acao: "erro" as const };
  }
}
