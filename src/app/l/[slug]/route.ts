import { NextRequest, NextResponse } from "next/server";
import { countClick, resolveLink } from "@/lib/links/redirect";
import type { ClickOrigin } from "@/lib/db/tracked-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** Robôs de prévia (WhatsApp, Telegram, Slack, Facebook...) não contam como clique. O navegador de dentro do Instagram conta. */
const PREVIEW_BOT = /facebookexternalhit|Facebot|bot\b|crawler|spider|preview|WhatsApp|TelegramBot|Slackbot|Discordbot|curl|wget/i;

function notFound() {
  return new NextResponse("Link não encontrado.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** O banco falhou e este código nunca foi visto por este servidor: pede para tentar de novo (nunca se adivinha o destino). */
function unavailable() {
  return new NextResponse("Estamos com um problema agora. Tente de novo em instantes.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "5" },
  });
}

function originOf(request: NextRequest): ClickOrigin {
  const from = request.nextUrl.searchParams.get("de");
  return from === "bio" || from === "dm" || from === "comentario" ? from : "outro";
}

async function handle(request: NextRequest, { params }: Params, counts: boolean) {
  const { slug } = await params;
  if (!/^[a-z0-9]{3,32}$/.test(slug)) return notFound();

  const lookup = await resolveLink(slug);
  if (lookup.kind === "not-found") return notFound();
  if (lookup.kind === "unavailable") return unavailable();

  if (counts && !PREVIEW_BOT.test(request.headers.get("user-agent") ?? "")) await countClick(lookup.link.id, originOf(request));

  return NextResponse.redirect(lookup.link.destino, { status: 302, headers: { "cache-control": "no-store" } });
}

export async function GET(request: NextRequest, context: Params) {
  return handle(request, context, true);
}

/** HEAD (verificadores de link) redireciona igual, sem contar clique. */
export async function HEAD(request: NextRequest, context: Params) {
  return handle(request, context, false);
}
