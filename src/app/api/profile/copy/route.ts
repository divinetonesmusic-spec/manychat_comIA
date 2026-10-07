import { NextRequest, NextResponse } from "next/server";
import { copyProfileConfiguration } from "@/lib/db/repositories";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sourceAccountId = typeof body.sourceAccountId === "string" ? body.sourceAccountId : "";
    const targetAccountId = typeof body.targetAccountId === "string" ? body.targetAccountId : "";

    if (!sourceAccountId || !targetAccountId) {
      return NextResponse.json({ error: "Informe o perfil de origem e o perfil de destino." }, { status: 400 });
    }

    const result = await copyProfileConfiguration({
      sourceAccountId,
      targetAccountId,
      includeAutomations: body.includeAutomations === true,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não consegui copiar as configurações.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
