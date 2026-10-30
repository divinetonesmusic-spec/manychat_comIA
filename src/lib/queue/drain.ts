import {
  claimQueueJobs,
  deferJobForMetaLimit,
  deferPendingDms,
  deferPendingPrivateReplies,
  deferPendingJobsForAccount,
  deferQueueJobs,
  getConfig,
  getTemplateContext,
  markExpiredDmsSkipped,
  markJobFailed,
  markJobSent,
  markJobTextSent,
  nextDmSlot,
  recoverStaleQueueJobs,
  releaseQueueJobs,
  sentDmCountLastHour,
  type QueueJob,
} from "@/lib/db/repositories";
import {
  isMetaRateLimit,
  sendDirectMediaMessage,
  sendDirectMessage,
  sendPrivateReply,
  sendPublicCommentReply,
} from "@/lib/instagram/client";
import { cleanupOldPending } from "@/lib/db/dm-pending";
import { marcarEnvioDesafio } from "@/lib/db/desafios";
import { ORIGEM_DESAFIO } from "@/lib/desafio/desafio";
import { renderMessageTemplate } from "@/lib/message-template";
import { formatSaoPauloTime } from "@/lib/time";

const MAX_JOBS_PER_DRAIN = 40;
const MAX_AUTOMATED_DMS_PER_HOUR = 200;
/**
 * Reserva para quem já está conversando (tocou em «Quero ver», respondeu): as 1ªs mensagens (resposta privada ao
 * comentário) param em 200 − 60 = 140 por hora; as 60 vagas restantes ficam para as conversas. Assim, quem toca no
 * botão recebe o link na hora, mesmo com um post viral enchendo a fila de 1ªs mensagens.
 */
const RESERVA_CONVERSAS_POR_HORA = Number(process.env.RESERVA_CONVERSAS_POR_HORA || 60);
export const LIMITE_PRIMEIRAS_POR_HORA = Math.max(1, MAX_AUTOMATED_DMS_PER_HOUR - Math.max(0, Math.min(RESERVA_CONVERSAS_POR_HORA, MAX_AUTOMATED_DMS_PER_HOUR - 1)));
const SEND_DELAY_MS = 300;
const BATCH_SIZE = 5;

/**
 * Envia a fila em lotes pequenos e respeita um limite de tempo (serverless: Netlify/Render cortam em ~10 s).
 * O que não couber fica "pending" e sai no próximo minuto. Jobs presos em "sending" voltam para a fila.
 * Perfil que bateu no limite de 200 mensagens por hora: as mensagens diretas dele esperam o próximo horário
 * livre (sem gastar tentativa e sem virar "failed"); outros perfis e respostas públicas seguem normais.
 * Quem foi adiado não conta nas 40 mensagens do ciclo: assim, um perfil parado no limite não impede os outros de sair.
 * Se a Meta pedir para esperar (limite de uso), o envio volta para a fila 30 min depois (dobrando a cada vez), sem gastar
 * tentativa, e os outros envios do mesmo perfil esperam junto. Erros de verdade seguem como antes (3 tentativas, de 5 em 5 min).
 */
