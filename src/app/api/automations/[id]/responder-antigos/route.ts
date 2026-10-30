import { NextRequest } from "next/server";
import { responderGet, responderPost } from "@/lib/responder-antigos-http";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/**
 * «Responder quem já comentou neste post», pela tela da automação (login do painel, como as outras rotas de /api/automations).
 * GET  ?post=<link ou id da mídia>&accountId=&novo=1   conta (nada sai); chame de novo enquanto estado = "lendo".
 * POST { post, paraEnviar, accountId? }                confirma («Mandar para N pessoas») e continua o envio.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const search = request.nextUrl.searchParams;
  return responderGet({ automationId: id, accountId: search.get("accountId"), post: search.get("post"), novo: search.get("novo") });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return responderPost({ automationId: id, accountId: typeof body.accountId === "string" ? body.accountId : null, body });
}
