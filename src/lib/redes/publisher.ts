import type { ContentPost } from "@/lib/db/repositories";
import { facebookCanPublish, claimDueRedes, getRedeRow, getThreadsConnection, getYoutubeConnection, saveRede, setYoutubeChannel, threadsAccessToken, updateYoutubeAccessToken, type RedeRow, type YoutubeConnection } from "@/lib/db/redes";
import { getFacebookConnection } from "@/lib/db/facebook-connections";
import { isMetaRateLimit, MetaApiError } from "@/lib/instagram/client";
import { isYoutubePrivacidade, REDE_NOME, redesAceitas, type RedeExtra } from "@/lib/redes/redes";
import { fbPostFallbackLink, fbReelFallbackLink, finishFbReel, getFbPostPermalink, getFbReelPermalink, getFbReelStatus, publishFbPagePhoto, readFbReelStatus, startFbReel, uploadFbReelByUrl } from "@/lib/redes/facebook-reels";
import { createThreadsVideoContainer, getThreadsContainerStatus, getThreadsPermalink, publishThreadsContainer } from "@/lib/redes/threads";
import {
  buildYoutubeVideoResource,
  headMedia,
  queryYoutubeUpload,
  refreshGoogleAccessToken,
  startYoutubeUpload,
  uploadYoutubeChunk,
  youtubeChunkBytes,
  YoutubeApiError,
  youtubeDescription,
  YOUTUBE_MAX_BYTES,
  youtubeShortsLink,
  youtubeTitle,
  type ChunkResult,
} from "@/lib/redes/youtube";

/**
 * Publica nas redes extras (Facebook/Página, Threads, YouTube) os posts cujo Instagram já terminou. Roda dentro do
 * relógio (/api/queue/drain), depois do Instagram, com o tempo que sobrar. Cada rede é uma máquina de passos curta
 * (o estado fica em content_post_redes): um erro numa rede nunca mexe no Instagram nem nas outras redes.
 * Erro: tenta de novo até 3 vezes (5 e 10 min depois; limite de uso da Meta: 30 min); depois fica "Com erro" e a
 * pessoa pode tocar em «Tentar de novo» daquela rede.
 */
export const REDE_MAX_TENTATIVAS = 3;
/** Uma rede que não termina de processar em 6 h desiste. */
const REDE_MAX_HORAS = 6;

export const PUBLISHED_WITHOUT_LINK = "Publicado; não consegui buscar o link";

export type RedesCycleResult = { publicadas: number; falhas: number; andando: number; stoppedEarly: boolean };

/** Erro que não adianta repetir (falta conexão, post sem vídeo...): a rede fica "Com erro" na hora. */
export class RedeFatalError extends Error {}

type Outcome = "published" | "failed" | "waiting";

export async function runRedesCycle(deadline: number): Promise<RedesCycleResult> {
  const out: RedesCycleResult = { publicadas: 0, falhas: 0, andando: 0, stoppedEarly: false };
  const timeLeft = () => deadline - Date.now();
  if (timeLeft() < 2500) return { ...out, stoppedEarly: true };
  const rows = await claimDueRedes(4);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (timeLeft() < 2000) {
      out.stoppedEarly = true;
      for (const rest of rows.slice(index)) await saveRede(rest.post_id, rest.rede, {}).catch(() => undefined); // solta a trava
      break;
    }
    const result = await advanceRede(row, row.post, deadline);
    if (result === "published") out.publicadas += 1;
    else if (result === "failed") out.falhas += 1;
    else out.andando += 1;
  }
  return out;
}

