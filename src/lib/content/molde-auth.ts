import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { ContentPost } from "@/lib/db/repositories";

/**
 * Porta do Molde do Avatar: o robô do Mac fala com o UaiFlow usando um token próprio
 * (MOLDE_API_TOKEN nas variáveis do servidor; o mesmo valor vai na configuração do robô).
 */
export function checkMoldeToken(request: NextRequest): NextResponse | null {
  const expected = process.env.MOLDE_API_TOKEN;
  if (!expected || expected.length < 24) {
    return NextResponse.json(
      { error: "A porta do Molde esta fechada: defina MOLDE_API_TOKEN (24+ caracteres) nas variaveis do servidor.", codigo: "fechado" },
      { status: 503 },
    );
  }
  const provided = request.headers.get("x-molde-token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!provided || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Token do Molde invalido.", codigo: "token_invalido" }, { status: 401 });
  return null;
}

/** O que o Molde vê de cada post (sem tokens nem dados internos). */
export function publicView(post: ContentPost) {
  return {
    id: post.id,
    externalRef: post.external_ref,
    accountId: post.account_id,
    username: post.account_username,
    publishType: post.publish_type,
    title: post.title,
    status: post.status,
    scheduledAt: post.scheduled_at,
    publishedAt: post.published_at,
    permalink: post.permalink,
    lastError: post.last_error,
    /** true = a mídia saiu do armazenamento (publicado há dias, ou rascunho/erro parado há 14 dias): para publicar, mande a mídia de novo. */
    mediaDeleted: Boolean(post.media_deleted_at),
    keyword: post.keyword,
    aiGenerated: Boolean(post.ai_generated),
    /** Música do Instagram do Reel (null = sem música). Precisa da 0009. */
    musica: musicView(post),
    /** Redes do post (0010; sem ela: só ["instagram"]). O Instagram é sempre a principal. */
    redes: redesView(post),
    /** Situação de cada rede: instagram (a mesma do post) e as extras (pending, processing, published, failed). */
    redesStatus: redesStatusView(post),
    youtubePrivacidade: post.youtube_privacidade ?? "public",
    youtubeTitulo: post.youtube_titulo ?? null,
    automationId: post.automation_id,
    firstCommentDone: Boolean(post.first_comment_id),
    insights: post.insights ?? {},
    insightsAt: post.insights_at,
  };
}

/** A música do post no formato que o Molde manda: { audioId, titulo, volumeMusica, volumeVideo } ou null. */
export function musicView(post: ContentPost) {
  if (!post.musica_audio_id) return null;
  return {
    audioId: post.musica_audio_id,
    titulo: post.musica_titulo ?? null,
    volumeMusica: post.musica_volume ?? 20,
    volumeVideo: post.video_volume ?? 100,
  };
}

export function redesView(post: ContentPost) {
  const list = Array.isArray(post.redes) && post.redes.length ? post.redes : ["instagram"];
  return list.includes("instagram") ? list : ["instagram", ...list];
}

/** Instagram pelo status do post; as outras pelo resultado de cada uma (redes_resultado). Sem token nem dado interno. */
export function redesStatusView(post: ContentPost) {
  const out: Record<string, { status: string; externalId: string | null; permalink: string | null; erro: string | null; publishedAt: string | null; tentativas?: number }> = {
    instagram: {
      status: post.status,
      externalId: post.published_media_id ?? null,
      permalink: post.permalink ?? null,
      erro: post.status === "failed" ? post.last_error ?? null : null,
      publishedAt: post.published_at ?? null,
    },
  };
  const results = new Map((post.redes_resultado ?? []).map((item) => [item.rede, item]));
  for (const rede of redesView(post)) {
    if (rede === "instagram") continue;
    const item = results.get(rede as "facebook" | "threads" | "youtube");
    out[rede] = item
      ? { status: item.status, externalId: item.externalId, permalink: item.permalink, erro: item.erro, publishedAt: item.publishedAt, tentativas: item.tentativas }
      : { status: "pending", externalId: null, permalink: null, erro: null, publishedAt: null, tentativas: 0 };
  }
  return out;
}

const CAPTION_START_LENGTH = 140;

/** Primeiros 140 caracteres da legenda, em uma linha só. */
export function captionStart(caption: string | null | undefined) {
  const oneLine = (caption ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
  return Array.from(oneLine).slice(0, CAPTION_START_LENGTH).join("");
}

/** O que o Molde vê de cada post publicado em /api/molde/resultados (sem tokens nem dados de contato). */
export function resultView(post: ContentPost) {
  return {
    id: post.id,
    externalRef: post.external_ref,
    source: post.source,
    accountId: post.account_id,
    username: post.account_username,
    publishType: post.publish_type,
    title: post.title,
    captionInicio: captionStart(post.caption),
    publishedAt: post.published_at,
    permalink: post.permalink,
    insights: post.insights ?? {},
    insightsAt: post.insights_at,
    aiGenerated: Boolean(post.ai_generated),
  };
}
