import { NextResponse } from "next/server";
import { BackupError, MAX_PEDIDO } from "@/lib/molde/backup";

/** Resposta de erro das rotas /api/molde/backup: frase em português + código (como as da fila). */
export function backupFailure(error: unknown, contexto: string) {
  if (error instanceof BackupError) return NextResponse.json({ error: error.message, codigo: error.codigo, ...error.extra }, { status: error.status });
  console.error(`[molde-backup] ${contexto}:`, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: "Não consegui fazer isso agora. Tente de novo em instantes." }, { status: 500 });
}

/** Lê o corpo inteiro, recusando antes de ler quando o content-length já passa do limite. */
export async function readBytes(request: Request, max = MAX_PEDIDO) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > max) throw new BackupError("Pedido grande demais (máximo 5,5 MB): mande em partes por /api/molde/backup/partes.", 413, "grande_demais");
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > max) throw new BackupError("Pedido grande demais (máximo 5,5 MB): mande em partes por /api/molde/backup/partes.", 413, "grande_demais");
  return bytes;
}