/** Avança uma rede de um post (a linha já vem travada). Nunca joga erro para fora. */
export async function advanceRede(row: RedeRow, post: ContentPost, deadline: number): Promise<Outcome> {
  try {
    if (!redesAceitas(post.publish_type).includes(row.rede)) {
      throw new RedeFatalError(row.rede === "facebook" ? "A Página do Facebook recebe Reel ou foto do feed." : `${REDE_NOME[row.rede]} só recebe Reel (vídeo).`);
    }
    if (post.media_deleted_at || !/^https?:\/\//i.test(post.media_url || "")) throw new RedeFatalError("A mídia do post não está mais no armazenamento. Envie a mídia de novo.");
    const startedAt = typeof row.estado?.inicio === "string" ? new Date(row.estado.inicio).getTime() : Number.NaN;
    if (Number.isFinite(startedAt) && Date.now() - startedAt > REDE_MAX_HORAS * 3600_000) {
      throw new RedeFatalError(`${REDE_NOME[row.rede]} não terminou de processar em ${REDE_MAX_HORAS} h. Toque em «Tentar de novo».`);
    }
    if (row.rede === "facebook") return post.publish_type === "feed_image" ? await advanceFacebookPhoto(row, post) : await advanceFacebook(row, post);
    if (row.rede === "threads") return await advanceThreads(row, post);
    return await advanceYoutube(row, post, deadline);
  } catch (error) {
    return handleRedeError(row, error);
  }
}

async function handleRedeError(row: RedeRow, error: unknown): Promise<Outcome> {
  const message = safeRedeError(row.rede, error);
  const attempts = (row.attempts ?? 0) + 1;
  if (error instanceof RedeFatalError || attempts >= REDE_MAX_TENTATIVAS) {
    await saveRede(row.post_id, row.rede, { status: "failed", last_error: message, attempts });
    return "failed";
  }
  const waitMs = isMetaRateLimit(error) ? 30 * 60_000 : 5 * 60_000 * attempts;
  // Relê a linha: o passo pode ter andado nesta rodada (container criado, pedaços enviados) antes do erro.
  const fresh = (await getRedeRow(row.post_id, row.rede).catch(() => null)) ?? row;
  // a sessão do YouTube venceu: começa o envio de novo; outro erro no meio do envio: pergunta à sessão antes de seguir
  const estado = { ...(fresh.estado ?? {}) };
  let etapa = fresh.etapa;
  if (error instanceof YoutubeApiError && error.codigo === "sessao_vencida") {
    etapa = null;
    delete estado.uploadUrl;
    delete estado.offset;
  } else if (row.rede === "youtube" && etapa === "uploading") estado.conferir = true;
  await saveRede(row.post_id, row.rede, {
    status: etapa ? "processing" : "pending",
    etapa,
    estado,
    last_error: `${message} Nova tentativa em ${Math.round(waitMs / 60_000)} min.`,
    attempts,
    nextAttemptInMs: waitMs,
  });
  return "waiting";
}

/** Erro sem nenhum pedaço de token, com o nome da rede na frente. */
export function safeRedeError(rede: RedeExtra, error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "Erro desconhecido.");
  const clean = raw
    .replace(/(access_token|client_secret|refresh_token|code)=[^&\s]+/gi, "$1=***")
    .replace(/\b(EAA|IG|TH)[A-Za-z0-9_-]{20,}/g, "***")
    .replace(/\bya29\.[A-Za-z0-9_.-]+/g, "***")
    .replace(/^Instagram Graph v\d+\.\d+:\s*/i, "")
    .replace(/^Google:\s*/i, "")
    .slice(0, 300);
  if (error instanceof RedeFatalError) return clean;
  return `${REDE_NOME[rede]}: ${clean}`;
}

function inicio(row: RedeRow) {
  return typeof row.estado?.inicio === "string" ? row.estado.inicio : new Date().toISOString();
}

async function waitRede(row: RedeRow, estado: Record<string, unknown>, etapa: string, note: string, waitMs: number): Promise<Outcome> {
  await saveRede(row.post_id, row.rede, { status: "processing", etapa, estado, last_error: note, nextAttemptInMs: waitMs });
  return "waiting";
}

async function publishedRede(row: RedeRow, externalId: string | null, permalink: string | null): Promise<Outcome> {
  await saveRede(row.post_id, row.rede, {
    status: "published",
    etapa: "publicado",
    external_id: externalId,
    permalink,
    last_error: externalId || permalink ? null : PUBLISHED_WITHOUT_LINK,
    published_at: new Date().toISOString(),
  });
  return "published";
}

/* ---------------- Facebook (Página) ---------------- */

