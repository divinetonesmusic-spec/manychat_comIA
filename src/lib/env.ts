export const META_API_VERSION = process.env.META_API_VERSION || "v25.0";
export const GRAPH_BASE_URL = `https://graph.instagram.com/${META_API_VERSION}`;
export const IG_OAUTH_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const IG_OAUTH_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
/**
 * "Instagram API with Facebook Login" (graph.facebook.com): só ela tem a Audio API (música do Instagram nos Reels).
 * O resto do UaiFlow usa o "Instagram API with Instagram Login" (graph.instagram.com, acima).
 */
export const FACEBOOK_GRAPH_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;
export const FB_OAUTH_AUTHORIZE_URL = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth`;
/** Upload de vídeo do Facebook (Reels da Página): o arquivo vai por aqui, não pelo graph.facebook.com. */
export const FB_RUPLOAD_BASE_URL = `https://rupload.facebook.com/video-upload/${META_API_VERSION}`;

/** Threads API (app próprio do Threads: THREADS_APP_ID / THREADS_APP_SECRET). */
export const THREADS_GRAPH_BASE_URL = "https://graph.threads.net/v1.0";
export const THREADS_TOKEN_BASE_URL = "https://graph.threads.net";
export const THREADS_OAUTH_AUTHORIZE_URL = "https://threads.net/oauth/authorize";

/** Google OAuth e YouTube Data API v3 (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). */
export const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }

  return value;
}

export function getAppBaseUrl(requestUrl?: string): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  }

  if (requestUrl) {
    const url = new URL(requestUrl);
    return url.origin;
  }

  return "http://127.0.0.1:3000";
}
