import { query } from "@/lib/db/client";
import { capUsd, monthName, monthSpendUsd } from "@/lib/molde/jobs";
import { appLink, sendTelegram, TELEGRAM_TIMEOUT_MS } from "@/lib/notify";

/**
 * Relatório de domingo: 1 mensagem no Telegram por semana (domingo, a partir das 9h no horário de São Paulo) com todos
 * os perfis: posts publicados na semana, o mais visto (pelas insights que o UaiFlow já guardou), cliques dos links
 * rastreados (0006), conversas do Direct respondidas e esperando (0006), posts com erro e os gastos do Molde no mês
 * (0008) contra o teto. O que falta (sem a 0006 ou a 0008) é pulado sem erro.
 * A última semana enviada fica em public.app_status (chave 'relatorio_semanal'): no máximo 1 relatório por domingo
 * (se o Telegram falhar, tenta de novo a cada 10 min, até 5 vezes; reserva que ficou parada 15 min sem `enviadoEm` é liberada).
 * Desligar: RELATORIO_SEMANAL=desligado nas variáveis do servidor.
 */

export const REPORT_HOUR = 9;
const REPORT_TRIES = 5;

type SpParts = { weekday: number; hour: number; dateKey: string };

/** Dia da semana (0 = domingo), hora e data (AAAA-MM-DD) no horário de São Paulo. */
export function saoPauloParts(now: Date): SpParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, hour: Number(get("hour")), dateKey: `${get("year")}-${get("month")}-${get("day")}` };
}

/** Domingo, das 9h em diante (São Paulo). */
export function reportDue(now: Date) {
  const sp = saoPauloParts(now);
  return sp.weekday === 0 && sp.hour >= REPORT_HOUR;
}

export function reportEnabled() {
  return !/^(desligado|0|false|nao|não)$/i.test(process.env.RELATORIO_SEMANAL?.trim() ?? "");
}

type AccountStats = {
  id: string;
  username: string | null;
  publicados: number;
  melhor: { titulo: string; vistas: number; permalink: string | null } | null;
  comErro: number;
  cliques: number | null;
  respondidas: number | null;
  esperando: number | null;
};

