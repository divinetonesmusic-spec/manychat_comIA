import { createHmac, timingSafeEqual } from "node:crypto";
import { after, type NextRequest, NextResponse } from "next/server";
import {
  enqueueFollowups,
  enqueueJob,
  findMatchingAutomations,
  getAutomation,
  getContactAutomationState,
  getInstagramAccountByInstagramUserId,
  getProfileSettings,
  recordEvent,
  setContactOptOut,
  upsertContact,
  type Automation,
  type AutomationTrigger,
} from "@/lib/db/repositories";
import { buildFollowerGatePayload, executeAutomationFlow, FOLLOW_CHECK_PAYLOAD_PREFIX, hasExecutableFlow } from "@/lib/flow-executor";
import { getInstagramUserProfile, type InstagramUserProfile } from "@/lib/instagram/client";

export const runtime = "nodejs";

type WebhookBody = {
  object?: string;
  entry?: WebhookEntry[];
};

type WebhookEntry = {
  id?: string;
  time?: number;
  changes?: WebhookChange[];
  messaging?: WebhookMessageEvent[];
};

type WebhookChange = {
  field?: string;
  value?: Record<string, unknown>;
};

type WebhookMessageEvent = {
  sender?: { id?: string; username?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    quick_reply?: { payload?: string };
    reply_to?: { story?: unknown };
    is_echo?: boolean;
  };
  message_edit?: unknown;
  reaction?: { mid?: string; action?: string; reaction?: string; emoji?: string };
  read?: unknown;
  delivery?: unknown;
  postback?: { payload?: string; title?: string };
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Invalid webhook verification" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as WebhookBody;
  const result = await processWebhookPayload(payload);

  after(async () => {
    await triggerQueueDrain(request.url);
  });

  return NextResponse.json({ ok: true, ...result });
}

async function processWebhookPayload(payload: WebhookBody) {
  let comments = 0;
  let messages = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === "comments") {
        comments += await processComment(entry, change);
      }
    }

    for (const messageEvent of entry.messaging ?? []) {
      messages += await processMessage(entry, messageEvent);
    }
  }

  return { comments, messages };
}

async function processComment(entry: WebhookEntry, change: WebhookChange) {
  const value = change.value ?? {};
  const commentId = readString(value, "id") || readString(value, "comment_id");
  const text = readString(value, "text") || readString(value, "message") || "";
  const media = value.media && typeof value.media === "object" ? (value.media as Record<string, unknown>) : null;
  const from = value.from && typeof value.from === "object" ? (value.from as Record<string, unknown>) : null;
  const mediaId = readString(value, "media_id") || (media ? readString(media, "id") : null);
  const instagramUserId = from ? readString(from, "id") : null;
  const username = from ? readString(from, "username") : null;

  if (!commentId || !text || !instagramUserId) return 0;
  const account = await getInstagramAccountByInstagramUserId(entry.id);
  if (!account) return 0;
  if (instagramUserId === account.instagram_user_id) return 0;

  const settings = await getProfileSettings(account.id);
  if (!settings.channel_active) return 0;

  const eventId = await recordEvent({
    accountId: account.id,
    eventType: "comment",
    instagramEventId: `comment:${commentId}`,
    instagramUserId,
    instagramUsername: username,
    instagramCommentId: commentId,
    instagramMediaId: mediaId,
    payload: { entry, change },
  });

  const matches = await findMatchingAutomations({ accountId: account.id, trigger: "comments", text, postId: mediaId });
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
  }

  return matches.length;
}

