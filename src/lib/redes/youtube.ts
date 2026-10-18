import { GOOGLE_OAUTH_AUTHORIZE_URL, GOOGLE_OAUTH_TOKEN_URL, requireEnv, YOUTUBE_UPLOAD_URL } from "@/lib/env";
import type { YoutubePrivacidade } from "@/lib/redes/redes";

/**
 * YouTube Shorts pela YouTube Data API v3 (OAuth do Google: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
 * Conexão: escopo youtube.upload, access_type=offline (refresh token guardado no banco, como os outros tokens).
 * Envio "resumable": abre a sessão (POST ...?uploadType=resumable) e manda o vídeo em pedaços (PUT com Content-Range),
 * um pedaço por vez, lendo do R2 por Range. Cada minuto do relógio manda o que couber no tempo (as funções do Netlify
 * têm poucos segundos); a sessão guarda o que já chegou e a próxima rodada continua de onde parou.
 */
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

/** O Google exige pedaços múltiplos de 256 KiB (menos o último). */
export const YOUTUBE_CHUNK_UNIT = 256 * 1024;
/** Maior vídeo aceito aqui (um Short tem até 3 min; acima disso o envio levaria muitos minutos). */
export const YOUTUBE_MAX_BYTES = 512 * 1024 * 1024;

const TIMEOUT_MS = 8000;

export class YoutubeApiError extends Error {
  constructor(message: string, public status: number | null, public temporary: boolean, public codigo: string = "youtube") {
    super(message);
    this.name = "YoutubeApiError";
  }
}

export function youtubeChunkBytes() {
  const mb = Number(String(process.env.YOUTUBE_CHUNK_MB || "8").replace(",", "."));
  const bytes = Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : 8 * 1024 * 1024;
  return Math.max(YOUTUBE_CHUNK_UNIT, Math.floor(bytes / YOUTUBE_CHUNK_UNIT) * YOUTUBE_CHUNK_UNIT);
}

export function youtubeRedirectUri(appBaseUrl: string) {
  return process.env.GOOGLE_REDIRECT_URI || `${appBaseUrl}/api/oauth/youtube/callback`;
}

export function youtubeAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }) {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline"); // devolve o refresh token
  url.searchParams.set("prompt", "consent"); // sempre devolve um refresh token novo, mesmo em reconexão
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  return url;
}

async function timedFetch(input: string | URL, init: RequestInit = {}, timeoutMs = TIMEOUT_MS) {
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new YoutubeApiError(`O Google não respondeu em ${Math.round(timeoutMs / 1000)} s.`, null, true, "timeout");
    throw new YoutubeApiError(`Sem conexão com o Google (${error instanceof Error ? error.message.slice(0, 120) : "erro de rede"}).`, null, true, "rede");
  }
}

async function readGoogleJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: unknown; error_description?: string };
  if (!response.ok || payload.error) {
    const error = payload.error as { message?: string; errors?: Array<{ reason?: string }> } | string | undefined;
    const message = typeof error === "string" ? `${error}${payload.error_description ? `: ${payload.error_description}` : ""}` : error?.message || `${response.status} ${response.statusText}`;
    const reason = typeof error === "object" ? error?.errors?.[0]?.reason : undefined;
    throw new YoutubeApiError(`Google: ${message}`.slice(0, 400), response.status, response.status === 429 || response.status >= 500, reason || (typeof error === "string" ? error : "youtube"));
  }
  return payload;
}

type GoogleToken = { access_token: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string };

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  return readGoogleJson<GoogleToken>(
    await timedFetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: requireEnv("GOOGLE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    }),
  );
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  return readGoogleJson<GoogleToken>(
    await timedFetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: requireEnv("GOOGLE_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        grant_type: "refresh_token",
      }),
    }),
  );
}

/** O YouTube recusa "<" e ">" no título e na descrição. */
function cleanText(value: string) {
  return value.replace(/[<>]/g, "");
}

/** Título: o do post (ou do YouTube), senão a 1ª linha da legenda; até 100 caracteres; nunca vazio. */
export function youtubeTitle(input: { youtubeTitulo?: string | null; title?: string | null; caption?: string | null }) {
  const firstLine = (input.caption ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  const base = cleanText((input.youtubeTitulo || input.title || firstLine || "Short").replace(/\s+/g, " ").trim()) || "Short";
  const chars = Array.from(base);
  return chars.length <= 100 ? base : `${chars.slice(0, 99).join("").trimEnd()}…`;
}

/** Descrição: a legenda com #Shorts no fim (se ainda não tiver), até 5.000 bytes. */
export function youtubeDescription(caption: string | null | undefined) {
  let text = cleanText((caption ?? "").trim());
  const tag = /#shorts\b/i.test(text) ? "" : `${text ? "\n\n" : ""}#Shorts`;
  const limit = 5000 - Buffer.byteLength(tag, "utf8");
  if (Buffer.byteLength(text, "utf8") > limit) {
    let out = "";
    for (const char of Array.from(text)) {
      if (Buffer.byteLength(out + char, "utf8") > limit - 3) break;
      out += char;
    }
    text = `${out.trimEnd()}…`;
  }
  return `${text}${tag}`;
}

export function buildYoutubeVideoResource(input: { title: string; description: string; privacy: YoutubePrivacidade }) {
  return {
    snippet: { title: input.title, description: input.description, categoryId: "22" },
    status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false },
  };
}

