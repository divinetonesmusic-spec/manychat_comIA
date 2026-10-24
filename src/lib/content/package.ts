import { isProtectedKey } from "@/lib/content/r2";
import type { ContentMediaItem, ContentPublishType } from "@/lib/db/repositories";
import type { AutomationOptions, MusicChoice, PostPackage } from "@/lib/db/content-planner";
import { clampVolume, DEFAULT_MUSIC_VOLUME, DEFAULT_VIDEO_VOLUME } from "@/lib/instagram/client";
import { isYoutubePrivacidade, parseRedes, redesCompativeis, REDES_INVALIDAS, REDES_SO_REEL, redesExtras } from "@/lib/redes/redes";
import { parseDestino } from "@/lib/content/destino";
import { parseSequencia } from "@/lib/db/dm-sequencias";

/**
 * Lê e confere o "pacote" de um post vindo da tela de Conteúdo ou do Molde do Avatar:
 * mídia, legenda, horário e o funil (palavra-chave → DM → link + 1º comentário).
 */
export type ParsedPackage = { ok: true; value: PostPackage; publishNow: boolean; avisos?: string[] } | { ok: false; error: string };

/** Aviso quando a lista de redes veio sem o Instagram (ele é sempre a rede principal e entra sozinho). */
export const REDES_INSTAGRAM_INCLUIDO = "O Instagram é sempre a rede principal: foi incluído nas redes do post.";
export const YOUTUBE_PRIVACIDADE_INVALIDA = "youtubePrivacidade inválida: use public, unlisted ou private.";

const PUBLISH_TYPES: ContentPublishType[] = ["feed_image", "feed_video", "reel_video", "story_image", "story_video", "carousel"];

export function parsePostPackage(body: Record<string, unknown>, options: { partial?: boolean } = {}): ParsedPackage {
  const partial = Boolean(options.partial);
  const publishType = parsePublishType(body.publishType);
  if (!publishType && !partial) return { ok: false, error: "Tipo de publicação inválido." };

  const caption = optionalText(body.caption, 2200);
  if (caption && countHashtags(caption) > 30) return { ok: false, error: "A legenda passa de 30 hashtags (limite do Instagram)." };

  const mediaUrl = optionalString(body.mediaUrl);
  const coverUrl = body.coverUrl === null ? null : optionalString(body.coverUrl);
  const mediaItems = body.mediaItems === undefined ? undefined : parseItems(body.mediaItems);

  if (publishType === "carousel" && (!partial || mediaItems)) {
    const items = mediaItems ?? [];
    if (items.length < 2) return { ok: false, error: "Carrossel precisa ter pelo menos 2 itens." };
    if (items.length > 10) return { ok: false, error: "Carrossel aceita no máximo 10 itens." };
    const bad = items.findIndex((item) => !isHttpUrl(item.url));
    if (bad >= 0) return { ok: false, error: `Item ${bad + 1}: o link da mídia precisa ser público (https).` };
  } else if (publishType && (!partial || mediaUrl !== undefined)) {
    if (!mediaUrl || !isHttpUrl(mediaUrl)) return { ok: false, error: "Envie o arquivo ou informe um link público (https) da mídia." };
  }
  if (coverUrl && !isHttpUrl(coverUrl)) return { ok: false, error: "O link da capa precisa ser público (https)." };

  const publishNow = body.publishNow === true || body.when === "now";
  let scheduledAt: Date | null | undefined;
  if (body.scheduledAt === null || body.when === "draft") scheduledAt = null;
  else if (body.scheduledAt !== undefined) {
    const date = new Date(String(body.scheduledAt));
    if (Number.isNaN(date.getTime())) return { ok: false, error: "Data e hora do agendamento inválidas." };
    if (date.getTime() > Date.now() + 75 * 86400_000) return { ok: false, error: "Agende no máximo 75 dias para frente." };
    scheduledAt = date.getTime() < Date.now() - 60_000 && !publishNow ? new Date() : date;
  }

  const linkUrl = optionalString(body.linkUrl);
  if (linkUrl && !isHttpUrl(linkUrl)) return { ok: false, error: "O link do produto precisa comecar com https://" };

  const music = parseMusic(body.musica);
  if (music === "invalid") return { ok: false, error: MUSIC_INVALID };
  if (music && publishType && !isReelType(publishType)) return { ok: false, error: "Música do Instagram só vale para Reel." };

  const redes = parseRedes(body.redes);
  if (redes === "invalid") return { ok: false, error: REDES_INVALIDAS };
  if (redes && publishType && !redesCompativeis(publishType, redesExtras(redes.redes))) return { ok: false, error: REDES_SO_REEL };
  if (body.youtubePrivacidade !== undefined && !isYoutubePrivacidade(body.youtubePrivacidade)) return { ok: false, error: YOUTUBE_PRIVACIDADE_INVALIDA };
  const youtubeTitulo = body.youtubeTitulo === null ? null : optionalText(body.youtubeTitulo, 100)?.trim();

  const destino = parseDestino(body);
  if (destino && "erro" in destino) return { ok: false, error: destino.erro };

  const keyword = optionalText(body.keyword, 120);
  const dmText = optionalText(body.dmText, 1000);
  if (keyword && !dmText && !linkUrl) return { ok: false, error: "Com palavra-chave, preencha a mensagem da DM ou o link." };

  // Sequência de DM (0012): automationOptions.sequencia = { mensagem2, mensagem3, linkUrl, linkLabel, linkAposSegundos,
  // lembrete, lembreteHoras } (docs/MOLDE_V132_PAGINA.md). Formato errado → 400 com a frase.
  const rawOptions = body.automationOptions && typeof body.automationOptions === "object" ? (body.automationOptions as Record<string, unknown>) : null;
  const sequencia = parseSequencia(rawOptions?.sequencia);
  if (sequencia && "erro" in sequencia) return { ok: false, error: sequencia.erro };
  if (sequencia && !keyword && !partial) return { ok: false, error: "A sequência de DM precisa da palavra-chave (a 1ª mensagem é a resposta a quem comenta a palavra)." };

  const value: PostPackage = {
    accountId: optionalString(body.accountId) ?? null,
    publishType: (publishType ?? undefined) as ContentPublishType,
    title: optionalText(body.title, 200),
    caption,
    mediaUrl: publishType === "carousel" ? undefined : mediaUrl,
    coverUrl,
    mediaItems: publishType === "carousel" ? mediaItems : publishType ? [] : undefined,
    // só chaves de mídia criadas pelo próprio UaiFlow (pasta uaiflow/): ninguém apaga outro arquivo do bucket por aqui,
    // nem as cópias de segurança do Molde nem as prévias de aprovação (essas têm a limpeza própria)
    mediaKeys: Array.isArray(body.mediaKeys) ? body.mediaKeys.filter(isMediaKey).slice(0, 12) : undefined,
    scheduledAt,
    firstComment: optionalText(body.firstComment, 2200),
    keyword,
    dmText,
    linkUrl,
    linkLabel: optionalText(body.linkLabel, 20),
    publicReply: optionalText(body.publicReply, 300),
    automationOptions: withSequencia(parseAutomationOptions(body.automationOptions), sequencia),
    // "feito com IA": só vale boolean de verdade; qualquer outro tipo é ignorado
    aiGenerated: typeof body.aiGenerated === "boolean" ? body.aiGenerated : undefined,
    // música do Instagram: objeto = escolhe (ou troca); null = tira; ausente = não mexe
    music,
    // redes (0010): lista = troca; ausente = não mexe (post novo: só Instagram)
    redes: redes ? redes.redes : undefined,
    youtubePrivacidade: isYoutubePrivacidade(body.youtubePrivacidade) ? body.youtubePrivacidade : undefined,
    youtubeTitulo: youtubeTitulo === "" ? null : youtubeTitulo,
    // destino (0011): objeto/campos = troca; null = tira; ausente = não mexe
    destinoTipo: destino ? destino.tipo : undefined,
    destinoLink: destino ? destino.link : undefined,
    source: optionalString(body.source)?.slice(0, 40),
    externalRef: optionalString(body.externalRef)?.slice(0, 200) ?? null,
  };

  if (partial) {
    for (const key of Object.keys(value) as (keyof PostPackage)[]) if (value[key] === undefined) delete value[key];
  }
  return { ok: true, value, publishNow, ...(redes?.instagramIncluido ? { avisos: [REDES_INSTAGRAM_INCLUIDO] } : {}) };
}