async function advanceFacebook(row: RedeRow, post: ContentPost): Promise<Outcome> {
  const connection = await getFacebookConnection(post.account_id);
  if (!connection || !facebookCanPublish(connection) || !connection.page_access_token) {
    throw new RedeFatalError("Para publicar na Página do Facebook, conecte (ou reconecte) esta conta pelo Facebook em Perfis.");
  }
  const pageToken = connection.page_access_token;
  const estado: Record<string, unknown> = { ...(row.estado ?? {}), inicio: inicio(row) };
  let videoId = typeof estado.videoId === "string" ? estado.videoId : null;

  if (!row.etapa || row.etapa === "started" || !videoId) {
    if (!videoId) {
      videoId = (await startFbReel(connection.page_id, pageToken)).video_id;
      estado.videoId = videoId;
      await saveRede(row.post_id, row.rede, { status: "processing", etapa: "started", estado, keepLock: true });
    }
    await uploadFbReelByUrl(videoId, pageToken, post.media_url);
    return waitRede(row, estado, "uploaded", "O Facebook está recebendo o vídeo.", 20_000);
  }

  const status = readFbReelStatus((await getFbReelStatus(videoId, pageToken)).status);
  if (status.state === "error") throw new RedeFatalError(`Facebook: ${status.motivo}`);
  if (status.state === "published" && row.etapa === "finish_requested") return finishedFacebook(row, videoId, pageToken);
  if (row.etapa === "finish_requested" || status.state === "uploaded" || status.state === "published") {
    // o mesmo video_id só sai uma vez: pedir de novo depois de um corte não publica em dobro
    estado.finishAt = new Date().toISOString();
    await saveRede(row.post_id, row.rede, { status: "processing", etapa: "finish_requested", estado, keepLock: true });
    await finishFbReel(connection.page_id, pageToken, { videoId, description: post.caption, title: post.title });
    return finishedFacebook(row, videoId, pageToken);
  }
  return waitRede(row, estado, "uploaded", "O Facebook está processando o vídeo.", 30_000);
}

async function finishedFacebook(row: RedeRow, videoId: string, pageToken: string) {
  const permalink = await getFbReelPermalink(videoId, pageToken).catch(() => null);
  return publishedRede(row, videoId, permalink ?? fbReelFallbackLink(videoId));
}

/**
 * Foto do feed na Página: um pedido só. Grava "photo_requested" antes de chamar; se a Meta responder com erro, volta
 * ao início (não saiu). Se a função cair no meio (sem resposta), a próxima rodada não repete às cegas: fica "Com erro"
 * pedindo para conferir a Página (assim a foto nunca sai duas vezes).
 */
async function advanceFacebookPhoto(row: RedeRow, post: ContentPost): Promise<Outcome> {
  const connection = await getFacebookConnection(post.account_id);
  if (!connection || !facebookCanPublish(connection) || !connection.page_access_token) {
    throw new RedeFatalError("Para publicar na Página do Facebook, conecte (ou reconecte) esta conta pelo Facebook em Perfis.");
  }
  if (row.etapa === "photo_requested") {
    throw new RedeFatalError("A rodada anterior caiu no meio do envio da foto. Confira na Página se ela saiu; se não saiu, toque em «Tentar de novo».");
  }
  const pageToken = connection.page_access_token;
  const estado: Record<string, unknown> = { ...(row.estado ?? {}), inicio: inicio(row) };
  await saveRede(row.post_id, row.rede, { status: "processing", etapa: "photo_requested", estado, keepLock: true });
  let result: { id: string; post_id?: string };
  try {
    result = await publishFbPagePhoto(connection.page_id, pageToken, { url: post.media_url, caption: post.caption });
  } catch (error) {
    // A Meta respondeu com erro (não publicou): volta ao início. Sem resposta (tempo esgotado): fica como pedido.
    if (error instanceof MetaApiError && error.kind !== "timeout") await saveRede(row.post_id, row.rede, { etapa: null, keepLock: true });
    throw error;
  }
  const postId = result.post_id || result.id;
  const permalink = await getFbPostPermalink(postId, pageToken).catch(() => null);
  return publishedRede(row, postId, permalink ?? fbPostFallbackLink(postId));
}

/* ---------------- Threads ---------------- */

async function advanceThreads(row: RedeRow, post: ContentPost): Promise<Outcome> {
  const connection = await getThreadsConnection(post.account_id);
  if (!connection) throw new RedeFatalError("Para publicar no Threads, conecte o Threads desta conta em Perfis.");
  const accessToken = threadsAccessToken(connection);
  if (!accessToken) throw new RedeFatalError("A conexão do Threads venceu. Reconecte o Threads em Perfis.");
  const estado: Record<string, unknown> = { ...(row.estado ?? {}), inicio: inicio(row) };
  const containerId = typeof estado.containerId === "string" ? estado.containerId : null;

  if (!containerId) {
    const container = await createThreadsVideoContainer({ threadsUserId: connection.threads_user_id, accessToken, videoUrl: post.media_url, text: post.caption });
    estado.containerId = container.id;
    // a Meta pede ~30 s antes de publicar um vídeo
    return waitRede(row, estado, "container", "O Threads está processando o vídeo.", 30_000);
  }

  const status = await getThreadsContainerStatus(containerId, accessToken);
  if (status.status === "PUBLISHED") return publishedRede(row, null, null); // já saiu (rodada anterior cortada)
  if (status.status === "ERROR" || status.status === "EXPIRED") {
    throw new RedeFatalError(`Threads: ${status.error_message || (status.status === "EXPIRED" ? "o container venceu (24 h)." : "não conseguiu processar o vídeo.")}`);
  }
  if (status.status !== "FINISHED") return waitRede(row, estado, "container", "O Threads está processando o vídeo.", 60_000);

  // Grava o pedido antes de chamar: se a função cair no meio, a próxima rodada vê PUBLISHED em vez de repetir.
  await saveRede(row.post_id, row.rede, { status: "processing", etapa: "publish_requested", estado, keepLock: true });
  const published = await publishThreadsContainer({ threadsUserId: connection.threads_user_id, accessToken, containerId });
  const permalink = await getThreadsPermalink(published.id, accessToken).catch(() => null);
  return publishedRede(row, published.id, permalink);
}

