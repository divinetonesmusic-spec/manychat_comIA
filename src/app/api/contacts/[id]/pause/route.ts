import { NextRequest, NextResponse } from "next/server";
import { setContactHumanPause } from "@/lib/db/repositories";
import { safeNextPath } from "@/lib/auth";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { paused?: boolean; hours?: number; reason?: string };
  const paused = body.paused !== false;
  const hours = Number(body.hours || 0);
  const until = paused && Number.isFinite(hours) && hours > 0 ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;

  await setContactHumanPause({
    contactId: id,
    paused,
    until,
    reason: body.reason,
  });

  return NextResponse.json({ ok: true });
}
export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const formData = await request.formData();
  const paused = String(formData.get("paused") || "true") !== "false";
  const hours = Number(formData.get("hours") || 0);
  const until = paused && Number.isFinite(hours) && hours > 0 ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;
  const reason = String(formData.get("reason") || "Atendimento humano");
  const next = safeNextPath(String(formData.get("next") || ""), "/caixa-de-entrada");

  await setContactHumanPause({
    contactId: id,
    paused,
    until,
    reason,
  });

  return NextResponse.redirect(new URL(next, request.url));
}