/** Tamanho e tipo do vídeo no R2 (HEAD). */
export async function headMedia(mediaUrl: string) {
  const response = await timedFetch(mediaUrl, { method: "HEAD" });
  if (!response.ok) throw new YoutubeApiError(`Não consegui ler o vídeo no armazenamento (${response.status}).`, response.status, response.status >= 500, "midia");
  const size = Number(response.headers.get("content-length"));
  if (!Number.isFinite(size) || size <= 0) throw new YoutubeApiError("O armazenamento não informou o tamanho do vídeo.", null, false, "midia");
  return { size, contentType: (response.headers.get("content-type") || "video/mp4").split(";")[0].trim() || "video/mp4" };
}

/** Abre a sessão de envio. Devolve o endereço da sessão (Location). */
export async function startYoutubeUpload(input: { accessToken: string; size: number; contentType: string; resource: ReturnType<typeof buildYoutubeVideoResource> }) {
  const url = new URL(YOUTUBE_UPLOAD_URL);
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("part", "snippet,status");
  const response = await timedFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(input.size),
      "X-Upload-Content-Type": input.contentType.startsWith("video/") ? input.contentType : "video/mp4",
    },
    body: JSON.stringify(input.resource),
  });
  if (!response.ok) await readGoogleJson(response);
  const location = response.headers.get("location");
  if (!location) throw new YoutubeApiError("O Google não devolveu o endereço do envio.", response.status, true, "sem_sessao");
  return location;
}

export type YoutubeVideo = { id: string; snippet?: { channelId?: string }; status?: { uploadStatus?: string; privacyStatus?: string } };
export type ChunkResult = { done: true; video: YoutubeVideo } | { done: false; offset: number };

/** Lê a resposta do PUT: 308 = falta (offset = último byte + 1), 200/201 = terminou, 404 = sessão vencida. */
async function readUploadResponse(response: Response): Promise<ChunkResult> {
  if (response.status === 308) {
    const range = response.headers.get("range");
    const match = range?.match(/bytes=\d+-(\d+)/);
    return { done: false, offset: match ? Number(match[1]) + 1 : 0 };
  }
  if (response.status === 200 || response.status === 201) {
    const video = (await response.json().catch(() => ({}))) as YoutubeVideo;
    if (!video?.id) throw new YoutubeApiError("O Google terminou o envio sem devolver o id do vídeo.", response.status, false, "sem_id");
    return { done: true, video };
  }
  if (response.status === 404 || response.status === 410) throw new YoutubeApiError("A sessão de envio do YouTube venceu. Vou começar o envio de novo.", response.status, true, "sessao_vencida");
  await readGoogleJson(response);
  throw new YoutubeApiError(`Envio recusado pelo YouTube (${response.status}).`, response.status, response.status >= 500, "youtube");
}

/** Pergunta à sessão quanto já chegou (PUT vazio com "bytes *\/TOTAL"). */
export async function queryYoutubeUpload(uploadUrl: string, total: number) {
  const response = await timedFetch(uploadUrl, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${total}` } });
  return readUploadResponse(response);
}

/** Lê um pedaço do vídeo no R2 (Range) e manda para a sessão. */
export async function uploadYoutubeChunk(input: { uploadUrl: string; mediaUrl: string; offset: number; total: number; chunkBytes: number; timeoutMs: number }): Promise<ChunkResult> {
  const end = Math.min(input.offset + input.chunkBytes, input.total) - 1;
  const half = Math.max(2000, Math.floor(input.timeoutMs / 2));
  const media = await timedFetch(input.mediaUrl, { headers: { Range: `bytes=${input.offset}-${end}` } }, half);
  if (media.status !== 206 && media.status !== 200) throw new YoutubeApiError(`Não consegui ler o vídeo no armazenamento (${media.status}).`, media.status, media.status >= 500, "midia");
  let bytes = new Uint8Array(await media.arrayBuffer());
  if (media.status === 200 && bytes.length > end - input.offset + 1) bytes = bytes.slice(input.offset, end + 1); // o armazenamento ignorou o Range
  if (bytes.length !== end - input.offset + 1) throw new YoutubeApiError("O pedaço do vídeo veio com tamanho errado.", null, true, "midia");
  const response = await timedFetch(input.uploadUrl, {
    method: "PUT",
    headers: { "Content-Length": String(bytes.length), "Content-Range": `bytes ${input.offset}-${end}/${input.total}` },
    body: bytes,
  }, half);
  return readUploadResponse(response);
}

export function youtubeShortsLink(videoId: string) {
  return `https://www.youtube.com/shorts/${videoId}`;
}
