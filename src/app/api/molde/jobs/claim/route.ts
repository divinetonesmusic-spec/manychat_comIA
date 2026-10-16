import { NextRequest, NextResponse } from "next/server";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { query } from "@/lib/db/client";
import { claimNextJob, jobView, monthKey, monthName } from "@/lib/molde/jobs";
import { answer, failure, readBody, TIPO, workerName } from "@/lib/molde/jobs-http";
import { sendTelegram } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 30;

const fmtUsd = (value: number) => `US$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

/**
 * POST /api/molde/jobs/claim  { worker: "Mac do Nicolas", tipos: ["reel_pipeline", "narrar"] }
 * Entrega o próximo trabalho (ou data: null), com `posse` (código deste claim, que as ações do robô precisam). O trabalho fica "rodando" com este Mac por 10 min (renove com o batimento).
 * Se o que está na fila passaria do teto de gastos do mês, nada sai e vem `aviso` (e 1 aviso por mês no Telegram).
 */
export async function POST(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const body = await readBody(request);
  const worker = workerName(body.worker);
  if (!worker) return answer("Falta o nome do Mac (worker), com até 80 letras.", 400);
  const tipos = Array.isArray(body.tipos) ? body.tipos.filter((tipo): tipo is string => typeof tipo === "string" && TIPO.test(tipo)) : [];
  if (!tipos.length || tipos.length !== (body.tipos as unknown[]).length || tipos.length > 30) {
    return answer("Mande os tipos de trabalho que este Mac sabe fazer (tipos: lista de 1 a 30, ex.: [\"reel_pipeline\"]).", 400);
  }

  try {
    const result = await claimNextJob({ worker, tipos });
    const gastos = { mes: monthKey(), gastoUsd: result.gastoUsd, tetoUsd: result.tetoUsd };
    // `posse`: o código deste claim; o robô manda de volta em batimento, aprovacao, concluir e erro.
    if (result.job) return NextResponse.json({ data: { ...jobView(result.job), posse: result.job.posse ?? null }, gastos });
    if (!result.barradoPeloTeto) return NextResponse.json({ data: null, gastos });

    const n = result.barradoPeloTeto;
    const aviso = `Teto de gastos do Molde em ${monthName()}: ${fmtUsd(result.gastoUsd)} de ${fmtUsd(result.tetoUsd)} já usados. ` +
      `${n === 1 ? "1 trabalho que custa passaria do teto e está esperando" : `${n} trabalhos que custam passariam do teto e estão esperando`}: ` +
      "eles saem no mês que vem, se o teto (MOLDE_TETO_USD) subir ou se você liberar cada um na página do Molde.";
    await warnCapOncePerMonth(aviso);
    return NextResponse.json({ data: null, gastos, aviso });
  } catch (error) {
    return failure(error, "não consegui entregar o próximo trabalho");
  }
}

/** 1 aviso por mês no Telegram (app_status 'aviso_teto_molde'). Se o Telegram falhar, o próximo pedido tenta de novo. */
async function warnCapOncePerMonth(aviso: string) {
  const mes = monthKey();
  try {
    const claimed = await query(
      `insert into public.app_status (chave, valor, atualizado_em) values ('aviso_teto_molde', jsonb_build_object('mes', $1::text), now())
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()
       where public.app_status.valor ->> 'mes' is distinct from $1
       returning chave`,
      [mes],
    );
    if (!claimed.rowCount) return;
    const result = await sendTelegram(`UaiFlow: ${aviso}`, { timeoutMs: 4000 });
    if (!result.ok && result.reason === "error") {
      await query("delete from public.app_status where chave = 'aviso_teto_molde' and valor ->> 'mes' = $1", [mes]);
    }
  } catch (error) {
    console.error("[molde-jobs] não consegui avisar o teto de gastos:", error instanceof Error ? error.message : error);
  }
}
