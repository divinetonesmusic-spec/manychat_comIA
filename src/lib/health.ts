import { query } from "@/lib/db/client";

/** O relógio roda a cada 1–2 min; sem batimento há mais que isto, algo parou. */
export const CLOCK_STALE_MINUTES = 15;
/** Prazo único para as consultas do /api/health. */
const DB_TIMEOUT_MS = 4000;

/**
 * Grava o batimento do relógio (chave 'relogio' em public.app_status, migração 0004).
 * Uma consulta só. Qualquer falha é ignorada: sem a 0004 (ou com o banco instável) o relógio segue normal.
 */
export async function recordClockBeat(valor: Record<string, unknown> = {}) {
  try {
    await query(
      `insert into public.app_status (chave, valor, atualizado_em) values ('relogio', $1::jsonb, now())
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
      [JSON.stringify(valor)],
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * O relógio foi chamado, mas saiu sem trabalhar porque outro estava rodando (trava do relógio). Conta quantas vezes
 * seguidas isso aconteceu desde o último batimento (chave 'relogio_pulado'). Normal de vez em quando (o webhook também
 * chama o relógio); muitas seguidas sem batimento = trava presa. Falha ignorada.
 */
export async function recordClockSkipped() {
  try {
    await query(
      `insert into public.app_status (chave, valor, atualizado_em) values ('relogio_pulado', '{"seguidas":1}'::jsonb, now())
       on conflict (chave) do update set
         valor = jsonb_build_object('seguidas',
           case when public.app_status.atualizado_em > coalesce((select s.atualizado_em from public.app_status s where s.chave = 'relogio'), '-infinity'::timestamptz)
                then coalesce((public.app_status.valor ->> 'seguidas')::int, 0) + 1 else 1 end),
         atualizado_em = now()`,
    );
    return true;
  } catch {
    return false;
  }
}

export type HealthReport = {
  ok: boolean;
  /** Só quando ok = false: o que está errado, em português. */
  motivo?: string;
  relogio: { ultimaVez: string | null; minutos: number | null };
  tokens: { menorPrazoDias: number | null };
  /** Última vez que o robô do Mac pediu trabalho à fila do Molde (0008): o "Mac acordado". Não muda o `ok`. */
  mac: { ultimaVez: string | null; minutos: number | null };
};

/** Para a rota pública /api/health: sem segredo, sem @ de conta. */
export async function readHealth(now = new Date()): Promise<HealthReport> {
  const relogio: HealthReport["relogio"] = { ultimaVez: null, minutos: null };
  const tokens: HealthReport["tokens"] = { menorPrazoDias: null };
  const mac: HealthReport["mac"] = { ultimaVez: null, minutos: null };
  let idleMs = 0;
  const bancoFora = { ok: false, motivo: "O banco de dados (Supabase) não respondeu. Confira se o projeto não está pausado.", relogio, tokens, mac };

  // As duas consultas juntas, sob um prazo só (a resposta não pode passar do limite da função do Netlify).
  const consultas = Promise.allSettled([
    query<{ menor: Date | null }>("select min(token_expires_at) as menor from public.instagram_accounts"),
    query<{ chave: string; atualizado_em: Date; valor: { seguidas?: number } }>("select chave, atualizado_em, valor from public.app_status where chave in ('relogio', 'relogio_pulado', 'molde_mac')"),
  ]);
  const resultado = await withTimeout(consultas).catch(() => null);
  if (!resultado) return bancoFora;
  const [tokensResult, batimentoResult] = resultado;

  if (tokensResult.status === "rejected") return bancoFora;
  const menor = tokensResult.value.rows[0]?.menor;
  if (menor) tokens.menorPrazoDias = Math.floor((new Date(menor).getTime() - now.getTime()) / 86_400_000);

  if (batimentoResult.status === "rejected") {
    if ((batimentoResult.reason as { code?: string })?.code === "42P01") {
      return { ok: false, motivo: "Falta aplicar a migração 0004_saude.sql no Supabase (SQL Editor). Sem ela não dá para saber se o relógio está rodando.", relogio, tokens, mac };
    }
    return bancoFora;
  }
  const batimento = batimentoResult.value.rows.find((row) => row.chave === "relogio");
  const pulado = batimentoResult.value.rows.find((row) => row.chave === "relogio_pulado");
  const macRow = batimentoResult.value.rows.find((row) => row.chave === "molde_mac");
  if (macRow?.atualizado_em) {
    const last = new Date(macRow.atualizado_em);
    mac.ultimaVez = last.toISOString();
    mac.minutos = Math.floor(Math.max(0, now.getTime() - last.getTime()) / 60_000);
  }
  const atualizadoEm = batimento?.atualizado_em;
  if (atualizadoEm) {
    const last = new Date(atualizadoEm);
    idleMs = Math.max(0, now.getTime() - last.getTime());
    relogio.ultimaVez = last.toISOString();
    relogio.minutos = Math.floor(idleMs / 60_000);
  }

  if (relogio.minutos === null) {
    return { ok: false, motivo: "O relógio (publicação e fila de mensagens) ainda não rodou nenhuma vez. Confira o pg_cron no Supabase.", relogio, tokens, mac };
  }
  if (idleMs > CLOCK_STALE_MINUTES * 60_000) {
    // Chamado nos últimos minutos, mas saindo sem trabalhar: a trava do relógio ficou presa (não é o pg_cron).
    const puladoRecente = pulado && new Date(pulado.atualizado_em).getTime() > (atualizadoEm ? new Date(atualizadoEm).getTime() : 0)
      && now.getTime() - new Date(pulado.atualizado_em).getTime() < CLOCK_STALE_MINUTES * 60_000;
    if (puladoRecente && (pulado.valor?.seguidas ?? 0) >= 3) {
      return {
        ok: false,
        motivo: `O relógio está sendo chamado, mas não trabalha há ${relogio.minutos} minutos: saiu ${pulado.valor?.seguidas} vezes seguidas porque "outro relógio já está rodando". A trava pode ter ficado presa no banco; ela costuma soltar sozinha em 1 minuto. Se continuar, reinicie o projeto no Supabase (Project Settings → General → Restart project).`,
        relogio,
        tokens,
        mac,
      };
    }
    return { ok: false, motivo: `O relógio (publicação e fila de mensagens) não roda há ${relogio.minutos} minutos. Confira o pg_cron no Supabase.`, relogio, tokens, mac };
  }
  return { ok: true, relogio, tokens, mac };
}

/** Banco lento conta como fora do ar: a resposta não pode passar do limite da função do Netlify. */
function withTimeout<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("tempo esgotado")), DB_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
