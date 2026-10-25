import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { EMAIL_DESLIGADO, gravarGasto, isMissing0017, listarDesafios, MIGRATION_0017, salvarDesafio } from "@/lib/db/desafios";
import { lerDesafio, slugDesafio } from "@/lib/desafio/desafio";
import { emailConfig } from "@/lib/vendas/email";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function falta0017() {
  return NextResponse.json({ error: MIGRATION_0017, codigo: "falta_0017" }, { status: 503 });
}
function moldeDe(value: unknown) {
  const t = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(t) ? t : "";
}
function emailAviso() {
  return emailConfig() ? {} : { aviso: EMAIL_DESLIGADO };
}

/**
 * POST /api/molde/desafio  { molde, accountId?, id?, slug?, desafio }  → publica ou atualiza o desafio de 5 dias do projeto
 * (o pacote é conferido: 5 dias por versão, textos dentro dos limites da Meta, vídeo https .mp4/.mov, oferta https).
 * Resposta: { id, slug, avisos[], emailLigado, aviso? }. O post começa o desafio com automationOptions.desafio = { id }.
 *
 * POST /api/molde/desafio  { molde, id, gastoAnuncio, moeda? }  → só o gasto de anúncio (para o custo por venda; null apaga).
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
  try {
    if (body.desafio === undefined && "gastoAnuncio" in body) {
      if (!id) return NextResponse.json({ error: "Falta o id do desafio." }, { status: 400 });
      const gasto = body.gastoAnuncio === null || body.gastoAnuncio === "" ? null : Number(body.gastoAnuncio);
      if (gasto !== null && (!Number.isFinite(gasto) || gasto < 0 || gasto > 10_000_000)) return NextResponse.json({ error: "O gasto de anúncio precisa ser um número de 0 para cima." }, { status: 400 });
      const moeda = typeof body.moeda === "string" && /^[A-Z]{3}$/.test(body.moeda.trim()) ? body.moeda.trim() : null;
      if (!(await gravarGasto(id, molde, gasto === null ? null : Math.round(gasto * 100) / 100, moeda))) return NextResponse.json({ error: "Não achei este desafio no projeto." }, { status: 404 });
      return NextResponse.json({ data: { id, gastoAnuncio: gasto } });
    }
    const lido = lerDesafio(body.desafio);
    if (!lido.ok) return NextResponse.json({ error: lido.erros.join(" "), erros: lido.erros }, { status: 400 });
    const slug = slugDesafio(body.slug) || slugDesafio(lido.pacote.titulo) || "desafio";
    const d = await salvarDesafio({ id, accountId, molde, slug: slug.length >= 3 ? slug : `${slug}-desafio`, pacote: lido.pacote });
    return NextResponse.json({ data: { id: d.id, slug: d.slug, avisos: lido.avisos, emailLigado: Boolean(emailConfig()), ...emailAviso() } }, { status: d.criado ? 201 : 200 });
  } catch (error) {
    if (isMissing0017(error)) return falta0017();
    console.error("[desafio] não consegui guardar:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error && /Outro projeto/.test(error.message) ? error.message : "Não consegui guardar o desafio agora. Tente de novo em instantes." }, { status: 500 });
  }
}

/**
 * GET /api/molde/desafio?molde=<projeto> → os desafios do projeto com os números: comentaram, inscritos, chegaram em cada dia,
 * com e-mail, e-mails de reserva enviados, cliques na oferta, compras (pelas vendas com o código do desafio), o custo por venda
 * (com o gasto informado) e, com a versão B, os números por versão e a comparação (vencedora só com 200 inscritos em cada).
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const molde = moldeDe(request.nextUrl.searchParams.get("molde"));
  if (!molde) return NextResponse.json({ error: "Falta o projeto do Molde (molde)." }, { status: 400 });
  try {
    return NextResponse.json({ data: { desafios: await listarDesafios(molde), emailLigado: Boolean(emailConfig()), ...emailAviso() } });
  } catch (error) {
    if (isMissing0017(error)) return falta0017();
    console.error("[desafio] não consegui ler os números:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui ler os números do desafio agora. Tente de novo em instantes." }, { status: 500 });
  }
}
