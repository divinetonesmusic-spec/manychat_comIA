import { NextRequest, NextResponse } from "next/server";
import { contarFila, filaView, listarAvatares, listarFila, registrarItens, salvarAvatares, type FilaInput } from "@/lib/molde/fila";
import { FILA_LOTE_MAX, filaFailure, parseAvatares, parseFilaItem, parsePrecos } from "@/lib/molde/fila-http";
import { answer, readBody } from "@/lib/molde/jobs-http";
import { criarItem, listarOrq, orqView } from "@/lib/molde/orquestrador";
import { checkFilaToken, falha, falhaInesperada, isErro, parseCriar, parseEstados } from "@/lib/molde/orquestrador-http";
import { sendFilaApproval } from "@/lib/telegram/fila";
import { atualizarProgresso } from "@/lib/telegram/progresso";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Quantas mensagens de aprovação saem na hora (o resto, o relógio manda no minuto seguinte: as funções param em ~10 s). */
const AVISOS_NA_HORA = 3;

/**
 * GET /api/molde/fila?projeto=&estado=na_fila,produzindo&origem=telegram&semPedido=1&decisoes=pendentes&limite=100
 * A fila única (mais recentes primeiro), a contagem por projeto e estado (últimos 30 dias) e os avatares que o Telegram oferece.
 *  - semPedido=1 + origem=telegram + estado=na_fila: os pedidos do Telegram confirmados que a página ainda não criou;
 *  - decisoes=pendentes: as decisões (aprovar/refazer) que a página ainda não aplicou (só as dos espelhos da página).
 *
 * v135 · o formato do orquestrador (docs/API_MOLDE_ORQUESTRADOR.md): com o token do orquestrador, com ?formato=orquestrador
 * ou com um estado do vocabulário dele (?estado=novo,aprovado,refazer): { itens: [<item>] }, os mais velhos primeiro, só os
 * itens do orquestrador (com ?todos=1, todos). Filtros: projeto, avatar, estacao, limite (1–200, padrão 50).
 */
export async function GET(request: NextRequest) {
  const auth = checkFilaToken(request);
  if (auth instanceof NextResponse) return auth;
  const params = request.nextUrl.searchParams;
  const lidos = parseEstados(params.get("estado"));
  if (lidos === "invalid") {
    return falha(400, "pedido_invalido", "Estado inválido. Use: na_fila, produzindo, para_aprovar, aprovado, refazer, pronto, erro ou cancelado (ou, no formato do orquestrador: novo, na-estacao, na-revisao, esperando-dono, aprovado, refazer, pronto, erro, cancelado).");
  }
  const formato = params.get("formato");
  if (formato !== "pagina" && (formato === "orquestrador" || auth.quem === "orquestrador" || lidos.orquestrador)) {
    try {
      const itens = await listarOrq({
        estados: lidos.estados,
        projeto: params.get("projeto"),
        avatar: params.get("avatar"),
        estacao: params.get("estacao"),
        todos: params.get("todos") === "1",
        limite: Math.min(200, Math.max(1, Number(params.get("limite")) || 50)),
      });
      return NextResponse.json({ itens: itens.map(orqView) });
    } catch (error) {
      return falhaInesperada(error, "não consegui listar a fila do orquestrador");
    }
  }
  const estados = lidos.estados;
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
 *
 * v135 · CRIAR um item do orquestrador (sem «itens» e com «estacao»): { projeto, estacao, tipo, detalhes?, entrada?, chave?,
 * origem?, titulo?, avatar?, conta?, custoEstimadoUsd? } → 201 { item, reaproveitado: false }; a mesma chave viva (não pronta,
 * não cancelada, das últimas 2 h) → 200 { item, reaproveitado: true }.
 */
export async function POST(request: NextRequest) {
  const auth = checkFilaToken(request);
  if (auth instanceof NextResponse) return auth;
  const body = await readBody(request);
  if (body.itens === undefined && body.avatares === undefined && body.estacao !== undefined) {
    const input = parseCriar(body);
    if (isErro(input)) return falha(400, "pedido_invalido", input.error);
    try {
      const { item, reaproveitado } = await criarItem(input);
      return NextResponse.json({ item: orqView(item), reaproveitado }, { status: reaproveitado ? 200 : 201 });
    } catch (error) {
      return falhaInesperada(error, "não consegui criar o item do orquestrador");
    }
  }
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
  if (!itens.length && !avatares) return answer("Mande os itens da fila (itens) ou a lista dos avatares (avatares). Para criar um item do orquestrador, mande projeto, estacao e tipo.", 400);

  try {
    if (avatares) await salvarAvatares(avatares, precos);
    const resultado = itens.length ? await registrarItens(itens) : [];
    const avisar = resultado.filter((r): r is Extract<typeof r, { avisar: boolean }> => "avisar" in r && r.avisar).slice(0, AVISOS_NA_HORA);
    const enviados = await Promise.all(avisar.map((r) => sendFilaApproval(r.id, { timeoutMs: 2500 })));
    // 0020 · a mensagem de progresso de cada vídeo (uma por vídeo, editada; o que não couber, o relógio manda)
    const mudaram = resultado.flatMap((r, i) => ("id" in r && r.mudou ? [{ id: r.id, grupo: itens[i].grupo ?? null, passos: itens[i].passos ?? null }] : []));
    const progresso = await atualizarProgresso(mudaram, { timeoutMs: 2500, esperar: true });
    return NextResponse.json({ data: resultado, telegram: enviados.filter(Boolean).length, progresso });
  } catch (error) {
    return filaFailure(error, "não consegui gravar a fila");
  }
}
