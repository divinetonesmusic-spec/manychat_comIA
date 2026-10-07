import { NextRequest, NextResponse } from "next/server";
import { addContactTag, removeContactTag } from "@/lib/db/repositories";
import { safeNextPath } from "@/lib/auth";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const formData = await request.formData();
  const action = String(formData.get("action") || "add");
  const tag = String(formData.get("tag") || "");
  const next = safeNextPath(String(formData.get("next") || ""), "/caixa-de-entrada");

  if (action === "remove") {
    await removeContactTag(id, tag);
  } else {
    await addContactTag(id, tag);
  }

  return NextResponse.redirect(new URL(next, request.url));
}