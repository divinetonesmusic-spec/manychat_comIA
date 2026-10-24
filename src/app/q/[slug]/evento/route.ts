import { NextResponse, type NextRequest } from "next/server";
import { criarSessaoQuiz, emailValido, getQuizPublico, getSessaoQuiz, gravarRespostas, marcarEmailQuiz, salvarLead } from "@/lib/db/funil-molde";
import { deValido, origemValida } from "@/lib/funil/quiz";
import { textosDe } from "@/lib/funil/textos";
import { passouDoLimite } from "@/lib/funil/limite";
import { pedirConfirmacao } from "@/lib/funil/confirmacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

/**
 * POST /q/<slug>/evento (a página pública do quiz, sem login). Corpo JSON { acao, ... }:
 *   inicio    { perfil?, o?, de? }            → { sessao }       (a pessoa tocou em «Começar»)
 *   respostas { sessao, respostas }           → { ok }           (cada resposta)
 *   fim       { sessao, respostas }           → { perfil }       (o perfil é calculado aqui, no servidor)
 *   email     { sessao, email, nome?, consentimento, site? } → { ok, perfil } (Lista própria; «site» é a armadilha de robô)
 * Nada aqui mostra dado de outra pessoa; a sessão é um id aleatório.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const q = await getQuizPublico(slug);
  if (!q) return json({ error: "Quiz não encontrado." }, 404);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const acao = body.acao;
  try {
    if (acao === "inicio") {
      if (await passouDoLimite(request, "quiz-inicio")) return json({ error: textosDe(q.quiz.idioma).muitas, codigo: "limite" }, 429);
      const perfilDm = typeof body.perfil === "string" && q.quiz.perfis.some((p) => p.id === body.perfil) ? body.perfil : null;
      const sessao = await criarSessaoQuiz(q.id, { perfilDm, origem: origemValida(body.o), de: deValido(body.de) });
      return json({ sessao });
    }
    const sessaoId = typeof body.sessao === "string" ? body.sessao : "";
    if (acao === "respostas" || acao === "fim") {
      const r = await gravarRespostas(q, sessaoId, body.respostas, acao === "fim");
      if (!r) return json({ error: "Sessão não encontrada." }, 404);
      return json(acao === "fim" ? { perfil: r.perfil } : { ok: true });
    }
    if (acao === "email") {
      const sessao = await getSessaoQuiz(sessaoId, q.id);
      if (!sessao) return json({ error: "Sessão não encontrada." }, 404);
      if (typeof body.site === "string" && body.site) return json({ ok: true, perfil: sessao.perfil }); // robô: finge que deu certo
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const T = textosDe(q.quiz.idioma);
      if (!emailValido(email)) return json({ error: T.emailRuim, codigo: "email" }, 400);
      if (await passouDoLimite(request, "quiz", email)) return json({ error: T.muitas, codigo: "limite" }, 429);
      const lead = await salvarLead({
        accountId: q.accountId,
        molde: q.molde,
        email,
        nome: typeof body.nome === "string" ? body.nome.trim().slice(0, 80) || null : null,
        fonte: "quiz",
        origem: sessao.origem,
        de: sessao.de,
        quizId: q.id,
        perfil: sessao.perfil,
        consentimento: body.consentimento === true,
        consentimentoTexto: T.consentimento,
      });
      await marcarEmailQuiz(sessao.id, lead.id);
      const confirmar = await pedirConfirmacao(lead, q.quiz.idioma);
      return json({ ok: true, perfil: sessao.perfil, confirmar });
    }
    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("[quiz] evento falhou:", error instanceof Error ? error.message : error);
    return json({ error: textosDe(q.quiz.idioma).erroRede }, 500);
  }
}
