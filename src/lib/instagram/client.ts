import {
  GRAPH_BASE_URL,
  IG_OAUTH_TOKEN_URL,
  META_API_VERSION,
  requireEnv,
} from "@/lib/env";

type GraphResponse<T> = T & { error?: { message: string; type?: string; code?: number } };

export type InstagramProfile = {
  user_id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
};

export async function exchangeCodeForLongToken(code: string, redirectUri: string) {
  const shortTokenResponse = await fetch(IG_OAUTH_TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      client_id: requireEnv("INSTAGRAM_APP_ID"),
      client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });

  const shortToken = await readGraphResponse<{ access_token: string; user_id: number }>(shortTokenResponse);
  const longTokenUrl = new URL("https://graph.instagram.com/access_token");
  longTokenUrl.searchParams.set("grant_type", "ig_exchange_token");
  longTokenUrl.searchParams.set("client_secret", requireEnv("INSTAGRAM_APP_SECRET"));
  longTokenUrl.searchParams.set("access_token", shortToken.access_token);

  const longTokenResponse = await fetch(longTokenUrl);

  return readGraphResponse<{ access_token: string; token_type: string; expires_in: number }>(longTokenResponse);
}

export async function refreshLongLivedToken(accessToken: string) {
  const url = new URL(`${GRAPH_BASE_URL}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  return readGraphResponse<{ access_token: string; token_type: string; expires_in: number }>(response);
}

export async function getInstagramProfile(accessToken: string) {
  const url = new URL(`${GRAPH_BASE_URL}/me`);
  url.searchParams.set("fields", "user_id,username,name,profile_picture_url");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  return readGraphResponse<InstagramProfile>(response);
}

export type InstagramQuickReply = {
  title: string;
  payload: string;
};

export type InstagramButton = {
  type: "web_url" | "postback";
  title: string;
  url?: string | null;
  payload?: string | null;
};

export type InstagramUserProfile = {
  id: string;
  name?: string;
  username?: string;
  profile_pic?: string;
  follower_count?: number;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
};

export async function getInstagramUserProfile(userId: string, accessToken: string) {
  const url = new URL(`${GRAPH_BASE_URL}/${userId}`);
  url.searchParams.set("fields", "name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user");

  return graphFetch<InstagramUserProfile>(url, accessToken);
}

export async function subscribeWebhooks(instagramUserId: string, accessToken: string) {
  const url = new URL(`${GRAPH_BASE_URL}/${instagramUserId}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", "comments,messages");

  const response = await graphFetch<{ success: boolean }>(url, accessToken, { method: "POST" });
  return response.success;
}


export async function getInstagramSubscribedApps(instagramUserId: string, accessToken: string) {
  const url = new URL(`${GRAPH_BASE_URL}/${instagramUserId}/subscribed_apps`);
  return graphFetch<{ data?: Array<Record<string, unknown>> }>(url, accessToken);
}
export async function listInstagramMedia(instagramUserId: string, accessToken: string) {
  const url = new URL(`${GRAPH_BASE_URL}/${instagramUserId}/media`);
  url.searchParams.set("fields", "id,media_type,media_url,thumbnail_url,caption,permalink");

  return graphFetch<{ data: unknown[] }>(url, accessToken);
}

export type MessengerProfileMenuItem = {
  title: string;
  type: "postback" | "web_url";
  payload?: string;
  url?: string;
};

export type MessengerProfileIceBreaker = {
  question: string;
  payload: string;
};

export async function setInstagramPersistentMenu(input: {
  instagramUserId: string;
  accessToken: string;
  items: MessengerProfileMenuItem[];
}) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.instagramUserId}/messenger_profile`);

  return graphFetch<{ result?: string }>(url, input.accessToken, {
    method: "POST",
    body: JSON.stringify({
      platform: "instagram",
      persistent_menu: [
        {
          locale: "default",
          composer_input_disabled: false,
          call_to_actions: input.items.map((item) =>
            item.type === "web_url"
              ? { type: "web_url", title: item.title.slice(0, 30), url: item.url, webview_height_ratio: "full" }
              : { type: "postback", title: item.title.slice(0, 30), payload: item.payload },
          ),
        },
      ],
    }),
  });
}

export async function setInstagramIceBreakers(input: {
  instagramUserId: string;
  accessToken: string;
  items: MessengerProfileIceBreaker[];
}) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.instagramUserId}/messenger_profile`);

  return graphFetch<{ result?: string }>(url, input.accessToken, {
    method: "POST",
    body: JSON.stringify({
      platform: "instagram",
      ice_breakers: [
        {
          locale: "default",
          call_to_actions: input.items.slice(0, 4).map((item) => ({
            question: item.question.slice(0, 80),
            payload: item.payload,
          })),
        },
      ],
    }),
  });
}


