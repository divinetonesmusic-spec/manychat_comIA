import { NextRequest, NextResponse } from "next/server";
import { createUploadTarget } from "@/lib/content/r2";
import { checkMoldeToken } from "@/lib/content/molde-auth";

export const runtime = "nodejs";

/** O robô do Mac pede um link e envia o vídeo/imagem final direto para o R2 (PUT). */
export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const target = createUploadTarget({
      fileName: String(body.fileName || "midia"),
      contentType: String(body.contentType || ""),
      size: typeof body.size === "number" ? body.size : undefined,
      folder: typeof body.folder === "string" ? `molde-${body.folder}` : "molde",
    });
    return NextResponse.json({ data: target });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nao deu para preparar o envio." }, { status: 400 });
  }
}
