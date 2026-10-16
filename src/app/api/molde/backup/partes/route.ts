import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { savePart } from "@/lib/molde/backup";
import { backupFailure, readBytes } from "@/lib/molde/backup-http";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/molde/backup/partes  { projeto?, envio, parte, total, gz64 }
 * Cópia comprimida grande demais para um pedido só: mande o .json.gz em pedaços de até 2 MB (gz64 = o pedaço em
 * base64), na ordem, com o mesmo `envio`. Partes do meio → 202; a última junta tudo e guarda → 201 (igual ao PUT).
 */
export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  try {
    const bytes = await readBytes(request);
    let body: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(bytes.toString("utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
    } catch {
      // corpo inválido: a validação abaixo dá a frase
    }
    const result = await savePart({ projeto: body.projeto, envio: body.envio, parte: body.parte, total: body.total, gz64: body.gz64 });
    if (!result.pronto) return NextResponse.json({ data: { envio: result.envio, parte: result.parte, total: result.total, pronto: false } }, { status: 202 });
    return NextResponse.json({ data: result.item, apagadas: result.apagadas, removidos: result.removidos }, { status: 201 });
  } catch (error) {
    return backupFailure(error, "não consegui guardar a parte da cópia");
  }
}