export async function getInstagramMessengerProfile(input: {
  instagramUserId: string;
  accessToken: string;
  fields: "persistent_menu" | "ice_breakers";
}) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.instagramUserId}/messenger_profile`);
  url.searchParams.set("fields", input.fields);

  return graphFetch<{ data?: Array<Record<string, unknown>> }>(url, input.accessToken);
}

export async function deleteInstagramMessengerProfile(input: {
  instagramUserId: string;
  accessToken: string;
  fields: "persistent_menu" | "ice_breakers";
}) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.instagramUserId}/messenger_profile`);
  url.searchParams.set("fields", JSON.stringify([input.fields]));

  return graphFetch<{ result?: string }>(url, input.accessToken, { method: "DELETE" });
}

export type InstagramPublishType = "feed_image" | "reel_video" | "story_image" | "story_video";

export type InstagramCarouselMediaItem = {
  type: "image" | "video";
  url: string;
  coverUrl?: string | null;
};

export async function createInstagramMediaContainer(input: {
  instagramUserId: string;
  accessToken: string;
  publishType: InstagramPublishType;
  mediaUrl: string;
  caption?: string;
  coverUrl?: string | null;
}) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.instagramUserId}/media`);
  const body: Record<string, unknown> = {
    caption: input.caption || "",
  };

  if (input.publishType === "reel_video") {
    body.media_type = "REELS";
    body.video_url = input.mediaUrl;
    body.share_to_feed = true;
    if (input.coverUrl) body.cover_url = input.coverUrl;
  } else if (input.publishType === "story_video") {
    body.media_type = "STORIES";
    body.video_url = input.mediaUrl;
  } else if (input.publishType === "story_image") {
    body.media_type = "STORIES";
    body.image_url = input.mediaUrl;
  } else {
    body.image_url = input.mediaUrl;
  }

  return graphFetch<{ id: string }>(url, input.accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export async function createInstagramCarouselItemContainer(input: {
  instagramUserId: string;
  accessToken: string;
  item: InstagramCarouselMediaItem;
}) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.instagramUserId}/media`);
  const body: Record<string, unknown> = {
    is_carousel_item: true,
  };

  if (input.item.type === "video") {
    body.media_type = "VIDEO";
    body.video_url = input.item.url;
    if (input.item.coverUrl) body.cover_url = input.item.coverUrl;
  } else {
    body.image_url = input.item.url;
  }

  return graphFetch<{ id: string }>(url, input.accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createInstagramCarouselContainer(input: {
  instagramUserId: string;
  accessToken: string;
  children: string[];
  caption?: string;
}) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.instagramUserId}/media`);

  return graphFetch<{ id: string }>(url, input.accessToken, {
    method: "POST",
    body: JSON.stringify({
      media_type: "CAROUSEL",
      children: input.children.join(","),
      caption: input.caption || "",
    }),
  });
}

export async function getInstagramMediaContainerStatus(containerId: string, accessToken: string) {
  const url = new URL(`${GRAPH_BASE_URL}/${containerId}`);
  url.searchParams.set("fields", "id,status_code,status");
  return graphFetch<{ id: string; status_code?: string; status?: string }>(url, accessToken);
}

export async function publishInstagramMediaContainer(input: {
  instagramUserId: string;
  accessToken: string;
  containerId: string;
}) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.instagramUserId}/media_publish`);
  return graphFetch<{ id: string }>(url, input.accessToken, {
    method: "POST",
    body: JSON.stringify({ creation_id: input.containerId }),
  });
}

export async function getPublishedInstagramMedia(mediaId: string, accessToken: string) {
  const url = new URL(`${GRAPH_BASE_URL}/${mediaId}`);
  url.searchParams.set("fields", "id,permalink,media_type,timestamp");
  return graphFetch<{ id: string; permalink?: string }>(url, accessToken);
}
export async function sendPrivateReply(input: {
  instagramUserId: string;
  commentId: string;
  accessToken: string;
  text: string;
  quickReplyLabel?: string | null;
  quickReplyPayload?: string | null;
  quickReplies?: InstagramQuickReply[] | null;
  buttonLabel?: string | null;
  url?: string | null;
  buttonPayload?: string | null;
  buttons?: InstagramButton[] | null;
}) {
  return sendMessage({
    instagramUserId: input.instagramUserId,
    accessToken: input.accessToken,
    recipient: { comment_id: input.commentId },
    message: input.buttons?.length
      ? buildButtonsMessage(input.text, input.buttons)
      : input.url
        ? buildButtonMessage(input.text, input.buttonLabel || "Abrir link", input.url)
        : input.buttonPayload
          ? buildButtonMessage(input.text, input.buttonLabel || "Continuar", null, input.buttonPayload)
          : buildTextMessage(input.text, input.quickReplyLabel, input.quickReplyPayload, input.quickReplies),
  });
}

