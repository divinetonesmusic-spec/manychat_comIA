import {
  enqueueJob,
  upsertContact,
  type Automation,
  type InstagramAccount,
} from "@/lib/db/repositories";
import { iniciarSequencia, sequenciaDaAutomacao } from "@/lib/db/dm-sequencias";
import { executeAutomationFlow, hasExecutableFlow } from "@/lib/flow-executor";
import { getInstagramUserProfile, type InstagramUserProfile } from "@/lib/instagram/client";
import { registrarConvite } from "@/lib/db/desafios";

/**
 * O que um comentário que combinou com automações põe na fila: a resposta pública (se tiver), a resposta privada
 * (a 1ª mensagem, ou a de «siga primeiro»), o fluxo desenhado, a sequência de DM (0012) e o desafio (0017).
 * Uma regra só para o webhook (comentário novo) e para o «Responder quem já comentou» (comentários antigos).
 */
export async function runCommentAutomations(input: {
  account: InstagramAccount;
  eventId: string;
  commentId: string;
  instagramUserId: string;
  username: string | null;
  matches: Automation[];
}) {
  const { account, eventId, commentId, instagramUserId, username, matches } = input;
  const needsFollowerCheck = matches.some((automation) => automation.require_follower);
  const profile = needsFollowerCheck
    ? await safeGetInstagramUserProfile(instagramUserId, account.instagram_access_token)
    : null;

  const contactInput = {
    accountId: account.id,
    instagramUserId,
    instagramUsername: profile?.username ?? username,
    instagramName: profile?.name ?? null,
    instagramProfilePictureUrl: profile?.profile_pic ?? null,
    instagramFollowerCount: profile?.follower_count ?? null,
    isUserFollowBusiness: profile?.is_user_follow_business ?? null,
    isBusinessFollowUser: profile?.is_business_follow_user ?? null,
    followerCheckedAt: profile ? new Date() : null,
  };

  const contactId = await upsertContact(contactInput);
  const followUrl = account.instagram_username
    ? `https://www.instagram.com/${account.instagram_username}`
    : "https://www.instagram.com/";

  for (const automation of matches) {
    await upsertContact({ ...contactInput, lastAutomationId: automation.id });

    if (hasExecutableFlow(automation)) {
      const executed = await executeAutomationFlow({
        automation,
        eventId,
        contactId,
        instagramUserId,
        commentId,
        trigger: "comment",
        isFollower: profile?.is_user_follow_business ?? null,
        followUrl,
      });
      if (executed) continue;
    }

    await enqueuePublicReply({ automation, eventId, contactId, instagramUserId, commentId });

    if (automation.require_follower && profile?.is_user_follow_business !== true) {
      await enqueueNonFollowerPrivateReply({
        automation,
        eventId,
        contactId,
        instagramUserId,
        commentId,
        followUrl,
      });
      continue;
    }

    await enqueueWelcomePrivateReply({
      automation,
      eventId,
      contactId,
      instagramUserId,
      commentId,
      textOverride: automation.require_follower ? buildFollowerConfirmationText(automation.follower_confirmation_text, automation.follower_confirmation_greetings) : undefined,
    });
    // Sequência de DM do post (0012): a pessoa fica esperando a resposta dela para receber os passos 2, 3 e o lembrete.
    if (sequenciaDaAutomacao(automation)) await iniciarSequencia({ accountId: account.id, automationId: automation.id, contactId });
    // Desafio de 5 dias (0017): quem comentou entra como «comentou», com a versão (A ou B) sorteada; o toque em «Começar» manda o dia 1.
    if (automation.desafio_id) await desafioSafely("registrar quem comentou", () => registrarConvite({ desafioId: automation.desafio_id as string, accountId: account.id, contactId }));
  }

  return { contactId };
}

/** O desafio nunca derruba quem chamou: um erro dele só vai para o log. */
export async function desafioSafely<T>(oQue: string, fazer: () => Promise<T>): Promise<T | false> {
  try {
    return await fazer();
  } catch (error) {
    console.error(`[desafio] não consegui ${oQue}:`, error instanceof Error ? error.message : error);
    return false;
  }
}

export async function safeGetInstagramUserProfile(userId: string, accessToken: string): Promise<InstagramUserProfile | null> {
  try {
    return await getInstagramUserProfile(userId, accessToken);
  } catch (error) {
    console.warn("[webhook] follower check failed", error instanceof Error ? error.message : error);
    return null;
  }
}