async function processMessage(entry: WebhookEntry, event: WebhookMessageEvent) {
  const senderId = event.sender?.id;
  const text = event.message?.text || event.postback?.payload || event.postback?.title || "";
  const payload = event.message?.quick_reply?.payload || event.postback?.payload || null;
  const trigger: AutomationTrigger = event.message?.reply_to?.story ? "story" : "dm";

  if (!senderId) return 0;
  const account = await getInstagramAccountByInstagramUserId(entry.id);
  if (!account) return 0;
  if (senderId === account.instagram_user_id || event.message?.is_echo || event.message_edit || event.read || event.delivery) return 0;

  const settings = await getProfileSettings(account.id);
  if (!settings.channel_active) return 0;

  if (event.reaction) {
    const contactId = await upsertContact({
      accountId: account.id,
      instagramUserId: senderId,
      instagramUsername: event.sender?.username,
      markResponse: true,
    });

    await recordEvent({
      accountId: account.id,
      eventType: "message_reaction",
      instagramEventId: buildReactionEventId(entry, event, senderId),
      instagramUserId: senderId,
      instagramUsername: event.sender?.username,
      payload: { entry, event },
    });

    return contactId ? 1 : 0;
  }

  const eventId = await recordEvent({
    accountId: account.id,
    eventType: trigger === "story" ? "story_reply" : "message",
    instagramEventId: event.message?.mid || `message:${entry.id}:${event.timestamp ?? Date.now()}:${senderId}`,
    instagramUserId: senderId,
    instagramUsername: event.sender?.username,
    payload: { entry, event },
  });

  const contactId = await upsertContact({
    accountId: account.id,
    instagramUserId: senderId,
    instagramUsername: event.sender?.username,
    markResponse: true,
  });

  if (payload?.startsWith(FOLLOW_CHECK_PAYLOAD_PREFIX)) {
    const automationId = payload.replace(FOLLOW_CHECK_PAYLOAD_PREFIX, "");
    const automation = await getAutomation(automationId, account.id);
    if (!automation?.active) return 1;

    const profile = await safeGetInstagramUserProfile(senderId, account.instagram_access_token);
    await upsertContact({
      accountId: account.id,
      instagramUserId: senderId,
      instagramUsername: profile?.username ?? event.sender?.username,
      instagramName: profile?.name ?? null,
      instagramProfilePictureUrl: profile?.profile_pic ?? null,
      instagramFollowerCount: profile?.follower_count ?? null,
      isUserFollowBusiness: profile?.is_user_follow_business ?? null,
      isBusinessFollowUser: profile?.is_business_follow_user ?? null,
      followerCheckedAt: profile ? new Date() : null,
      lastAutomationId: automation.id,
    });

    const followUrl = account.instagram_username
      ? `https://www.instagram.com/${account.instagram_username}`
      : "https://www.instagram.com/";

    if (profile?.is_user_follow_business === true) {
      if (hasExecutableFlow(automation)) {
        await executeAutomationFlow({
          automation,
          eventId,
          contactId,
          instagramUserId: senderId,
          trigger,
          isFollower: true,
          followUrl,
          startNodeId: "condition",
        });
      } else {
        await enqueueWelcomeDm({ automation, eventId, contactId, instagramUserId: senderId });
      }
      return 1;
    }

    await enqueueJob({
      accountId: account.id,
      eventId,
      contactId,
      automationId: automation.id,
      instagramRecipientId: senderId,
      sendType: "dm",
      payload: buildFollowerGatePayload(automation, followUrl),
    });
    return 1;
  }

  if (payload?.startsWith("automation:")) {
    const automationId = payload.replace("automation:", "");
    const automation = await getAutomation(automationId, account.id);
    if (automation?.active && hasExecutableFlow(automation)) {
      const profile = automation.require_follower ? await safeGetInstagramUserProfile(senderId, account.instagram_access_token) : null;
      if (profile) {
        await upsertContact({
          accountId: account.id,
          instagramUserId: senderId,
          instagramUsername: profile.username ?? event.sender?.username,
          instagramName: profile.name ?? null,
          instagramProfilePictureUrl: profile.profile_pic ?? null,
          instagramFollowerCount: profile.follower_count ?? null,
          isUserFollowBusiness: profile.is_user_follow_business ?? null,
          isBusinessFollowUser: profile.is_business_follow_user ?? null,
          followerCheckedAt: new Date(),
        });
      }
      await executeAutomationFlow({
        automation,
        eventId,
        contactId,
        instagramUserId: senderId,
        trigger,
        isFollower: profile?.is_user_follow_business ?? null,
        startNodeId: "condition",
      });
      return 1;
    }
    await enqueueFollowups({ accountId: account.id, automationId, contactId, instagramRecipientId: senderId, eventId });
    return 1;
  }

  if (payload && isHttpUrl(payload)) {
    await enqueueJob({
      accountId: account.id,
      eventId,
      contactId,
      instagramRecipientId: senderId,
      sendType: "dm",
      payload: {
        type: "link",
        text: "Aqui está o link que você pediu:",
        buttonLabel: text || "Acessar agora",
        url: payload,
      },
    });
    return 1;
  }

  if (!text) return 0;

  const normalizedText = normalizeWebhookText(text);
  if (isOptOutText(normalizedText)) {
    await setContactOptOut(contactId, true);
    if (settings.opt_out_automation_id) {
      const automation = await getAutomation(settings.opt_out_automation_id, account.id);
      if (automation?.active) await enqueueWelcomeDm({ automation, eventId, contactId, instagramUserId: senderId });
    }
    return 1;
  }

  if (isOptInText(normalizedText)) {
    await setContactOptOut(contactId, false);
    if (settings.opt_in_automation_id) {
      const automation = await getAutomation(settings.opt_in_automation_id, account.id);
      if (automation?.active) await enqueueWelcomeDm({ automation, eventId, contactId, instagramUserId: senderId });
    }
    return 1;
  }

  const matches = await findMatchingAutomations({ accountId: account.id, trigger, text });
  for (const automation of matches) {
    if (hasExecutableFlow(automation)) {
      await executeAutomationFlow({ automation, eventId, contactId, instagramUserId: senderId, trigger, startNodeId: "trigger" });
      continue;
    }
    await enqueueWelcomeDm({ automation, eventId, contactId, instagramUserId: senderId });
  }

  if (!matches.length && trigger === "dm") {
    const state = await getContactAutomationState(contactId);
    const automation = state?.last_automation_id ? await getAutomation(state.last_automation_id, account.id) : null;
    if (automation?.active && hasExecutableFlow(automation) && automationMatchesIncomingText(automation, text)) {
      const profile = automation.require_follower ? await safeGetInstagramUserProfile(senderId, account.instagram_access_token) : null;
      if (profile) {
        await upsertContact({
          accountId: account.id,
          instagramUserId: senderId,
          instagramUsername: profile.username ?? event.sender?.username,
          instagramName: profile.name ?? null,
          instagramProfilePictureUrl: profile.profile_pic ?? null,
          instagramFollowerCount: profile.follower_count ?? null,
          isUserFollowBusiness: profile.is_user_follow_business ?? null,
          isBusinessFollowUser: profile.is_business_follow_user ?? null,
          followerCheckedAt: new Date(),
        });
      }
      const executed = await executeAutomationFlow({
        automation,
        eventId,
        contactId,
        instagramUserId: senderId,
        trigger,
        isFollower: profile?.is_user_follow_business ?? state?.is_user_follow_business ?? null,
        startNodeId: "condition",
      });
      if (executed) return 1;
    }
  }

  if (!matches.length && trigger === "dm" && settings.default_automation_id) {
    const automation = await getAutomation(settings.default_automation_id, account.id);
    if (automation?.active) {
      await enqueueWelcomeDm({ automation, eventId, contactId, instagramUserId: senderId });
      return 1;
    }
  }

  return matches.length;
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
    payload: {
      text: input.textOverride || input.automation.welcome_dm,
      quickReplyLabel: input.automation.quick_reply_label,
      quickReplyPayload: `automation:${input.automation.id}`,
      quickReplies: input.automation.quick_replies,
    },
  });
}

