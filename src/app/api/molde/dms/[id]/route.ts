import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { discardPending, isMissingTables, listPending, queueReply, refreshPending } from "@/lib/db/dm-pending";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_0006 = "Falta colar a atualização 0006 no Supabase (veja docs/ATUALIZACAO_0006.md).";
const MAX_REPLY_LENGTH = 1000;

function answer(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * POST /api/molde/dms/<id>  { acao: "enviar", texto } | { acao: "descartar" }
 * `enviar` coloca a resposta aprovada na fila normal de envios (limite de 200 por hora, prazo de 24 h); não liga a pausa humana.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const acao = body.acao;

  if (acao !== "enviar" && acao !== "descartar") return answer('Ação inválida. Use "enviar" ou "descartar".', 400);
  const texto = typeof body.texto === "string" ? body.texto.trim() : "";
  if (acao === "enviar" && (!texto || Array.from(texto).length > MAX_REPLY_LENGTH)) {
    return answer("A resposta precisa ter de 1 a 1000 letras.", 400);
  }
  if (!UUID.test(id)) return answer("Mensagem não encontrada.", 404);

  try {
    const outcome = acao === "enviar" ? await queueReply(id, texto) : await discardPending(id);
    if (outcome === "not-found") return answer("Mensagem não encontrada.", 404);
    if (outcome === "closed") return answer("Esta mensagem já foi respondida ou descartada.", 409);
    if (outcome === "expired") return answer("Passou o prazo de 24 h do Instagram para responder esta pessoa.", 409);

    // Já pode ter ficado claro que não sai (ex.: contato em atendimento manual): a resposta mostra o estado de agora.
    await refreshPending({ id });
    const [item] = await listPending({ id });
    return NextResponse.json({ data: item });
  } catch (error) {
    if (isMissingTables(error)) return answer(MISSING_0006, 503);
    console.error("[dms] não consegui atender o pedido:", error instanceof Error ? error.message : error);
    return answer("Não consegui fazer isso agora. Tente de novo em instantes.", 500);
  }
}