async function enqueueWelcomePrivateReply(input: {
  automation: Automation;
  eventId: string;
  contactId: string;
  instagramUserId: string;
  commentId: string;
  textOverride?: string;
}) {
  await enqueueJob({
    accountId: input.automation.account_id,
    eventId: input.eventId,
    contactId: input.contactId,
    automationId: input.automation.id,
    instagramRecipientId: input.instagramUserId,
    instagramCommentId: input.commentId,
    sendType: "private_reply",
    availableAt: delayDate(resolveInitialDelaySeconds(input.automation)),
    payload: linkDireto(input.automation) && !input.textOverride
      ? {
          // Sem o passo do botão «Quero ver»: a 1ª mensagem já leva o botão com o link (1 mensagem por pessoa, não 2).
          text: input.automation.welcome_dm,
          buttonLabel: input.automation.link_button_label || "Abrir link",
          url: input.automation.link_url,
        }
      : {
          text: input.textOverride || input.automation.welcome_dm,
          quickReplyLabel: input.automation.quick_reply_label,
          quickReplyPayload: `automation:${input.automation.id}`,
          quickReplies: input.automation.quick_replies,
        },
  });
}

/** Sem resposta rápida configurada e com link: a mensagem de boas-vindas vai com o botão do link direto. */
export function linkDireto(automation: Pick<Automation, "quick_reply_label" | "quick_replies" | "link_url">) {
  return !automation.quick_reply_label?.trim() && !automation.quick_replies?.length && Boolean(automation.link_url?.trim());
}

async function enqueueNonFollowerPrivateReply(input: {
  automation: Automation;
  eventId: string;
  contactId: string;
  instagramUserId: string;
  commentId: string;
  followUrl: string;
}) {
  await enqueueJob({
    accountId: input.automation.account_id,
    eventId: input.eventId,
    contactId: input.contactId,
    automationId: input.automation.id,
    instagramRecipientId: input.instagramUserId,
    instagramCommentId: input.commentId,
    sendType: "private_reply",
    availableAt: delayDate(resolveInitialDelaySeconds(input.automation)),
    payload: {
      text: input.automation.non_follower_dm,
      buttonLabel: input.automation.non_follower_button_label,
      url: input.followUrl,
    },
  });
}

async function enqueuePublicReply(input: {
  automation: Automation;
  eventId: string;
  contactId: string;
  instagramUserId: string;
  commentId: string;
}) {
  if (!input.automation.public_replies.length) return;

  const text = pickPublicReply(input.automation);

  await enqueueJob({
    accountId: input.automation.account_id,
    eventId: input.eventId,
    contactId: input.contactId,
    automationId: input.automation.id,
    instagramRecipientId: input.instagramUserId,
    instagramCommentId: input.commentId,
    sendType: "public_reply",
    availableAt: delayDate(resolveInitialDelaySeconds(input.automation)),
    payload: { text },
  });
}

function buildFollowerConfirmationText(text: string, configuredGreetings: string[] | null | undefined) {
  const greetings = configuredGreetings?.map((item) => item.trim()).filter(Boolean) ?? [];
  const availableGreetings = greetings.length ? greetings : ["Oii", "Olá", "Eii", "Eae", "Opa"];
  const greeting = availableGreetings[Math.floor(Math.random() * availableGreetings.length)];
  return `${greeting} ${text}`.trim();
}

export function delayDate(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return new Date(Date.now() + safeSeconds * 1000);
}

export function resolveInitialDelaySeconds(automation: Automation) {
  const fixedSeconds = positiveInteger(automation.reply_delay_seconds);
  if (automation.reply_delay_mode !== "random") return fixedSeconds;
  const min = positiveInteger(automation.reply_delay_min_seconds ?? fixedSeconds);
  const max = positiveInteger(automation.reply_delay_max_seconds ?? fixedSeconds);
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickPublicReply(automation: Automation) {
  const replies = automation.public_replies.filter((reply) => reply.trim());
  if (!replies.length) return "";
  if (automation.public_reply_mode === "fixed") return replies[0];
  return replies[Math.floor(Math.random() * replies.length)];
}

function positiveInteger(value: number | null | undefined) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}
