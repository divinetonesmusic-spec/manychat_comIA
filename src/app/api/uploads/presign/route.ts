import { NextRequest, NextResponse } from "next/server";
import { createUploadTarget } from "@/lib/content/r2";

export const runtime = "nodejs";

/** Link de envio direto para o R2 (o arquivo não passa pelo servidor). Exige estar logado (proxy.ts). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const target = createUploadTarget({
      fileName: String(body.fileName || "arquivo"),
      contentType: String(body.contentType || ""),
      size: typeof body.size === "number" ? body.size : undefined,
      folder: typeof body.folder === "string" ? body.folder : "conteudo",
    });
    return NextResponse.json({ data: target });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não deu para preparar o envio." }, { status: 400 });
  }
}
