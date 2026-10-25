import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { contarFila, filaView, listarAvatares, listarFila, registrarItens, salvarAvatares, type FilaInput } from "@/lib/molde/fila";
import { FILA_LOTE_MAX, filaFailure, parseAvatares, parseFilaItem, parseFilaStates, parsePrecos } from "@/lib/molde/fila-http";
import { answer, readBody } from "@/lib/molde/jobs-http";
import { sendFilaApproval } from "@/lib/telegram/fila";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Quantas mensagens de aprovação saem na hora (o resto, o relógio manda no minuto seguinte: as funções param em ~10 s). */
const AVISOS_NA_HORA = 3;

/**
 * GET /api/molde/fila?projeto=&estado=na_fila,produzindo&origem=telegram&semPedido=1&decisoes=pendentes&limite=100
 * A fila única (mais recentes primeiro), a contagem por projeto e estado (últimos 30 dias) e os avatares que o Telegram oferece.
 *  - semPedido=1 + origem=telegram + estado=na_fila: os pedidos do Telegram confirmados que a página ainda não criou;
 *  - decisoes=pendentes: as decisões (aprovar/refazer) que a página ainda não aplicou.
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const estados = parseFilaStates(params.get("estado"));
  if (estados === "invalid") return answer("Estado inválido. Use: na_fila, produzindo, para_aprovar, aprovado, refazer, pronto, erro ou cancelado.", 400);
  const origem = params.get("origem");
  if (origem && origem !== "pagina" && origem !== "telegram") return answer("Origem inválida. Use pagina ou telegram.", 400);
  const limite = Math.min(200, Math.max(1, Number(params.get("limite")) || 100));
  try {
    const itens = await listarFila({
      projeto: params.get("projeto"),
      estados,
      origem: origem as "pagina" | "telegram" | null,
      semPedido: params.get("semPedido") === "1",
      decisoesPendentes: params.get("decisoes") === "pendentes",
      limite,
    });
    const [contagem, avatares] = await Promise.all([contarFila(), listarAvatares()]);
    return NextResponse.json({
      data: itens.map(filaView),
      contagem,
      avatares: avatares.map((a) => ({ projeto: a.projeto, nome: a.nome, conta: a.conta })),
    });
  } catch (error) {
    return filaFailure(error, "não consegui listar a fila");
  }
}

/**
 * POST /api/molde/fila  { itens: [<item>], avatares?: [{projeto, nome, conta}], precos?: {foto, reel} }
 * O espelho dos pedidos da página (até 50 por vez). Cada item cria ou atualiza a linha dele (pela ref, pelo pedido ou pelo id
 * do pedido do Telegram). O item que entra em «para_aprovar» manda a prévia no Telegram com «Aprovar» / «Refazer».
 * Resposta: { data: [{id, ref, estado, rodada, criado, mudou, avisar, decisaoPendente} | {erro, ref}], telegram: <quantas saíram> }.
 */
export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = await readBody(request);
  const brutos = body.itens === undefined ? [] : body.itens;
  if (!Array.isArray(brutos) || brutos.length > FILA_LOTE_MAX) return answer(`itens precisa ser uma lista de até ${FILA_LOTE_MAX}.`, 400);
  const itens: FilaInput[] = [];
  for (const [i, bruto] of brutos.entries()) {
    const item = parseFilaItem(bruto, i);
    if ("error" in item) return answer(item.error, 400);
    itens.push(item);
  }
  const avatares = parseAvatares(body.avatares);
  if (avatares && "error" in avatares) return answer(avatares.error, 400);
  const precos = parsePrecos(body.precos);
  if ("error" in precos) return answer(precos.error, 400);
  if (!itens.length && !avatares) return answer("Mande os itens da fila (itens) ou a lista dos avatares (avatares).", 400);

  try {
    if (avatares) await salvarAvatares(avatares, precos);
    const resultado = itens.length ? await registrarItens(itens) : [];
    const avisar = resultado.filter((r): r is Extract<typeof r, { avisar: boolean }> => "avisar" in r && r.avisar).slice(0, AVISOS_NA_HORA);
    const enviados = await Promise.all(avisar.map((r) => sendFilaApproval(r.id, { timeoutMs: 2500 })));
    return NextResponse.json({ data: resultado, telegram: enviados.filter(Boolean).length });
  } catch (error) {
    return filaFailure(error, "não consegui gravar a fila");
  }
}
