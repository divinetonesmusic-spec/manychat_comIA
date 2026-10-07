import { NextRequest, NextResponse } from "next/server";
import { getContentPost } from "@/lib/db/content-planner";
import { parsePostPackage } from "@/lib/content/package";
import { cancelPost, ContentError, editPost, removePost } from "@/lib/content/service";
import { PUBLISH_NOW_NOTICE, translateError } from "@/lib/content/scheduler";
import { checkMoldeToken, publicView } from "@/lib/content/molde-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/** Só mexe em posts que vieram do Molde. */
async function moldePost(id: string) {
  const post = await getContentPost(id);
  if (!post || post.source !== "molde") throw new ContentError("Post do Molde nao encontrado.", 404);
  return post;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async () => {
    await moldePost(id);
    if (body.action === "cancel") return publicView(await cancelPost(id));
    const parsed = parsePostPackage(body, { partial: true });
    if (!parsed.ok) throw new ContentError(parsed.error);
    const publishNow = parsed.publishNow || body.action === "publish_now" || body.action === "retry";
    const post = await editPost(id, parsed.value, publishNow);
    // "notice" é campo novo (só acréscimo): o relógio termina a publicação em até 2 min.
    return post ? { ...publicView(post), ...(publishNow && post.status === "publishing" ? { notice: PUBLISH_NOW_NOTICE } : {}) } : null;
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id } = await params;
  return handle(async () => {
    await moldePost(id);
    return removePost(id);
  });
}

async function handle(work: () => Promise<unknown>) {
  try {
    return NextResponse.json({ data: await work() });
  } catch (error) {
    if (error instanceof ContentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: translateError(error) }, { status: 500 });
  }
}
