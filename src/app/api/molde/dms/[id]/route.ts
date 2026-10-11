import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { discardPending, isMissingTables, listPending, prepareDraft, queueReply, refreshPending } from "@/lib/db/dm-pending";
import { isMissing0008, MISSING_0008 } from "@/lib/molde/jobs";
import { reflectDmSentFromPage, sendDmDraftApproval } from "@/lib/telegram/approvals";

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
 * POST /api/molde/dms/<id>  { acao: "enviar", texto } | { acao: "descartar" } | { acao: "preparar", texto }
 * `enviar` coloca a resposta aprovada na fila normal de envios (limite de 200 por hora, prazo de 24 h); não liga a pausa humana.
 * `preparar` (0008) guarda o rascunho que o Molde escreveu e pergunta no Telegram «Mandar» / «Não mandar»; o toque em
 * «Mandar» faz o mesmo que `enviar` com o texto do rascunho. A página continua podendo mandar (ou mudar o texto) com `enviar`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const acao = body.acao;

  if (acao !== "enviar" && acao !== "descartar" && acao !== "preparar") return answer('Ação inválida. Use "enviar", "descartar" ou "preparar".', 400);
  const texto = typeof body.texto === "string" ? body.texto.trim() : "";
  if ((acao === "enviar" || acao === "preparar") && (!texto || Array.from(texto).length > MAX_REPLY_LENGTH)) {
    return answer("A resposta precisa ter de 1 a 1000 letras.", 400);
  }
  if (!UUID.test(id)) return answer("Mensagem não encontrada.", 404);

  if (acao === "preparar") return prepare(id, texto);

  try {
    const outcome = acao === "enviar" ? await queueReply(id, texto) : await discardPending(id);
    if (outcome === "not-found") return answer("Mensagem não encontrada.", 404);
    if (outcome === "closed") return answer("Esta mensagem já foi respondida ou descartada.", 409);
    if (outcome === "opted-out") return answer("Esta pessoa pediu para não receber mensagens.", 409);
    if (outcome === "expired") return answer("Passou o prazo de 24 h do Instagram para responder esta pessoa.", 409);

    // Se a mesma resposta esperava o «Mandar» no Telegram, a mensagem de lá passa a dizer que saiu pela página.
    if (acao === "enviar") await reflectDmSentFromPage(id);
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

/** Guarda o rascunho do Molde e pergunta no Telegram (sem a 0008: 503 com a frase de falta). */
async function prepare(id: string, texto: string) {
  try {
    const outcome = await prepareDraft(id, texto);
    if (!outcome.ok && outcome.motivo === "not-found") return answer("Mensagem não encontrada.", 404);
    if (!outcome.ok) return answer("Esta mensagem já foi respondida ou descartada.", 409);
    const telegram = await sendDmDraftApproval(id, outcome.seq);
    const [item] = await listPending({ id });
    return NextResponse.json({ data: item, telegram });
  } catch (error) {
    if (isMissingTables(error)) return answer(MISSING_0006, 503);
    if (isMissing0008(error)) return answer(MISSING_0008, 503);
    console.error("[dms] não consegui guardar o rascunho:", error instanceof Error ? error.message : error);
    return answer("Não consegui fazer isso agora. Tente de novo em instantes.", 500);
  }
}
