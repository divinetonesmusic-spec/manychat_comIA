import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { isMissing0013, listarLeads, MIGRATION_0013 } from "@/lib/db/funil-molde";
import { csv } from "@/lib/vendas/exportar";
import { confirmacaoDuplaLigada } from "@/lib/funil/confirmacao";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/molde/leads?molde=<projeto>  → { total, naLista, csv } : a Lista própria do projeto (quiz e entrega) como planilha
 * (CSV com BOM, aberta no Excel e no Numbers). Sem molde: todas as listas. O CSV vai dentro do data (o robô do Mac só
 * devolve o data à página, que baixa o arquivo).
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const m = (request.nextUrl.searchParams.get("molde") || "").trim();
  if (m && !/^[A-Za-z0-9_.:-]{1,80}$/.test(m)) return NextResponse.json({ error: "molde inválido." }, { status: 400 });
  try {
    const L = await listarLeads(m || null);
    const planilha = csv([
      ["email", "nome", "veio_de", "origem_post", "canal", "quiz", "perfil", "entrega", "aceita_emails", "aceitou_em", "confirmou_em", "entrou_em", "saiu_da_lista_em", "sequencia"],
      ...L.map((l) => [l.email, l.nome, l.fonte, l.origem, l.de, l.quiz, l.perfil, l.entrega, l.consentimento, l.consentimentoEm, l.confirmadoEm, l.criadoEm, l.descadastradoEm, l.sequencia]),
    ]);
    // na lista de dicas e ofertas: marcou a caixa, não saiu e (com a confirmação dupla ligada) confirmou pelo e-mail
    const dupla = confirmacaoDuplaLigada();
    const naLista = L.filter((l) => l.consentimento && !l.descadastradoEm && (!dupla || l.confirmadoEm)).length;
    return NextResponse.json({ data: { total: L.length, naLista, confirmacaoDupla: dupla, csv: planilha } });
  } catch (error) {
    if (isMissing0013(error)) return NextResponse.json({ error: MIGRATION_0013, codigo: "falta_0013" }, { status: 503 });
    console.error("[lista] não consegui ler:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui ler a lista agora. Tente de novo em instantes." }, { status: 500 });
  }
}
