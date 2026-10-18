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
