import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { getJob, jobView } from "@/lib/molde/jobs";
import { answer, failure, UUID } from "@/lib/molde/jobs-http";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/** GET /api/molde/jobs/<id> — um trabalho (estado, etapa, progresso, prévia, aprovação…). */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id } = await params;
  if (!UUID.test(id)) return answer("Trabalho não encontrado.", 404);
  try {
    const job = await getJob(id);
    return job ? NextResponse.json({ data: jobView(job) }) : answer("Trabalho não encontrado.", 404);
  } catch (error) {
    return failure(error, "não consegui ler o trabalho");
  }
}
