import { NextRequest, NextResponse } from "next/server";
import { cancelarFila, decidirFila, filaView, getFila, marcarAplicada } from "@/lib/molde/fila";
import { filaFailure } from "@/lib/molde/fila-http";
import { answer, readBody, text, UUID } from "@/lib/molde/jobs-http";
import { getItem, gravarResultado, marcarErro, orqView, passoItem, pedirAprovacao, pegarItem, soltarItem, type OrqOutcome } from "@/lib/molde/orquestrador";
import {
  checkFilaToken,
  falha,
  falhaInesperada,
  falhaOrq,
  isErro,
  parseAprovacao,
  parseDecisao,
  parseEstacao,
  parsePrazo,
  parseQuem,
  parseSaida,
  parseVersao,
  respostaDaDecisao,
} from "@/lib/molde/orquestrador-http";
import { filaDecisionLine, reflectFilaDecision, sendFilaApproval, sendFilaErro } from "@/lib/telegram/fila";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string; acao: string }> };
const NOT_FOUND = "Item da fila não encontrado.";
const ORQ_ACOES = ["decisao", "pegar", "passo", "aprovacao", "resultado", "erro", "soltar"];

/**
 * POST /api/molde/fila/<id>/<acao>  (com o x-molde-token, ou o token do orquestrador)
 * Da página (docs/API_MOLDE_FILA.md; respostas {data} e {error}):
 *   decidir  { decisao, nota?, por?, rodada? }   a decisão pela página (o Telegram passa a mostrar)
 *   aplicada { rodada }                          a página aplicou a decisão da rodada no pedido dela
 *   cancelar { nota? }                           a página não vai fazer (ex.: passou do limite do mês)
 * Do orquestrador (v135, docs/API_MOLDE_ORQUESTRADOR.md; respostas {item} e {erro: {codigo, mensagem}}), todas com a versao:
 *   decisao   { versao?, decisao, nota?, por?, rodada? }   a decisão do dono (página): aprovar, refazer, corrigir, publicar…
 *   pegar     { versao, quem?, prazoSeg? }                  posse com prazo (vence sozinha)
 *   passo     { versao, estacao, saida, quem? }             o diário de cada skill (renova o prazo)
 *   aprovacao { versao, motivo, pergunta?, opcoes?, achados?, custo?, resumo?, previa?, quem? }  para no dono (Telegram)
 *   resultado { versao, saida, pecasParaGravar?, quem? }    pronto
 *   erro      { versao, motivo, tentarDeNovo?, quem? }      volta a «novo» (até 2 vezes) ou fica «erro»
 *   soltar    { versao, nota?, quem? }                      devolve sem erro (ex.: «Esperando o Mac ligar»)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = checkFilaToken(request);
  if (auth instanceof NextResponse) return auth;
  const { id, acao } = await params;
  if (ORQ_ACOES.includes(acao)) return acaoDoOrquestrador(request, id, acao);
  if (!UUID.test(id)) return answer(NOT_FOUND, 404);
  const body = await readBody(request);
  try {
    switch (acao) {
      case "decidir": {
        const decisao = parseDecisao(body.decisao);
        if (isErro(decisao)) return answer('Decisão inválida. Use "aprovar" ou "refazer".', 400);
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
        if (outcome.motivo === "opcao") return answer("Esta decisão não vale para este item.", 400, { data: filaView(outcome.item) });
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
        return answer(`Ação inválida. Use decidir, aplicada, cancelar ou (o orquestrador) ${ORQ_ACOES.join(", ")}.`, 404);
    }
  } catch (error) {
    return filaFailure(error, `não consegui fazer "${acao}"`);
  }
}

async function acaoDoOrquestrador(request: NextRequest, id: string, acao: string) {
  if (!UUID.test(id)) return falha(404, "nao_achou", NOT_FOUND);
  const body = await readBody(request);
  const invalido = (frase: string) => falha(400, "pedido_invalido", frase);
  const responder = async (outcome: OrqOutcome, extra: Record<string, unknown> = {}) => {
    if (!outcome.ok) return falhaOrq(outcome.codigo, outcome.item);
    return NextResponse.json({ item: orqView(outcome.item), ...extra });
  };
  try {
    if (acao === "decisao") {
      const decisao = parseDecisao(body.decisao);
      if (isErro(decisao)) return invalido(decisao.error);
      const versao = body.versao === undefined || body.versao === null ? null : parseVersao(body);
      if (isErro(versao)) return invalido(versao.error);
      const nota = body.nota === undefined || body.nota === null || body.nota === "" ? null : text(body.nota, 1000);
      if (body.nota && !nota) return invalido("A nota precisa ter até 1000 letras.");
      const por = body.por === undefined || body.por === null ? null : text(body.por, 80);
      const rodada = body.rodada === undefined || body.rodada === null ? null : Number(body.rodada);
      if (rodada !== null && !Number.isInteger(rodada)) return invalido("rodada inválida.");
      const outcome = await decidirFila(id, { decisao, nota, por, rodada, versao, via: "pagina" });
      const erro = respostaDaDecisao(outcome);
      if (!outcome.ok) return erro!;
      await reflectFilaDecision(outcome.item, { timeoutMs: 4000 });
      return NextResponse.json({ item: orqView(outcome.item) });
    }

    const versao = parseVersao(body);
    if (isErro(versao)) return invalido(versao.error);
    const quem = parseQuem(body, acao === "pegar");
    if (isErro(quem)) return invalido(quem.error);

    switch (acao) {
      case "pegar": {
        const prazoSeg = parsePrazo(body);
        if (isErro(prazoSeg)) return invalido(prazoSeg.error);
        return responder(await pegarItem(id, { versao, quem: quem!, prazoSeg }));
      }
      case "passo": {
        const estacao = parseEstacao(body.estacao);
        if (isErro(estacao)) return invalido(estacao.error);
        const saida = parseSaida(body.saida);
        if (isErro(saida)) return invalido(saida.error);
        return responder(await passoItem(id, { versao, estacao, saida, quem }));
      }
      case "aprovacao": {
        const a = parseAprovacao(body);
        if (isErro(a)) return invalido(a.error);
        const outcome = await pedirAprovacao(id, { versao, quem, ...a });
        if (!outcome.ok) return falhaOrq(outcome.codigo, outcome.item);
        // a mensagem com os achados e os botões (Corrigir / Refazer / Publicar mesmo assim…); se não sair agora, o relógio
        // manda no minuto seguinte (as funções do Netlify param em ~10 s)
        const telegram = await sendFilaApproval(id, { timeoutMs: 2500 });
        return NextResponse.json({ item: orqView((await getItem(id)) ?? outcome.item), telegram });
      }
      case "resultado": {
        const saida = parseSaida(body.saida);
        if (isErro(saida)) return invalido(saida.error);
        const pecas = body.pecasParaGravar === undefined || body.pecasParaGravar === null ? null : parseSaida(body.pecasParaGravar, "pecasParaGravar");
        if (isErro(pecas)) return invalido(pecas.error);
        return responder(await gravarResultado(id, { versao, saida, pecasParaGravar: pecas, quem }));
      }
      case "erro": {
        const motivo = text(body.motivo, 1000);
        if (!motivo) return invalido("Mande o motivo do erro em português (até 1000 letras).");
        const outcome = await marcarErro(id, { versao, motivo, tentarDeNovo: body.tentarDeNovo === true, quem });
        if (outcome.ok && outcome.final) await sendFilaErro(outcome.item, { timeoutMs: 2500 });
        return responder(outcome, outcome.ok ? { tentaDeNovo: !outcome.final } : {});
      }
      case "soltar": {
        const nota = body.nota === undefined || body.nota === null || body.nota === "" ? null : text(body.nota, 200);
        if (body.nota && !nota) return invalido("A nota precisa ter até 200 letras.");
        return responder(await soltarItem(id, { versao, nota, quem }));
      }
      default:
        return falha(404, "acao", "Ação inválida.");
    }
  } catch (error) {
    return falhaInesperada(error, `não consegui fazer "${acao}"`);
  }
}