/* ---------------- YouTube ---------------- */

/** Token de acesso do Google válido (renova pelo refresh token quando faltam menos de 2 min). */
export async function youtubeAccessToken(connection: YoutubeConnection) {
  const expires = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (connection.access_token && expires - Date.now() > 2 * 60_000) return connection.access_token;
  try {
    const token = await refreshGoogleAccessToken(connection.refresh_token);
    await updateYoutubeAccessToken({
      accountId: connection.account_id,
      accessToken: token.access_token,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      refreshToken: token.refresh_token ?? null,
    });
    return token.access_token;
  } catch (error) {
    if (error instanceof YoutubeApiError && (error.codigo === "invalid_grant" || error.status === 400 || error.status === 401)) {
      throw new RedeFatalError("A conexão do YouTube venceu ou foi retirada. Reconecte o YouTube em Perfis.");
    }
    throw error;
  }
}

async function advanceYoutube(row: RedeRow, post: ContentPost, deadline: number): Promise<Outcome> {
  const connection = await getYoutubeConnection(post.account_id);
  if (!connection) throw new RedeFatalError("Para publicar no YouTube, conecte o YouTube desta conta em Perfis.");
  const estado: Record<string, unknown> = { ...(row.estado ?? {}), inicio: inicio(row) };

  if (row.etapa !== "uploading" || typeof estado.uploadUrl !== "string") {
    const accessToken = await youtubeAccessToken(connection);
    const media = await headMedia(post.media_url);
    if (media.size > YOUTUBE_MAX_BYTES) throw new RedeFatalError(`O vídeo passa de ${Math.round(YOUTUBE_MAX_BYTES / 1024 / 1024)} MB, o limite do envio ao YouTube pelo UaiFlow.`);
    const privacy = isYoutubePrivacidade(post.youtube_privacidade) ? post.youtube_privacidade : "public";
    const resource = buildYoutubeVideoResource({ title: youtubeTitle({ youtubeTitulo: post.youtube_titulo, title: post.title, caption: post.caption }), description: youtubeDescription(post.caption), privacy });
    estado.uploadUrl = await startYoutubeUpload({ accessToken, size: media.size, contentType: media.contentType, resource });
    estado.total = media.size;
    estado.offset = 0;
    delete estado.conferir;
    await saveRede(row.post_id, row.rede, { status: "processing", etapa: "uploading", estado, last_error: "Enviando o vídeo ao YouTube.", keepLock: true });
  }

  const uploadUrl = estado.uploadUrl as string;
  const total = Number(estado.total);
  const chunkBytes = youtubeChunkBytes();
  let result: ChunkResult | null = null;
  // Um pedaço por vez enquanto couber no tempo do relógio; o resto fica para o próximo minuto.
  while (deadline - Date.now() > 3500) {
    if (estado.conferir) {
      result = await queryYoutubeUpload(uploadUrl, total);
      delete estado.conferir;
    } else {
      result = await uploadYoutubeChunk({ uploadUrl, mediaUrl: post.media_url, offset: Number(estado.offset) || 0, total, chunkBytes, timeoutMs: Math.min(20_000, deadline - Date.now() - 1000) });
    }
    if (result.done) break;
    estado.offset = result.offset;
    await saveRede(row.post_id, row.rede, { estado, keepLock: true });
  }
  if (result?.done) {
    await setYoutubeChannel(connection.account_id, result.video.snippet?.channelId ?? null).catch(() => undefined);
    return publishedRede(row, result.video.id, youtubeShortsLink(result.video.id));
  }
  const percent = total ? Math.floor(((Number(estado.offset) || 0) / total) * 100) : 0;
  return waitRede(row, estado, "uploading", `Enviando o vídeo ao YouTube (${percent}%).`, 0);
}
