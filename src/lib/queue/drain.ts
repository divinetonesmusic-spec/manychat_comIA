import {
  claimQueueJobs,
  deferPendingDms,
  deferQueueJobs,
  getConfig,
  getTemplateContext,
  markExpiredDmsSkipped,
  markJobFailed,
  markJobSent,
  nextDmSlot,
  recoverStaleQueueJobs,
  releaseQueueJobs,
  sentDmCountLastHour,
  type QueueJob,
} from "@/lib/db/repositories";
import {
  sendDirectMediaMessage,
  sendDirectMessage,
  sendPrivateReply,
  sendPublicCommentReply,
} from "@/lib/instagram/client";
import { renderMessageTemplate } from "@/lib/message-template";

const MAX_JOBS_PER_DRAIN = 40;
const MAX_AUTOMATED_DMS_PER_HOUR = 200;
const SEND_DELAY_MS = 300;
const BATCH_SIZE = 5;

/**
 * Envia a fila em lotes pequenos e respeita um limite de tempo (serverless: Netlify/Render cortam em ~10 s).
 * O que não couber fica "pending" e sai no próximo minuto. Jobs presos em "sending" voltam para a fila.
 * Perfil que bateu no limite de 200 mensagens por hora: as mensagens diretas dele esperam o próximo horário
 * livre (sem gastar tentativa e sem virar "failed"); outros perfis e respostas públicas seguem normais.
 * Quem foi adiado não conta nas 40 mensagens do ciclo: assim, um perfil parado no limite não impede os outros de sair.
 */
export async function drainQueue(limit = MAX_JOBS_PER_DRAIN, budgetMs = Number(process.env.DRAIN_BUDGET_MS || 6000)) {
  const deadline = Date.now() + budgetMs;
  await recoverStaleQueueJobs();
  await markExpiredDmsSkipped();

  const total = Math.min(limit, MAX_JOBS_PER_DRAIN);
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let stoppedEarly = false;
  // Perfis que já bateram no limite neste ciclo: as próximas mensagens deles esperam sem consultar o banco de novo.
  const atLimit = new Map<string, { availableAt: Date; note: string; ids: string[] }>();

  while (processed < total) {
    if (deadline - Date.now() < 1500) { stoppedEarly = true; break; }
    const jobs = await claimQueueJobs(Math.min(BATCH_SIZE, total - processed));
    if (!jobs.length) break;

    try {
      for (const [index, job] of jobs.entries()) {
        if (deadline - Date.now() < 800) {
          // Sem tempo: devolve o resto do lote sem gastar tentativa.
          await releaseQueueJobs(jobs.slice(index).map((item) => item.id));
          stoppedEarly = true;
          break;
        }
        const config = await getConfig(job.account_id);
        if (!config.instagram_access_token || !config.instagram_user_id) {
          processed += 1;
          await markJobFailed(job.id, "Instagram não conectado para este perfil");
          failed += 1;
          continue;
        }

        const countsTowardDmLimit = job.send_type === "dm" || job.send_type === "private_reply";
        if (countsTowardDmLimit) {
          const limitKey = config.account_id ?? "";
          let wait = atLimit.get(limitKey);
          if (!wait && (await sentDmCountLastHour(config.account_id)) >= MAX_AUTOMATED_DMS_PER_HOUR) {
            const availableAt = await nextDmSlot(config.account_id);
            wait = {
              availableAt,
              note: `Limite de ${MAX_AUTOMATED_DMS_PER_HOUR} mensagens por hora deste perfil: sai às ${formatSaoPauloTime(availableAt)}.`,
              ids: [],
            };
            atLimit.set(limitKey, wait);
            // Todas as DMs e respostas privadas que esse perfil ainda tem na fila, de uma vez (um UPDATE só).
            deferred += await deferPendingDms(config.account_id, availableAt, wait.note);
          }
          if (wait) {
            wait.ids.push(job.id);
            deferred += 1;
            continue;
          }
        }

        processed += 1;
        try {
          await sendJob(job, config.instagram_user_id, config.instagram_access_token);
          await markJobSent(job.id);
          sent += 1;
        } catch (error) {
          failed += 1;
          await markJobFailed(job.id, error instanceof Error ? error.message : "Erro desconhecido ao enviar");
        }

        await delay(SEND_DELAY_MS);
      }
    } finally {
      // Adiadas do lote, de uma vez só (também se algo falhar no meio: elas não podem ficar presas em "sending").
      for (const wait of atLimit.values()) {
        const ids = wait.ids.splice(0);
        await deferQueueJobs(ids, wait.availableAt, wait.note);
      }
    }
    if (stoppedEarly) break;
  }

  return { processed, sent, failed, deferred, stoppedEarly };
}

