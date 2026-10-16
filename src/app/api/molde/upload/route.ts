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
      folder: moldeFolder(body.folder),
    });
    return NextResponse.json({ data: target });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nao deu para preparar o envio." }, { status: 400 });
  }
}

/**
 * Pasta no R2: sempre começa com "molde" ("previas" → "molde-previas"). Quem já manda "molde" ou "molde-previas"
 * (o robô 0.10.0) não ganha um "molde-" a mais. As prévias de aprovação (molde-previas) o relógio apaga depois de 30 dias.
 */
function moldeFolder(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "molde";
  const folder = value.trim();
  return folder === "molde" || folder.startsWith("molde-") ? folder : `molde-${folder}`;
}
