import { FACEBOOK_GRAPH_BASE_URL, FB_RUPLOAD_BASE_URL } from "@/lib/env";
import { graphFetch, metaFetch, readGraphResponse } from "@/lib/instagram/client";

/**
 * Reel na Página do Facebook (Video API, "Reels Publishing"): começar (upload_phase=start) → mandar o vídeo pelo link
 * (rupload.facebook.com, cabeçalho file_url: a Meta baixa o arquivo do R2) → conferir o status → terminar
 * (upload_phase=finish, video_state=PUBLISHED, description). Usa o token da Página da conexão pelo Facebook.
 * Permissões: pages_show_list, pages_read_engagement, pages_manage_posts.
 */

/** Limite de texto da descrição (a Meta não documenta um teto para Reels; 2.200 = o mesmo da legenda do Instagram). */
const MAX_DESCRIPTION = 2200;

export function buildFbReelStartBody() {
  return { upload_phase: "start" };
}

export function buildFbReelUploadHeaders(pageToken: string, fileUrl: string) {
  return { Authorization: `OAuth ${pageToken}`, file_url: fileUrl };
}

export function buildFbReelFinishBody(input: { videoId: string; description?: string | null; title?: string | null }) {
  const body: Record<string, string> = {
    upload_phase: "finish",
    video_id: input.videoId,
    video_state: "PUBLISHED",
  };
  const description = (input.description ?? "").trim().slice(0, MAX_DESCRIPTION);
  if (description) body.description = description;
  const title = (input.title ?? "").trim().slice(0, 255);
  if (title) body.title = title;
  return body;
}

export async function startFbReel(pageId: string, pageToken: string) {
  return graphFetch<{ video_id: string; upload_url?: string }>(new URL(`${FACEBOOK_GRAPH_BASE_URL}/${pageId}/video_reels`), pageToken, {
    method: "POST",
    body: JSON.stringify(buildFbReelStartBody()),
  });
}

export async function uploadFbReelByUrl(videoId: string, pageToken: string, fileUrl: string) {
  const response = await metaFetch(`${FB_RUPLOAD_BASE_URL}/${videoId}`, { method: "POST", headers: buildFbReelUploadHeaders(pageToken, fileUrl) });
  return readGraphResponse<{ success?: boolean }>(response);
}

export type FbVideoStatus = {
  video_status?: string;
  uploading_phase?: { status?: string; bytes_transferred?: number };
  processing_phase?: { status?: string; errors?: Array<{ code?: number; message?: string }> };
  publishing_phase?: { status?: string; publish_status?: string };
};

export async function getFbReelStatus(videoId: string, pageToken: string) {
  const url = new URL(`${FACEBOOK_GRAPH_BASE_URL}/${videoId}`);
  url.searchParams.set("fields", "status");
  return graphFetch<{ id?: string; status?: FbVideoStatus }>(url, pageToken);
}

export async function finishFbReel(pageId: string, pageToken: string, input: { videoId: string; description?: string | null; title?: string | null }) {
  return graphFetch<{ success?: boolean }>(new URL(`${FACEBOOK_GRAPH_BASE_URL}/${pageId}/video_reels`), pageToken, {
    method: "POST",
    body: JSON.stringify(buildFbReelFinishBody(input)),
  });
}

export async function getFbReelPermalink(videoId: string, pageToken: string) {
  const url = new URL(`${FACEBOOK_GRAPH_BASE_URL}/${videoId}`);
  url.searchParams.set("fields", "permalink_url");
  const result = await graphFetch<{ permalink_url?: string }>(url, pageToken);
  const link = result.permalink_url ?? "";
  if (!link) return null;
  return link.startsWith("http") ? link : `https://www.facebook.com${link.startsWith("/") ? "" : "/"}${link}`;
}

/** Link de reserva quando a Meta não devolve o permalink_url. */
export function fbReelFallbackLink(videoId: string) {
  return `https://www.facebook.com/reel/${videoId}`;
}

/** Leitura simples do status: "error" (com o motivo), "uploaded" (pode terminar), "published" ou "waiting". */
export function readFbReelStatus(status: FbVideoStatus | undefined): { state: "error" | "uploaded" | "published" | "waiting"; motivo?: string } {
  if (!status) return { state: "waiting" };
  const processingError = status.processing_phase?.status === "error" || status.video_status === "error";
  if (processingError) {
    const motivo = status.processing_phase?.errors?.map((item) => item.message).filter(Boolean).join("; ");
    return { state: "error", motivo: motivo || "A Meta não conseguiu processar o vídeo." };
  }
  const publish = status.publishing_phase?.status;
  if (publish === "complete" || status.publishing_phase?.publish_status === "published") return { state: "published" };
  if (status.uploading_phase?.status === "complete" || status.video_status === "ready" || status.video_status === "upload_complete") return { state: "uploaded" };
  return { state: "waiting" };
}

/* ---------------- Foto na Página (imagem estática) ---------------- */

/**
 * Foto do feed na Página do Facebook (Pages API: POST /{page-id}/photos com url + caption, published=true). A Meta
 * baixa a imagem do R2. Mesmo token e permissões do Reel da Página (pages_manage_posts).
 */
export function buildFbPhotoBody(input: { url: string; caption?: string | null }) {
  const body: Record<string, string | boolean> = { url: input.url, published: true };
  const caption = (input.caption ?? "").trim().slice(0, MAX_DESCRIPTION);
  if (caption) body.caption = caption;
  return body;
}

export async function publishFbPagePhoto(pageId: string, pageToken: string, input: { url: string; caption?: string | null }) {
  return graphFetch<{ id: string; post_id?: string }>(new URL(`${FACEBOOK_GRAPH_BASE_URL}/${pageId}/photos`), pageToken, {
    method: "POST",
    body: JSON.stringify(buildFbPhotoBody(input)),
  });
}

export async function getFbPostPermalink(postId: string, pageToken: string) {
  const url = new URL(`${FACEBOOK_GRAPH_BASE_URL}/${postId}`);
  url.searchParams.set("fields", "permalink_url");
  const result = await graphFetch<{ permalink_url?: string }>(url, pageToken);
  const link = result.permalink_url ?? "";
  if (!link) return null;
  return link.startsWith("http") ? link : `https://www.facebook.com${link.startsWith("/") ? "" : "/"}${link}`;
}

/** Link de reserva da foto/post quando a Meta não devolve o permalink_url. */
export function fbPostFallbackLink(postId: string) {
  return `https://www.facebook.com/${postId}`;
}
