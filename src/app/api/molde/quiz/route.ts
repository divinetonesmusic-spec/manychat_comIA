import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { isMissing0013, listarQuizzes, MIGRATION_0013, salvarQuiz } from "@/lib/db/funil-molde";
import { lerQuiz, slugDe } from "@/lib/funil/quiz";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function falta0013() {
  return NextResponse.json({ error: MIGRATION_0013, codigo: "falta_0013" }, { status: 503 });
}
function moldeDe(value: unknown) {
  const t = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(t) ? t : "";
}

/**
 * POST /api/molde/quiz  { molde, accountId?, id?, slug?, quiz }
 * Publica (ou atualiza) o quiz do projeto do Molde: confere o pacote (perfis, perguntas, prova, pergunta da DM, marca) e
 * devolve { id, slug, url, avisos }. O quiz abre em /q/<slug>, sem login.
 */
export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const molde = moldeDe(body.molde);
  if (!molde) return NextResponse.json({ error: "Falta o projeto do Molde (molde)." }, { status: 400 });
  const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : null;
  if (accountId && !UUID.test(accountId)) return NextResponse.json({ error: "accountId inválido." }, { status: 400 });
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  const lido = lerQuiz(body.quiz);
  if (!lido.ok) return NextResponse.json({ error: lido.erros.join(" "), erros: lido.erros }, { status: 400 });
  const slug = slugDe(body.slug) || slugDe(lido.quiz.titulo) || "quiz";
  try {
    const q = await salvarQuiz({ id, accountId, molde, slug: slug.length >= 3 ? slug : `${slug}-quiz`, quiz: lido.quiz });
    const data = { id: q.id, slug: q.slug, url: `${getAppBaseUrl(request.url)}/q/${q.slug}`, avisos: lido.avisos };
    return NextResponse.json({ data }, { status: q.criado ? 201 : 200 });
  } catch (error) {
    if (isMissing0013(error)) return falta0013();
    console.error("[quiz] não consegui guardar:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error && /Outro projeto/.test(error.message) ? error.message : "Não consegui guardar o quiz agora. Tente de novo em instantes." }, { status: 500 });
  }
}

/** GET /api/molde/quiz?molde=<projeto> → os quizzes do projeto com os números (início, fim, e-mail, toque na oferta e compra, por perfil). */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const molde = moldeDe(request.nextUrl.searchParams.get("molde"));
  if (!molde) return NextResponse.json({ error: "Falta o projeto do Molde (molde)." }, { status: 400 });
  try {
    const base = getAppBaseUrl(request.url);
    const lista = await listarQuizzes(molde);
    return NextResponse.json({ data: lista.map((q) => ({ ...q, url: `${base}/q/${q.slug}` })) });
  } catch (error) {
    if (isMissing0013(error)) return falta0013();
    console.error("[quiz] não consegui ler os números:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui ler os números do quiz agora. Tente de novo em instantes." }, { status: 500 });
  }
}
