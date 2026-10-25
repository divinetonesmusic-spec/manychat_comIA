import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { cancelarFila, decidirFila, filaView, getFila, marcarAplicada } from "@/lib/molde/fila";
import { filaFailure } from "@/lib/molde/fila-http";
import { answer, readBody, text, UUID } from "@/lib/molde/jobs-http";
import { filaDecisionLine, reflectFilaDecision } from "@/lib/telegram/fila";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string; acao: string }> };
const NOT_FOUND = "Item da fila não encontrado.";

/**
 * POST /api/molde/fila/<id>/<acao>  (da página, com o x-molde-token)
 *   decidir  { decisao: "aprovar" | "refazer", nota?, por?, rodada? }   a decisão pela página (o Telegram passa a mostrar)
 *   aplicada { rodada }                                                 a página aplicou a decisão da rodada no pedido dela
 *   cancelar { nota? }                                                  a página não vai fazer (ex.: passou do limite do mês)
 * Contrato: docs/API_MOLDE_FILA.md.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id, acao } = await params;
  if (!UUID.test(id)) return answer(NOT_FOUND, 404);
  const body = await readBody(request);
  try {
    switch (acao) {
      case "decidir": {
        const decisao = body.decisao;
        if (decisao !== "aprovar" && decisao !== "refazer") return answer('Decisão inválida. Use "aprovar" ou "refazer".', 400);
        const nota = body.nota === undefined || body.nota === null || body.nota === "" ? null : text(body.nota, 1000);
        if (body.nota && !nota) return answer("A nota precisa ter até 1000 letras.", 400);
        const por = body.por === undefined || body.por === null ? null : text(body.por, 80);
        const rodada = body.rodada === undefined || body.rodada === null ? null : Number(body.rodada);
        if (rodada !== null && !Number.isInteger(rodada)) return answer("rodada inválida.", 400);
        const outcome = await decidirFila(id, { decisao, nota, por, rodada, via: "pagina" });
        if (outcome.ok) {
          await reflectFilaDecision(outcome.item, { timeoutMs: 4000 });
          return NextResponse.json({ data: filaView(outcome.item) });
        }
        if (outcome.motivo === "not-found") return answer(NOT_FOUND, 404);
        if (outcome.motivo === "already") return answer(`Já foi decidido: ${filaDecisionLine(outcome.item.decisao!)}`, 409, { data: filaView(outcome.item) });
        if (outcome.motivo === "old-round") return answer("Esta prévia é antiga: veja a mais nova.", 409, { data: filaView(outcome.item) });
        if (outcome.motivo === "sem-motivo") return answer("Para refazer, diga o que mudar (nota).", 400);
        return answer("Este item não está esperando aprovação.", 409, { data: filaView(outcome.item) });
      }
      case "aplicada": {
        const rodada = Number(body.rodada);
        if (!Number.isInteger(rodada) || rodada < 0) return answer("Mande a rodada da decisão que foi aplicada.", 400);
        const item = await marcarAplicada(id, rodada);
        if (item) return NextResponse.json({ data: filaView(item) });
        const atual = await getFila(id);
        return atual ? answer("Esta decisão não é a da rodada mandada.", 409, { data: filaView(atual) }) : answer(NOT_FOUND, 404);
      }
      case "cancelar": {
        const nota = body.nota === undefined || body.nota === null || body.nota === "" ? null : text(body.nota, 1000);
        const item = await cancelarFila(id, nota);
        return item ? NextResponse.json({ data: filaView(item) }) : answer(NOT_FOUND, 404);
      }
      default:
        return answer("Ação inválida. Use decidir, aplicada ou cancelar.", 404);
    }
  } catch (error) {
    return filaFailure(error, `não consegui fazer "${acao}"`);
  }
}
