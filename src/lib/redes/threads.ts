import { requireEnv, THREADS_GRAPH_BASE_URL, THREADS_OAUTH_AUTHORIZE_URL, THREADS_TOKEN_BASE_URL } from "@/lib/env";
import { metaFetch, readGraphResponse } from "@/lib/instagram/client";

/**
 * Threads API (app do Threads: THREADS_APP_ID / THREADS_APP_SECRET).
 * Conexão: threads.net/oauth/authorize (threads_basic, threads_content_publish) → código → token curto (1 h) →
 * token de longa duração (60 dias, th_exchange_token) → renovado pelo relógio de tokens (th_refresh_token).
 * Publicar vídeo: container (media_type=VIDEO, video_url, text) → conferir o status → threads_publish.
 */
export const THREADS_SCOPES = ["threads_basic", "threads_content_publish"];

/** Limite de texto do Threads: 500 caracteres (a Meta conta emoji pelo tamanho em bytes UTF-8). */
export const THREADS_TEXT_LIMIT = 500;

export function threadsRedirectUri(appBaseUrl: string) {
  return process.env.THREADS_REDIRECT_URI || `${appBaseUrl}/api/oauth/threads/callback`;
}

export function threadsAuthorizeUrl(input: { appId: string; redirectUri: string; state: string }) {
  const url = new URL(THREADS_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", THREADS_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  return url;
}

type ThreadsToken = { access_token: string; token_type?: string; expires_in?: number; user_id?: string | number };

/** Código → token curto → token de longa duração (60 dias). */
export async function exchangeThreadsCode(code: string, redirectUri: string) {
  const short = await readGraphResponse<ThreadsToken>(
    await metaFetch(`${THREADS_TOKEN_BASE_URL}/oauth/access_token`, {
      method: "POST",
      body: new URLSearchParams({
        client_id: requireEnv("THREADS_APP_ID"),
        client_secret: requireEnv("THREADS_APP_SECRET"),
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code: code.replace(/#_$/, ""),
      }),
    }),
  );
  const url = new URL(`${THREADS_TOKEN_BASE_URL}/access_token`);
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", requireEnv("THREADS_APP_SECRET"));
  url.searchParams.set("access_token", short.access_token);
  const long = await readGraphResponse<ThreadsToken>(await metaFetch(url));
  return { ...long, user_id: short.user_id !== undefined ? String(short.user_id) : undefined };
}

/** Renova o token de longa duração (precisa ter 24 h ou mais e não ter vencido). Vale 60 dias a partir de agora. */
export async function refreshThreadsToken(accessToken: string) {
  const url = new URL(`${THREADS_TOKEN_BASE_URL}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", accessToken);
  return readGraphResponse<ThreadsToken>(await metaFetch(url));
}

export async function getThreadsProfile(accessToken: string) {
  const url = new URL(`${THREADS_GRAPH_BASE_URL}/me`);
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", accessToken);
  return readGraphResponse<{ id: string; username?: string }>(await metaFetch(url));
}

/** Corta o texto em 500 "caracteres do Threads" (bytes UTF-8 nos emojis), sem quebrar uma letra, com "…" no fim. */
export function threadsText(caption: string | null | undefined) {
  const text = (caption ?? "").trim();
  const size = (value: string) => Array.from(value).reduce((total, char) => total + (char.codePointAt(0)! > 0xffff ? Buffer.byteLength(char, "utf8") : 1), 0);
  if (size(text) <= THREADS_TEXT_LIMIT) return text;
  let out = "";
  for (const char of Array.from(text)) {
    if (size(out + char) > THREADS_TEXT_LIMIT - 1) break;
    out += char;
  }
  return `${out.trimEnd()}…`;
}

export function buildThreadsVideoContainerParams(input: { videoUrl: string; text?: string | null }) {
  const params: Record<string, string> = { media_type: "VIDEO", video_url: input.videoUrl };
  const text = threadsText(input.text);
  if (text) params.text = text;
  return params;
}

export async function createThreadsVideoContainer(input: { threadsUserId: string; accessToken: string; videoUrl: string; text?: string | null }) {
  const url = new URL(`${THREADS_GRAPH_BASE_URL}/${input.threadsUserId}/threads`);
  for (const [key, value] of Object.entries(buildThreadsVideoContainerParams(input))) url.searchParams.set(key, value);
  url.searchParams.set("access_token", input.accessToken);
  return readGraphResponse<{ id: string }>(await metaFetch(url, { method: "POST" }));
}

export async function getThreadsContainerStatus(containerId: string, accessToken: string) {
  const url = new URL(`${THREADS_GRAPH_BASE_URL}/${containerId}`);
  url.searchParams.set("fields", "status,error_message");
  url.searchParams.set("access_token", accessToken);
  return readGraphResponse<{ id?: string; status?: "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED"; error_message?: string }>(await metaFetch(url));
}

export async function publishThreadsContainer(input: { threadsUserId: string; accessToken: string; containerId: string }) {
  const url = new URL(`${THREADS_GRAPH_BASE_URL}/${input.threadsUserId}/threads_publish`);
  url.searchParams.set("creation_id", input.containerId);
  url.searchParams.set("access_token", input.accessToken);
  return readGraphResponse<{ id: string }>(await metaFetch(url, { method: "POST" }));
}

export async function getThreadsPermalink(mediaId: string, accessToken: string) {
  const url = new URL(`${THREADS_GRAPH_BASE_URL}/${mediaId}`);
  url.searchParams.set("fields", "permalink");
  url.searchParams.set("access_token", accessToken);
  return (await readGraphResponse<{ permalink?: string }>(await metaFetch(url))).permalink ?? null;
}