export const MUSIC_INVALID = "musica inválida: mande { audioId, titulo, volumeMusica, volumeVideo } (audioId é o id da música do Instagram; volumes de 0 a 100) ou null para tirar.";

/** Reel = Reel ou vídeo no feed (os dois saem como REELS na Meta). Só eles levam música do Instagram. */
export function isReelType(type: ContentPublishType | null | undefined) {
  return type === "reel_video" || type === "feed_video";
}

/**
 * musica: { audioId, titulo?, volumeMusica?, volumeVideo? } | null. Volumes fora de 0–100 são ajustados para a ponta
 * (padrão: música 20, voz/vídeo 100). undefined = campo ausente; null = tirar a música; "invalid" = formato errado.
 */
export function parseMusic(value: unknown): MusicChoice | null | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "invalid";
  const record = value as Record<string, unknown>;
  const rawId = typeof record.audioId === "number" && Number.isSafeInteger(record.audioId) ? String(record.audioId) : record.audioId;
  const audioId = typeof rawId === "string" ? rawId.trim() : "";
  if (!audioId || !/^[A-Za-z0-9_.:-]{1,80}$/.test(audioId)) return "invalid";
  for (const key of ["volumeMusica", "volumeVideo"] as const) {
    const volume = record[key];
    if (volume !== undefined && volume !== null && !(typeof volume === "number" && Number.isFinite(volume))) return "invalid";
  }
  return {
    audioId,
    titulo: typeof record.titulo === "string" && record.titulo.trim() ? record.titulo.trim().slice(0, 200) : null,
    volumeMusica: clampVolume(record.volumeMusica, DEFAULT_MUSIC_VOLUME),
    volumeVideo: clampVolume(record.volumeVideo, DEFAULT_VIDEO_VOLUME),
  };
}

function withSequencia(options: AutomationOptions | undefined, sequencia: ReturnType<typeof parseSequencia>) {
  if (!options || sequencia === undefined || (sequencia && "erro" in sequencia)) return options;
  return sequencia ? { ...options, sequencia } : options; // null = tirar: as opções vão sem a sequência
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

export function isMediaKey(key: unknown): key is string {
  return typeof key === "string" && /^uaiflow\/[\w.\-/]+$/.test(key) && !key.includes("..") && !isProtectedKey(key);
}
