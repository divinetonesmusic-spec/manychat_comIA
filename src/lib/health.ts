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

export type HealthReport = {
  ok: boolean;
  /** Só quando ok = false: o que está errado, em português. */
  motivo?: string;
  relogio: { ultimaVez: string | null; minutos: number | null };
  tokens: { menorPrazoDias: number | null };
};

/** Para a rota pública /api/health: sem segredo, sem @ de conta. */
export async function readHealth(now = new Date()): Promise<HealthReport> {
  const relogio: HealthReport["relogio"] = { ultimaVez: null, minutos: null };
  const tokens: HealthReport["tokens"] = { menorPrazoDias: null };
  let idleMs = 0;
  const bancoFora = { ok: false, motivo: "O banco de dados (Supabase) não respondeu. Confira se o projeto não está pausado.", relogio, tokens };

  // As duas consultas juntas, sob um prazo só (a resposta não pode passar do limite da função do Netlify).
  const consultas = Promise.allSettled([
    query<{ menor: Date | null }>("select min(token_expires_at) as menor from public.instagram_accounts"),
    query<{ atualizado_em: Date }>("select atualizado_em from public.app_status where chave = 'relogio'"),
  ]);
  const resultado = await withTimeout(consultas).catch(() => null);
  if (!resultado) return bancoFora;
  const [tokensResult, batimentoResult] = resultado;

  if (tokensResult.status === "rejected") return bancoFora;
  const menor = tokensResult.value.rows[0]?.menor;
  if (menor) tokens.menorPrazoDias = Math.floor((new Date(menor).getTime() - now.getTime()) / 86_400_000);

  if (batimentoResult.status === "rejected") {
    if ((batimentoResult.reason as { code?: string })?.code === "42P01") {
      return { ok: false, motivo: "Falta aplicar a migração 0004_saude.sql no Supabase (SQL Editor). Sem ela não dá para saber se o relógio está rodando.", relogio, tokens };
    }
    return bancoFora;
  }
  const atualizadoEm = batimentoResult.value.rows[0]?.atualizado_em;
  if (atualizadoEm) {
    const last = new Date(atualizadoEm);
    idleMs = Math.max(0, now.getTime() - last.getTime());
    relogio.ultimaVez = last.toISOString();
    relogio.minutos = Math.floor(idleMs / 60_000);
  }

  if (relogio.minutos === null) {
    return { ok: false, motivo: "O relógio (publicação e fila de mensagens) ainda não rodou nenhuma vez. Confira o pg_cron no Supabase.", relogio, tokens };
  }
  if (idleMs > CLOCK_STALE_MINUTES * 60_000) {
    return { ok: false, motivo: `O relógio (publicação e fila de mensagens) não roda há ${relogio.minutos} minutos. Confira o pg_cron no Supabase.`, relogio, tokens };
  }
  return { ok: true, relogio, tokens };
}

/** Banco lento conta como fora do ar: a resposta não pode passar do limite da função do Netlify. */
function withTimeout<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("tempo esgotado")), DB_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