const fmtInt = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
const fmtUsd = (value: number) => `US$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

function isMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

/** Junta os números da semana (últimos 7 dias). Sem a 0006 ou a 0008, as partes delas ficam null. */
export async function collectWeeklyStats() {
  const { rows: accounts } = await query<{ id: string; instagram_username: string | null }>(
    "select id, instagram_username from public.instagram_accounts order by is_default desc, instagram_username",
  );
  const stats = new Map<string, AccountStats>(accounts.map((account) => [account.id, {
    id: account.id,
    username: account.instagram_username,
    publicados: 0,
    melhor: null,
    comErro: 0,
    cliques: null,
    respondidas: null,
    esperando: null,
  }]));

  const { rows: posts } = await query<{ account_id: string; publicados: number; com_erro: number }>(
    `select account_id,
            count(*) filter (where status = 'published' and published_at >= now() - interval '7 days')::int as publicados,
            count(*) filter (where status = 'failed' and updated_at >= now() - interval '7 days')::int as com_erro
     from public.content_posts
     where account_id is not null
       and ((status = 'published' and published_at >= now() - interval '7 days') or (status = 'failed' and updated_at >= now() - interval '7 days'))
     group by account_id`,
  );
  for (const row of posts) {
    const item = stats.get(row.account_id);
    if (item) Object.assign(item, { publicados: row.publicados, comErro: row.com_erro });
  }

  // O mais visto da semana: visualizações (views); sem elas, alcance (reach); sem ele, interações.
  const { rows: best } = await query<{ account_id: string; title: string | null; caption: string | null; permalink: string | null; vistas: string }>(
    `select distinct on (account_id) account_id, title, caption, permalink,
            coalesce(nullif(insights ->> 'views', '')::numeric, nullif(insights ->> 'reach', '')::numeric, nullif(insights ->> 'total_interactions', '')::numeric, 0) as vistas
     from public.content_posts
     where status = 'published' and published_at >= now() - interval '7 days' and account_id is not null
     order by account_id, vistas desc, published_at desc`,
  );
  for (const row of best) {
    const item = stats.get(row.account_id);
    const vistas = Number(row.vistas);
    if (!item || !(vistas > 0)) continue;
    const titulo = (row.title?.trim() || (row.caption ?? "").split("\n").map((line) => line.trim()).find(Boolean) || "sem título");
    item.melhor = { titulo: titulo.length > 60 ? `${titulo.slice(0, 59).trimEnd()}…` : titulo, vistas, permalink: row.permalink };
  }

  let temLinks = true;
  try {
    const { rows } = await query<{ account_id: string; cliques: number }>(
      `select l.account_id, count(*)::int as cliques
       from public.link_clicks c join public.tracked_links l on l.id = c.link_id
       where c.clicked_at >= now() - interval '7 days' and l.account_id is not null
       group by l.account_id`,
    );
    for (const item of stats.values()) item.cliques = 0;
    for (const row of rows) {
      const item = stats.get(row.account_id);
      if (item) item.cliques = row.cliques;
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
    temLinks = false;
  }

  try {
    const { rows } = await query<{ account_id: string; respondidas: number; esperando: number }>(
      `select d.account_id,
              count(*) filter (where d.status = 'enviada' and d.updated_at >= now() - interval '7 days')::int as respondidas,
              count(*) filter (where d.status = 'aguardando' and c.opted_out_at is null and c.last_response_at > now() - interval '24 hours')::int as esperando
       from public.dm_pending d left join public.contacts c on c.id = d.contact_id
       where d.account_id is not null and (d.status = 'aguardando' or d.updated_at >= now() - interval '7 days')
       group by d.account_id`,
    );
    for (const item of stats.values()) Object.assign(item, { respondidas: 0, esperando: 0 });
    for (const row of rows) {
      const item = stats.get(row.account_id);
      if (item) Object.assign(item, { respondidas: row.respondidas, esperando: row.esperando });
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  let gastos: { gastoUsd: number; tetoUsd: number } | null = null;
  try {
    gastos = { gastoUsd: await monthSpendUsd(), tetoUsd: capUsd() };
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  return { contas: [...stats.values()], temLinks, gastos };
}

/** "5 a 11 de outubro" (ou "28 de setembro a 4 de outubro"). */
export function weekRangeText(now: Date) {
  const start = new Date(now.getTime() - 6 * 86_400_000);
  const day = (date: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric" }).format(date);
  const month = (date: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long" }).format(date);
  return month(start) === month(now) ? `${day(start)} a ${day(now)} de ${month(now)}` : `${day(start)} de ${month(start)} a ${day(now)} de ${month(now)}`;
}

export function weeklyReportText(data: Awaited<ReturnType<typeof collectWeeklyStats>>, now: Date, origin?: string | null) {
  const lines = [`UaiFlow: resumo da semana (${weekRangeText(now)}).`];
  if (!data.contas.length) lines.push("", "Nenhum perfil do Instagram conectado.");
  for (const conta of data.contas) {
    lines.push("", conta.username ? `@${conta.username}` : "Perfil sem nome");
    if (!conta.publicados) {
      lines.push("- Nenhum post publicado nesta semana.");
    } else {
      const melhor = conta.melhor
        ? ` O mais visto: «${conta.melhor.titulo}» (${plural(conta.melhor.vistas, "visualização", "visualizações")})${conta.melhor.permalink ? ` ${conta.melhor.permalink}` : ""}`
        : "";
      lines.push(`- ${plural(conta.publicados, "post publicado", "posts publicados")}.${melhor}`);
    }
    if (conta.cliques !== null) {
      lines.push(conta.cliques ? `- ${plural(conta.cliques, "clique", "cliques")} nos seus links.` : "- Nenhum clique nos seus links.");
    }
    if (conta.respondidas !== null && conta.esperando !== null) {
      const respondidas = conta.respondidas ? `${plural(conta.respondidas, "conversa respondida", "conversas respondidas")} no Direct` : "Nenhuma conversa respondida pelo Molde no Direct";
      const esperando = conta.esperando ? `; ${plural(conta.esperando, "esperando", "esperando")} resposta agora` : "";
      lines.push(`- ${respondidas}${esperando}.`);
    }
    if (conta.comErro) lines.push(`- ${plural(conta.comErro, "post com erro", "posts com erro")}: abra o UaiFlow para ver.`);
  }
  if (data.gastos) {
    const { gastoUsd, tetoUsd } = data.gastos;
    const pct = tetoUsd > 0 ? ` (${Math.round((gastoUsd / tetoUsd) * 100)}%)` : "";
    lines.push("", `Gastos do Molde em ${monthName(now)}: ${fmtUsd(gastoUsd)} de ${fmtUsd(tetoUsd)}${pct}.`);
  }
  const link = appLink("/dashboard", origin);
  if (link) lines.push("", `Abra: ${link}`);
  return lines.join("\n");
}

/**
 * Desfaz a reserva do envio desta semana (o relatório não saiu). `semGastar`: devolve a tentativa e libera na hora
 * (faltou tempo antes de mandar); senão a próxima tentativa espera os 10 min de sempre.
 */
async function releaseReservation(semana: string, semGastar: boolean) {
  await query(
    `update public.app_status
     set valor = valor || jsonb_build_object('enviado', false, 'tentativas',
                   case when $2 then greatest(coalesce((valor ->> 'tentativas')::int, 1) - 1, 0) else coalesce((valor ->> 'tentativas')::int, 1) end),
         atualizado_em = case when $2 then now() - interval '1 hour' else now() end
     where chave = 'relatorio_semanal' and valor ->> 'semana' = $1`,
    [semana, semGastar],
  ).catch((error) => console.error("[relatorio] não consegui desfazer a reserva:", error instanceof Error ? error.message : error));
}

export type WeeklyReportResult = { sent: boolean; motivo?: "desligado" | "sem_telegram" | "fora_da_hora" | "ja_enviado" | "sem_tempo" | "sem_migracao" | "erro" };

/**
 * Manda o relatório se for a hora (domingo 9h+ em São Paulo) e se ainda não foi mandado neste domingo. Nunca lança.
 * `force` (só os testes e quem chama de propósito) ignora o dia e a hora, mas não o "já enviado".
 */
export async function maybeSendWeeklyReport(options: { now?: Date; deadline?: number; origin?: string | null; force?: boolean } = {}): Promise<WeeklyReportResult> {
  const now = options.now ?? new Date();
  if (!reportEnabled()) return { sent: false, motivo: "desligado" };
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim() || !process.env.TELEGRAM_CHAT_ID?.trim()) return { sent: false, motivo: "sem_telegram" };
  if (!options.force && !reportDue(now)) return { sent: false, motivo: "fora_da_hora" };
  const deadline = options.deadline ?? Date.now() + TELEGRAM_TIMEOUT_MS + 2000;
  if (deadline - Date.now() < 1500) return { sent: false, motivo: "sem_tempo" };
  const semana = saoPauloParts(now).dateKey;

  try {
    // Reserva o envio desta semana (só um relógio manda) já como "enviado": se o Telegram aceitar e o banco cair logo
    // depois, o relatório não sai duas vezes. Se o Telegram falhar, a reserva é desfeita e o próximo relógio tenta de
    // novo em 10 min (até 5 vezes); se faltar tempo antes de mandar, desfaz sem gastar tentativa.
    // A reserva guarda `reservadoEm`; o envio feito grava `enviadoEm`. Reserva parada, sem `enviadoEm`, há mais de 15 min
    // (o processo morreu antes de mandar) é liberada para outra tentativa, dentro do mesmo limite de tentativas.
    const claimed = await query(
      `insert into public.app_status (chave, valor, atualizado_em)
       values ('relatorio_semanal', jsonb_build_object('semana', $1::text, 'enviado', true, 'tentativas', 1, 'reservadoEm', now()), now())
       on conflict (chave) do update set
         valor = jsonb_build_object('semana', $1::text, 'enviado', true, 'reservadoEm', now(), 'tentativas',
                   case when public.app_status.valor ->> 'semana' = $1 then coalesce((public.app_status.valor ->> 'tentativas')::int, 0) + 1 else 1 end),
         atualizado_em = now()
       where public.app_status.valor ->> 'semana' is distinct from $1
          or (coalesce((public.app_status.valor ->> 'tentativas')::int, 0) < $2
              and (
                (coalesce((public.app_status.valor ->> 'enviado')::boolean, false) = false
                  and public.app_status.atualizado_em < now() - interval '10 minutes')
                or (coalesce((public.app_status.valor ->> 'enviado')::boolean, false) = true
                  and public.app_status.valor ->> 'enviadoEm' is null
                  and public.app_status.valor ->> 'reservadoEm' is not null
                  and (public.app_status.valor ->> 'reservadoEm')::timestamptz < now() - interval '15 minutes')
              ))
       returning chave`,
      [semana, REPORT_TRIES],
    );
    if (!claimed.rowCount) return { sent: false, motivo: "ja_enviado" };

    let text: string;
    try {
      text = weeklyReportText(await collectWeeklyStats(), now, options.origin);
    } catch (error) {
      await releaseReservation(semana, false);
      throw error;
    }
    const timeoutMs = Math.min(TELEGRAM_TIMEOUT_MS, deadline - Date.now() - 300);
    if (timeoutMs < 500) {
      await releaseReservation(semana, true);
      return { sent: false, motivo: "sem_tempo" };
    }
    const result = await sendTelegram(text, { timeoutMs });
    if (!result.ok) {
      await releaseReservation(semana, false);
      return { sent: false, motivo: "erro" };
    }
    // O horário do envio impede a liberação da reserva (acima). Duas tentativas: sem ele, em 15 min o relatório sairia de novo.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const saved = await query(
        "update public.app_status set valor = valor || jsonb_build_object('enviadoEm', now()) where chave = 'relatorio_semanal' and valor ->> 'semana' = $1",
        [semana],
      ).catch(() => null);
      if (saved) break;
    }
    return { sent: true };
  } catch (error) {
    if (isMissing(error)) return { sent: false, motivo: "sem_migracao" };
    console.error("[relatorio] não consegui montar o relatório da semana:", error instanceof Error ? error.message : error);
    return { sent: false, motivo: "erro" };
  }
}