/** Hora e minuto no horário de São Paulo (ex.: "14:05"), para as notas que a pessoa lê. */
function formatSaoPauloTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

async function sendJob(job: QueueJob, instagramUserId: string, accessToken: string) {
  const context = await getTemplateContext({ contactId: job.contact_id, automationId: job.automation_id });
  const text = renderMessageTemplate(String(job.payload.text || ""), context);
  const buttonLabel = renderOptionalString(job.payload.buttonLabel, context);
  const url = renderOptionalString(job.payload.url, context);
  const buttonPayload = renderOptionalString(job.payload.buttonPayload, context);
  const quickReplyLabel = renderOptionalString(job.payload.quickReplyLabel, context);
  const quickReplyPayload = optionalString(job.payload.quickReplyPayload);
  const quickReplies = renderQuickReplies(job.payload.quickReplies, context);
  const mediaUrl = renderOptionalString(job.payload.mediaUrl, context);
  const mediaType = normalizeMediaType(job.payload.mediaType);
  const buttons = renderButtons(job.payload.buttons, context);

  if (job.send_type === "private_reply") {
    if (!job.instagram_comment_id) throw new Error("Missing comment id for private reply");
    await sendPrivateReply({
      instagramUserId,
      commentId: job.instagram_comment_id,
      accessToken,
      text,
      quickReplyLabel,
      quickReplyPayload,
      quickReplies,
      buttonLabel,
      url,
      buttonPayload,
      buttons,
    });
    return;
  }

  if (job.send_type === "public_reply") {
    if (!job.instagram_comment_id) throw new Error("Missing comment id for public reply");
    await sendPublicCommentReply({ commentId: job.instagram_comment_id, accessToken, text });
    return;
  }

  if (!job.instagram_recipient_id) throw new Error("Missing recipient id for DM");

  if (job.payload.type === "media") {
    if (!mediaUrl) throw new Error("Missing media URL for DM");
    if (text) {
      await sendDirectMessage({ instagramUserId, recipientId: job.instagram_recipient_id, accessToken, text });
    }
    await sendDirectMediaMessage({
      instagramUserId,
      recipientId: job.instagram_recipient_id,
      accessToken,
      mediaType,
      url: mediaUrl,
    });
    return;
  }

  await sendDirectMessage({
    instagramUserId,
    recipientId: job.instagram_recipient_id,
    accessToken,
    text,
    buttonLabel,
    url,
    buttonPayload,
    quickReplyLabel,
    quickReplyPayload,
    quickReplies,
    buttons,
  });
}

function renderOptionalString(value: unknown, context: Record<string, string>) {
  const text = optionalString(value);
  return text ? renderMessageTemplate(text, context) : null;
}

function renderButtons(value: unknown, context: Record<string, string>) {
  if (!Array.isArray(value)) return null;

  const buttons = value
    .map((item) => typeof item === "object" && item ? item as Record<string, unknown> : null)
    .filter(Boolean)
    .map((item) => ({
      type: item?.type === "postback" ? "postback" as const : "web_url" as const,
      title: renderMessageTemplate(String(item?.title || ""), context).trim(),
      url: renderOptionalString(item?.url, context),
      payload: renderOptionalString(item?.payload, context),
    }))
    .filter((item) => item.title && ((item.type === "web_url" && item.url) || (item.type === "postback" && item.payload)));

  return buttons.length ? buttons : null;
}

function renderQuickReplies(value: unknown, context: Record<string, string>) {
  if (!Array.isArray(value)) return null;

  const replies = value
    .map((item) => typeof item === "object" && item ? item as Record<string, unknown> : null)
    .filter(Boolean)
    .map((item) => ({
      title: renderMessageTemplate(String(item?.title || ""), context).trim(),
      payload: renderMessageTemplate(String(item?.payload || ""), context).trim(),
    }))
    .filter((item) => item.title && item.payload);

  return replies.length ? replies : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeMediaType(value: unknown): "image" | "audio" | "video" {
  if (value === "audio") return "audio";
  if (value === "video") return "video";
  return "image";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