export async function sendDirectMessage(input: {
  instagramUserId: string;
  recipientId: string;
  accessToken: string;
  text: string;
  buttonLabel?: string | null;
  url?: string | null;
  buttonPayload?: string | null;
  quickReplyLabel?: string | null;
  quickReplyPayload?: string | null;
  quickReplies?: InstagramQuickReply[] | null;
  buttons?: InstagramButton[] | null;
}) {
  return sendMessage({
    instagramUserId: input.instagramUserId,
    accessToken: input.accessToken,
    recipient: { id: input.recipientId },
    message: input.buttons?.length
      ? buildButtonsMessage(input.text, input.buttons)
      : input.url
        ? buildButtonMessage(input.text, input.buttonLabel || "Abrir link", input.url)
        : input.buttonPayload
          ? buildButtonMessage(input.text, input.buttonLabel || "Continuar", null, input.buttonPayload)
          : buildTextMessage(input.text, input.quickReplyLabel, input.quickReplyPayload, input.quickReplies),
  });
}

export async function sendDirectMediaMessage(input: {
  instagramUserId: string;
  recipientId: string;
  accessToken: string;
  mediaType: "image" | "audio" | "video";
  url: string;
}) {
  return sendMessage({
    instagramUserId: input.instagramUserId,
    accessToken: input.accessToken,
    recipient: { id: input.recipientId },
    message: buildMediaMessage(input.mediaType, input.url),
  });
}

/** Comenta no próprio post (usado para o "primeiro comentário" depois de publicar). */
export async function createInstagramMediaComment(input: { mediaId: string; accessToken: string; message: string }) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.mediaId}/comments`);
  return graphFetch<{ id: string }>(url, input.accessToken, {
    method: "POST",
    body: JSON.stringify({ message: input.message }),
  });
}

/** Resultados de um post publicado. Métricas que a Meta recusar para o tipo de mídia são ignoradas. */
export async function getInstagramMediaInsights(input: { mediaId: string; accessToken: string; isReel: boolean }) {
  const preferred = input.isReel
    ? ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time"]
    : ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"];
  const result: Record<string, number> = {};
  let metrics = preferred.slice();

  for (let attempt = 0; attempt < 3 && metrics.length; attempt += 1) {
    const url = new URL(`${GRAPH_BASE_URL}/${input.mediaId}/insights`);
    url.searchParams.set("metric", metrics.join(","));
    try {
      const data = await graphFetch<{ data?: Array<{ name: string; values?: Array<{ value: number }>; total_value?: { value: number } }> }>(url, input.accessToken);
      for (const item of data.data ?? []) {
        const value = item.total_value?.value ?? item.values?.[0]?.value;
        if (typeof value === "number") result[item.name] = value;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const bad = metrics.filter((metric) => message.includes(metric));
      metrics = bad.length ? metrics.filter((metric) => !bad.includes(metric)) : metrics.slice(0, Math.max(0, metrics.length - 2));
    }
  }

  return result;
}

export async function sendPublicCommentReply(input: {
  commentId: string;
  accessToken: string;
  text: string;
}) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.commentId}/replies`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: input.text }),
  });

  return readGraphResponse<{ id: string }>(response);
}

function sendMessage(input: {
  instagramUserId: string;
  accessToken: string;
  recipient: Record<string, string>;
  message: Record<string, unknown>;
}) {
  const url = new URL(`${GRAPH_BASE_URL}/${input.instagramUserId}/messages`);

  return graphFetch<{ recipient_id?: string; message_id?: string }>(url, input.accessToken, {
    method: "POST",
    body: JSON.stringify({ recipient: input.recipient, message: input.message }),
  });
}

function buildTextMessage(text: string, quickReplyLabel?: string | null, quickReplyPayload?: string | null, quickReplies?: InstagramQuickReply[] | null) {
  const message: Record<string, unknown> = { text };

  const replies = quickReplies?.length
    ? quickReplies
    : quickReplyLabel && quickReplyPayload
      ? [{ title: quickReplyLabel, payload: quickReplyPayload }]
      : [];

  if (replies.length) {
    message.quick_replies = replies.slice(0, 13).map((reply) => ({
      content_type: "text",
      title: reply.title.slice(0, 20),
      payload: reply.payload,
    }));
  }

  return message;
}

function buildButtonMessage(text: string, buttonLabel: string, url: string | null, payload?: string | null) {
  return buildButtonsMessage(text, [
    url
      ? { type: "web_url", url, title: buttonLabel }
      : { type: "postback", payload: payload || buttonLabel, title: buttonLabel },
  ]);
}

function buildButtonsMessage(text: string, buttons: InstagramButton[]) {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text,
        buttons: buttons.slice(0, 3).map((button) => button.type === "web_url"
          ? {
              type: "web_url",
              url: button.url,
              title: button.title.slice(0, 20),
            }
          : {
              type: "postback",
              payload: button.payload || button.title,
              title: button.title.slice(0, 20),
            }),
      },
    },
  };
}

function buildMediaMessage(type: "image" | "audio" | "video", url: string) {
  return {
    attachment: {
      type,
      payload: { url },
    },
  };
}

async function graphFetch<T>(url: URL, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  return readGraphResponse<T>(response);
}

async function readGraphResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as GraphResponse<T>;

  if (!response.ok || payload.error) {
    const details = payload.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Instagram Graph ${META_API_VERSION}: ${details}`);
  }

  return payload as T;
}
