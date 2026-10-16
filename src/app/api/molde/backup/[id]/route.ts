import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { backupLink, readBackupPart } from "@/lib/molde/backup";
import { backupFailure } from "@/lib/molde/backup-http";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/molde/backup/<id>?parte=0 — devolve a cópia em pedaços de 2 MB comprimidos ({ ..., partes, parte, gz64 }):
 * junte os pedaços 0..partes-1 na ordem e descomprima (gzip) para ter o JSON.
 * GET /api/molde/backup/<id>?formato=link — link de 15 minutos para baixar o .json.gz inteiro.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id } = await params;
  const search = request.nextUrl.searchParams;
  try {
    if (search.get("formato") === "link") return NextResponse.json({ data: await backupLink(id) });
    const parte = search.has("parte") ? Number(search.get("parte")) : 0;
    return NextResponse.json({ data: await readBackupPart(id, parte) });
  } catch (error) {
    return backupFailure(error, "não consegui ler a cópia");
  }
}
