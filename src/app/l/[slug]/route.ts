import { NextRequest, NextResponse } from "next/server";
import { findLinkBySlug, isMissingTables, recordClick, type ClickOrigin } from "@/lib/db/tracked-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** Robôs de prévia (WhatsApp, Telegram, Slack, Facebook...) não contam como clique. O navegador de dentro do Instagram conta. */
const PREVIEW_BOT = /facebookexternalhit|Facebot|bot\b|crawler|spider|preview|WhatsApp|TelegramBot|Slackbot|Discordbot|curl|wget/i;

/** Quanto o clique pode atrasar o redirecionamento, no máximo. */
const CLICK_WAIT_MS = 300;

function notFound() {
  return new NextResponse("Link não encontrado.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function originOf(request: NextRequest): ClickOrigin {
  const from = request.nextUrl.searchParams.get("de");
  return from === "bio" || from === "dm" || from === "comentario" ? from : "outro";
}

/** Espera o clique ser gravado, mas no máximo CLICK_WAIT_MS; se o banco falhar ou demorar, o redirecionamento sai igual. */
async function countClick(linkId: string, origin: ClickOrigin) {
  const saving = recordClick(linkId, origin).catch((error) => {
    console.error("[links] não consegui gravar o clique:", error instanceof Error ? error.message : error);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CLICK_WAIT_MS);
  });
  await Promise.race([saving, limit]);
  clearTimeout(timer);
}

async function handle(request: NextRequest, { params }: Params, counts: boolean) {
  const { slug } = await params;
  if (!/^[a-z0-9]{3,32}$/.test(slug)) return notFound();

  let link: Awaited<ReturnType<typeof findLinkBySlug>>;
  try {
    link = await findLinkBySlug(slug);
  } catch (error) {
    if (!isMissingTables(error)) console.error("[links] não consegui ler o link:", error instanceof Error ? error.message : error);
    return notFound(); // sem a 0006 (ou banco fora do ar): como se o link não existisse
  }
  if (!link) return notFound();

  if (counts && !PREVIEW_BOT.test(request.headers.get("user-agent") ?? "")) await countClick(link.id, originOf(request));

  return NextResponse.redirect(link.destino, { status: 302, headers: { "cache-control": "no-store" } });
}

export async function GET(request: NextRequest, context: Params) {
  return handle(request, context, true);
}

/** HEAD (verificadores de link) redireciona igual, sem contar clique. */
export async function HEAD(request: NextRequest, context: Params) {
  return handle(request, context, false);
}