export async function drainQueue(limit = MAX_JOBS_PER_DRAIN, budgetMs = Number(process.env.DRAIN_BUDGET_MS || 6000)) {
  const deadline = Date.now() + budgetMs;
  await recoverStaleQueueJobs();
  await markExpiredDmsSkipped();
  await cleanupOldPending(); // DMs sem resposta fechadas há mais de 90 dias (no máximo 1 vez a cada 6 h, nunca falha)

  const total = Math.min(limit, MAX_JOBS_PER_DRAIN);
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let stoppedEarly = false;
  // Perfis que já bateram no limite neste ciclo: as próximas mensagens deles esperam sem consultar o banco de novo.
  const atLimit = new Map<string, { availableAt: Date; note: string; ids: string[] }>();
  // 1ªs mensagens paradas na reserva (as conversas seguem); e quantas o perfil já mandou na última hora, contadas neste ciclo.
  const atPrimeiras = new Map<string, { availableAt: Date; note: string; ids: string[] }>();
  const enviadasHora = new Map<string, number>();
  // Perfis em que a Meta pediu para esperar neste ciclo: os próximos envios deles voltam para a fila sem chamar a Meta.
  const metaWait = new Map<string, { availableAt: Date; note: string; ids: string[] }>();

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

        const accountKey = config.account_id ?? "";
        const waitingMeta = metaWait.get(accountKey);
        if (waitingMeta) {
          waitingMeta.ids.push(job.id);
          deferred += 1;
          continue;
        }

        const countsTowardDmLimit = job.send_type === "dm" || job.send_type === "private_reply";
        if (countsTowardDmLimit) {
          const limitKey = config.account_id ?? "";
          if (!enviadasHora.has(limitKey)) enviadasHora.set(limitKey, await sentDmCountLastHour(config.account_id));
          const naHora = enviadasHora.get(limitKey) ?? 0;
          let wait = atLimit.get(limitKey);
          if (!wait && naHora >= MAX_AUTOMATED_DMS_PER_HOUR) {
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
          if (job.send_type === "private_reply") {
            let espera = atPrimeiras.get(limitKey);
            if (!espera && naHora >= LIMITE_PRIMEIRAS_POR_HORA) {
              const availableAt = await nextDmSlot(config.account_id, LIMITE_PRIMEIRAS_POR_HORA);
              espera = {
                availableAt,
                note: `Fila do post: ${LIMITE_PRIMEIRAS_POR_HORA} primeiras mensagens por hora (o resto do limite fica para quem já está conversando). Sai às ${formatSaoPauloTime(availableAt)}.`,
                ids: [],
              };
              atPrimeiras.set(limitKey, espera);
              deferred += await deferPendingPrivateReplies(config.account_id, availableAt, espera.note);
            }
            if (espera) {
              espera.ids.push(job.id);
              deferred += 1;
              continue;
            }
          }
        }

        processed += 1;
        try {
          await sendJob(job, config.instagram_user_id, config.instagram_access_token);
          await markJobSent(job.id);
          if (countsTowardDmLimit) enviadasHora.set(accountKey, (enviadasHora.get(accountKey) ?? 0) + 1);
          // O desafio de 5 dias (0017): a última mensagem do dia saiu → o dia conta como entregue. Nunca falha.
          if (job.payload.origem === ORIGEM_DESAFIO && job.payload.principal === true) await marcarEnvioDesafio(job.id);
          sent += 1;
        } catch (error) {
          if (isMetaRateLimit(error)) {
            const wait = await deferJobForMetaLimit(job.id);
            if (wait.availableAt) {
              deferred += 1;
              metaWait.set(accountKey, { availableAt: wait.availableAt, note: wait.note, ids: [] });
              deferred += await deferPendingJobsForAccount(config.account_id, wait.availableAt, wait.note);
            } else {
              failed += 1;
            }
          } else {
            failed += 1;
            await markJobFailed(job.id, error instanceof Error ? error.message : "Erro desconhecido ao enviar");
          }
        }

        await delay(SEND_DELAY_MS);
      }
    } finally {
      // Adiadas do lote, de uma vez só (também se algo falhar no meio: elas não podem ficar presas em "sending").
      for (const wait of [...atLimit.values(), ...atPrimeiras.values(), ...metaWait.values()]) {
        const ids = wait.ids.splice(0);
        await deferQueueJobs(ids, wait.availableAt, wait.note);
      }
    }
    if (stoppedEarly) break;
  }

  return { processed, sent, failed, deferred, stoppedEarly };
}

async function sendJob(job: QueueJob, instagramUserId: string, accessToken: string) {
  const context = await getTemplateContext({ contactId: job.contact_id, automationId: job.automation_id });
  // `literal`: o texto saiu pronto de uma pessoa (a resposta aprovada no Molde) e vai exatamente como está,
  // mesmo que tenha {{marcações}}; as outras mensagens trocam as variáveis ({{name}} etc.).
  const text = job.payload.literal === true ? String(job.payload.text || "") : renderMessageTemplate(String(job.payload.text || ""), context);
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
    // O texto sai antes da mídia. Se a mídia falhar, a próxima tentativa manda só a mídia: o texto já foi (textSent).
    if (text && job.payload.textSent !== true) {
      await sendDirectMessage({ instagramUserId, recipientId: job.instagram_recipient_id, accessToken, text });
      await markJobTextSent(job.id);
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
