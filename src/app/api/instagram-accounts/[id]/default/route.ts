import { NextRequest, NextResponse } from "next/server";
import { setDefaultInstagramAccount } from "@/lib/db/repositories";
import { toPublicInstagramAccount } from "@/lib/instagram/public-account";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const account = await setDefaultInstagramAccount(id);

  if (!account) {
    return NextResponse.json({ error: "Perfil do Instagram nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({ data: toPublicInstagramAccount(account) }); // sem token (U-SEG-01)
}