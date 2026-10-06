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
      { error: "A porta do Molde esta fechada: defina MOLDE_API_TOKEN (24+ caracteres) nas variaveis do servidor." },
      { status: 503 },
    );
  }
  const provided = request.headers.get("x-molde-token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!provided || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Token do Molde invalido." }, { status: 401 });
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
    keyword: post.keyword,
    automationId: post.automation_id,
    firstCommentDone: Boolean(post.first_comment_id),
    insights: post.insights ?? {},
    insightsAt: post.insights_at,
  };
}
