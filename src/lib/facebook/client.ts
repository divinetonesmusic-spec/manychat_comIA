import { FACEBOOK_GRAPH_BASE_URL, requireEnv } from "@/lib/env";
import { graphFetch, metaFetch, readGraphResponse } from "@/lib/instagram/client";

/**
 * "Instagram API with Facebook Login" (graph.facebook.com). O UaiFlow usa esta API só para a música do Instagram:
 * a Audio API da Meta (busca de músicas e audio_configuration no Reel) não existe no Instagram Login.
 * App da Meta: FACEBOOK_APP_ID / FACEBOOK_APP_SECRET (o app com o produto "Login do Facebook").
 */

/**
 * Permissões pedidas no Login do Facebook: as que a Audio API e a lista de Páginas pedem e, desde a 0010,
 * pages_manage_posts (publicar o mesmo Reel na Página do Facebook; a Meta pede também pages_show_list e pages_read_engagement).
 */
export const FACEBOOK_SCOPES = ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "pages_manage_posts"];

type FacebookToken = { access_token: string; token_type?: string; expires_in?: number };

/** Troca o código da volta do Login do Facebook pelo token curto e depois pelo token de longa duração (60 dias). */
export async function exchangeFacebookCode(code: string, redirectUri: string) {
  const shortUrl = new URL(`${FACEBOOK_GRAPH_BASE_URL}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  shortUrl.searchParams.set("client_secret", requireEnv("FACEBOOK_APP_SECRET"));
  shortUrl.searchParams.set("redirect_uri", redirectUri);
  shortUrl.searchParams.set("code", code);
  const short = await readGraphResponse<FacebookToken>(await metaFetch(shortUrl));
  return exchangeForLongLivedUserToken(short.access_token);
}

/**
 * Token da pessoa → token de longa duração (60 dias). Vale também para renovar um token de longa duração ainda válido
 * (o relógio de tokens faz isso uma vez por dia).
 */
export async function exchangeForLongLivedUserToken(userToken: string) {
  const url = new URL(`${FACEBOOK_GRAPH_BASE_URL}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  url.searchParams.set("client_secret", requireEnv("FACEBOOK_APP_SECRET"));
  url.searchParams.set("fb_exchange_token", userToken);
  return readGraphResponse<FacebookToken>(await metaFetch(url));
}

export async function getFacebookUser(userToken: string) {
  const url = new URL(`${FACEBOOK_GRAPH_BASE_URL}/me`);
  url.searchParams.set("fields", "id,name");
  return graphFetch<{ id: string; name?: string }>(url, userToken);
}

/** Permissões que a pessoa realmente concedeu (ela pode desmarcar alguma no Login do Facebook). */
export async function getGrantedFacebookScopes(userToken: string): Promise<string[]> {
  const url = new URL(`${FACEBOOK_GRAPH_BASE_URL}/me/permissions`);
  const result = await graphFetch<{ data?: Array<{ permission?: string; status?: string }> }>(url, userToken);
  return (result.data ?? []).filter((item) => item.status === "granted" && item.permission).map((item) => item.permission as string);
}

export type FacebookPage = {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string };
};

/** Páginas que a pessoa autorizou, com o token de cada uma e a conta do Instagram ligada (instagram_business_account). */
export async function listFacebookPages(userToken: string): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = [];
  let next: URL | null = new URL(`${FACEBOOK_GRAPH_BASE_URL}/me/accounts`);
  next.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
  next.searchParams.set("limit", "100");
  for (let page = 0; next && page < 5; page += 1) {
    const result: { data?: FacebookPage[]; paging?: { next?: string } } = await graphFetch(next, userToken);
    pages.push(...(result.data ?? []));
    next = result.paging?.next ? new URL(result.paging.next) : null;
  }
  return pages;
}

/** Token da Página (tirado de um token de longa duração da pessoa, ele não vence). */
export async function getFacebookPageToken(pageId: string, userToken: string) {
  const url = new URL(`${FACEBOOK_GRAPH_BASE_URL}/${pageId}`);
  url.searchParams.set("fields", "access_token");
  return graphFetch<{ id: string; access_token?: string }>(url, userToken);
}

export type AudioType = "music" | "original_sound";

/** Cada música como a Meta devolve em GET /ig_audio (campos opcionais podem faltar ou vir nulos). */
export type RawIgAudio = {
  audio_id?: string | number;
  title?: string | null;
  display_artist?: string | null;
  duration_in_ms?: number | null;
  audio_type?: string | number | null;
  cover_artwork_thumbnail_uri?: string | null;
  cover_artwork_thumbnail_url?: string | null;
  download_url?: string | null;
  on_platform_audio_preview_link?: string | null;
  ig_username?: string | null;
  profile_picture_url?: string | null;
  is_ads_eligible?: boolean | null;
};

/** GET /ig_audio: sem `searchQuery`, a Meta devolve as músicas em alta. */
export async function searchIgAudio(input: { instagramUserId: string; accessToken: string; audioType: AudioType; searchQuery?: string | null }) {
  const url = new URL(`${FACEBOOK_GRAPH_BASE_URL}/ig_audio`);
  url.searchParams.set("audio_type", input.audioType);
  url.searchParams.set("user_id", input.instagramUserId);
  if (input.searchQuery?.trim()) url.searchParams.set("search_query", input.searchQuery.trim());
  return graphFetch<{ audio?: RawIgAudio[] }>(url, input.accessToken);
}
