import { NextRequest, NextResponse } from "next/server";
import { getContentPost } from "@/lib/db/content-planner";
import { parsePostPackage } from "@/lib/content/package";
import { packageWarning, cancelPost, ContentError, editPost, removePost } from "@/lib/content/service";
import { translateError } from "@/lib/content/scheduler";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const post = await getContentPost(id);
  return post ? NextResponse.json({ data: post }) : NextResponse.json({ error: "Post não encontrado." }, { status: 404 });
}

/** Edita/reagenda. body.action: "publish_now" | "cancel" | "retry" (opcional). */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  let warning: string | undefined;
  return handle(async () => {
    if (body.action === "cancel") return cancelPost(id);
    const parsed = parsePostPackage(body, { partial: true });
    if (!parsed.ok) throw new ContentError(parsed.error);
    const publishNow = parsed.publishNow || body.action === "publish_now" || body.action === "retry";
    const post = await editPost(id, parsed.value, publishNow);
    warning = await packageWarning(parsed.value, post); // aiGenerated:true sem a 0006 (ou música sem a 0009 / sem a conexão pelo Facebook)
    return post;
  }, () => warning);
}

/** Apaga o post do planner e a mídia guardada (não mexe no que já está no Instagram). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(() => removePost(id));
}

async function handle(work: () => Promise<unknown>, warning: () => string | undefined = () => undefined) {
  try {
    const data = await work();
    const aviso = warning();
    return NextResponse.json(aviso ? { data, warning: aviso } : { data });
  } catch (error) {
    if (error instanceof ContentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: translateError(error) }, { status: 500 });
  }
}