async function enqueueWelcomeDm(input: {
  automation: Automation;
  eventId: string;
  contactId: string;
  instagramUserId: string;
  textOverride?: string;
}) {
  await enqueueJob({
    accountId: input.automation.account_id,
    eventId: input.eventId,
    contactId: input.contactId,
    automationId: input.automation.id,
    instagramRecipientId: input.instagramUserId,
    sendType: "dm",
    availableAt: delayDate(resolveInitialDelaySeconds(input.automation)),
    payload: {
      text: input.textOverride || input.automation.welcome_dm,
      quickReplyLabel: input.automation.quick_reply_label,
      quickReplyPayload: `automation:${input.automation.id}`,
      quickReplies: input.automation.quick_replies,
    },
  });
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

async function safeGetInstagramUserProfile(userId: string, accessToken: string): Promise<InstagramUserProfile | null> {
  try {
    return await getInstagramUserProfile(userId, accessToken);
  } catch (error) {
    console.warn("[webhook] follower check failed", error instanceof Error ? error.message : error);
    return null;
  }
}

function buildFollowerConfirmationText(text: string, configuredGreetings: string[] | null | undefined) {
  const greetings = configuredGreetings?.map((item) => item.trim()).filter(Boolean) ?? [];
  const availableGreetings = greetings.length ? greetings : ["Oii", "Olá", "Eii", "Eae", "Opa"];
  const greeting = availableGreetings[Math.floor(Math.random() * availableGreetings.length)];
  return `${greeting} ${text}`.trim();
}

function buildReactionEventId(entry: WebhookEntry, event: WebhookMessageEvent, senderId: string) {
  const reaction = event.reaction;
  const messageId = reaction?.mid || event.message?.mid || "unknown-message";
  const action = reaction?.action || "react";
  const value = reaction?.emoji || reaction?.reaction || "reaction";
  const timestamp = event.timestamp ?? entry.time ?? Date.now();
  return `reaction:${entry.id ?? "entry"}:${senderId}:${messageId}:${action}:${value}:${timestamp}`;
}
function delayDate(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return new Date(Date.now() + safeSeconds * 1000);
}

function resolveInitialDelaySeconds(automation: Automation) {
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

function verifySignature(rawBody: string, signature: string | null) {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appSecret || !signature?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const actual = signature.replace("sha256=", "");

  try {
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

async function triggerQueueDrain(requestUrl: string) {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return;

  const url = new URL("/api/queue/drain", requestUrl);
  await fetch(url, {
    method: "POST",
    headers: { "x-worker-secret": secret },
  }).catch(() => undefined);
}

function readString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeWebhookText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function automationMatchesIncomingText(automation: Automation, value: string) {
  const normalizedText = normalizeWebhookText(value);
  if (automation.match_type === "any") return true;

  const keywords = automation.keywords.map(normalizeWebhookText).filter(Boolean);
  if (!keywords.length) return false;
  if (automation.match_type === "exact") return keywords.some((keyword) => normalizedText === keyword);
  return keywords.some((keyword) => normalizedText.includes(keyword));
}

function isOptInText(value: string) {
  return ["comecar", "comeÃ§ar", "inscrever", "inscrever-se", "start", "subscribe"].includes(value);
}

function isOptOutText(value: string) {
  return ["parar", "cancelar", "cancelar inscricao", "cancelar inscriÃ§Ã£o", "stop", "unsubscribe"].includes(value);
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
