import type { ContentMediaItem, ContentPublishType } from "@/lib/db/repositories";
import type { AutomationOptions, PostPackage } from "@/lib/db/content-planner";

/**
 * Lê e confere o "pacote" de um post vindo da tela de Conteúdo ou do Molde do Avatar:
 * mídia, legenda, horário e o funil (palavra-chave → DM → link + 1º comentário).
 */
export type ParsedPackage = { ok: true; value: PostPackage; publishNow: boolean } | { ok: false; error: string };

const PUBLISH_TYPES: ContentPublishType[] = ["feed_image", "feed_video", "reel_video", "story_image", "story_video", "carousel"];

export function parsePostPackage(body: Record<string, unknown>, options: { partial?: boolean } = {}): ParsedPackage {
  const partial = Boolean(options.partial);
  const publishType = parsePublishType(body.publishType);
  if (!publishType && !partial) return { ok: false, error: "Tipo de publicacao invalido." };

  const caption = optionalText(body.caption, 2200);
  if (caption && countHashtags(caption) > 30) return { ok: false, error: "A legenda passa de 30 hashtags (limite do Instagram)." };

  const mediaUrl = optionalString(body.mediaUrl);
  const coverUrl = body.coverUrl === null ? null : optionalString(body.coverUrl);
  const mediaItems = body.mediaItems === undefined ? undefined : parseItems(body.mediaItems);

  if (publishType === "carousel" && (!partial || mediaItems)) {
    const items = mediaItems ?? [];
    if (items.length < 2) return { ok: false, error: "Carrossel precisa ter pelo menos 2 itens." };
    if (items.length > 10) return { ok: false, error: "Carrossel aceita no maximo 10 itens." };
    const bad = items.findIndex((item) => !isHttpUrl(item.url));
    if (bad >= 0) return { ok: false, error: `Item ${bad + 1}: o link da midia precisa ser publico (https).` };
  } else if (publishType && (!partial || mediaUrl !== undefined)) {
    if (!mediaUrl || !isHttpUrl(mediaUrl)) return { ok: false, error: "Envie o arquivo ou informe um link publico (https) da midia." };
  }
  if (coverUrl && !isHttpUrl(coverUrl)) return { ok: false, error: "O link da capa precisa ser publico (https)." };

  const publishNow = body.publishNow === true || body.when === "now";
  let scheduledAt: Date | null | undefined;
  if (body.scheduledAt === null || body.when === "draft") scheduledAt = null;
  else if (body.scheduledAt !== undefined) {
    const date = new Date(String(body.scheduledAt));
    if (Number.isNaN(date.getTime())) return { ok: false, error: "Data/hora do agendamento invalida." };
    if (date.getTime() > Date.now() + 75 * 86400_000) return { ok: false, error: "Agende no maximo 75 dias para frente." };
    scheduledAt = date.getTime() < Date.now() - 60_000 && !publishNow ? new Date() : date;
  }

  const linkUrl = optionalString(body.linkUrl);
  if (linkUrl && !isHttpUrl(linkUrl)) return { ok: false, error: "O link do produto precisa comecar com https://" };

  const keyword = optionalText(body.keyword, 120);
  const dmText = optionalText(body.dmText, 1000);
  if (keyword && !dmText && !linkUrl) return { ok: false, error: "Com palavra-chave, preencha a mensagem da DM ou o link." };

  const value: PostPackage = {
    accountId: optionalString(body.accountId) ?? null,
    publishType: (publishType ?? undefined) as ContentPublishType,
    title: optionalText(body.title, 200),
    caption,
    mediaUrl: publishType === "carousel" ? undefined : mediaUrl,
    coverUrl,
    mediaItems: publishType === "carousel" ? mediaItems : publishType ? [] : undefined,
    // só chaves criadas pelo próprio UaiFlow (pasta uaiflow/): ninguém apaga outro arquivo do bucket por aqui
    mediaKeys: Array.isArray(body.mediaKeys) ? body.mediaKeys.filter((key): key is string => typeof key === "string" && /^uaiflow\/[\w.\-/]+$/.test(key) && !key.includes("..")).slice(0, 12) : undefined,
    scheduledAt,
    firstComment: optionalText(body.firstComment, 2200),
    keyword,
    dmText,
    linkUrl,
    linkLabel: optionalText(body.linkLabel, 20),
    publicReply: optionalText(body.publicReply, 300),
    automationOptions: parseAutomationOptions(body.automationOptions),
    source: optionalString(body.source)?.slice(0, 40),
    externalRef: optionalString(body.externalRef)?.slice(0, 200) ?? null,
  };

  if (partial) {
    for (const key of Object.keys(value) as (keyof PostPackage)[]) if (value[key] === undefined) delete value[key];
  }
  return { ok: true, value, publishNow };
}

function parseAutomationOptions(value: unknown): AutomationOptions | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    quickReplyLabel: optionalText(record.quickReplyLabel, 20),
    linkText: optionalText(record.linkText, 640),
    reminderText: optionalText(record.reminderText, 640),
    publicReplies: Array.isArray(record.publicReplies)
      ? record.publicReplies.filter((text): text is string => typeof text === "string" && Boolean(text.trim())).map((text) => text.trim().slice(0, 300)).slice(0, 8)
      : undefined,
    requireFollower: typeof record.requireFollower === "boolean" ? record.requireFollower : undefined,
  };
}

function parseItems(value: unknown): ContentMediaItem[] {
  if (!Array.isArray(value)) return [];
  const items: ContentMediaItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = optionalString(record.url);
    if (!url) continue;
    items.push({
      type: record.type === "video" ? "video" : "image",
      url,
      cover_url: optionalString(record.coverUrl) ?? optionalString(record.cover_url) ?? null,
      status: "pending",
    });
  }
  return items;
}

function parsePublishType(value: unknown): ContentPublishType | null {
  if (value === "reel") return "reel_video";
  return PUBLISH_TYPES.includes(value as ContentPublishType) ? (value as ContentPublishType) : null;
}

function countHashtags(text: string) {
  return (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalText(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
