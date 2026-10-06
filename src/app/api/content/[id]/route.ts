import { NextRequest, NextResponse } from "next/server";
import { getContentPost } from "@/lib/db/content-planner";
import { parsePostPackage } from "@/lib/content/package";
import { cancelPost, ContentError, editPost, removePost } from "@/lib/content/service";
import { translateError } from "@/lib/content/scheduler";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const post = await getContentPost(id);
  return post ? NextResponse.json({ data: post }) : NextResponse.json({ error: "Post nao encontrado." }, { status: 404 });
}

/** Edita/reagenda. body.action: "publish_now" | "cancel" | "retry" (opcional). */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async () => {
    if (body.action === "cancel") return cancelPost(id);
    const parsed = parsePostPackage(body, { partial: true });
    if (!parsed.ok) throw new ContentError(parsed.error);
    const publishNow = parsed.publishNow || body.action === "publish_now" || body.action === "retry";
    return editPost(id, parsed.value, publishNow);
  });
}

/** Apaga o post do planner e a mídia guardada (não mexe no que já está no Instagram). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(() => removePost(id));
}

async function handle(work: () => Promise<unknown>) {
  try {
    return NextResponse.json({ data: await work() });
  } catch (error) {
    if (error instanceof ContentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: translateError(error) }, { status: 500 });
  }
}
