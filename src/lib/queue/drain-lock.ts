import { Client } from "pg";
import { requireEnv } from "@/lib/env";

/**
 * Trava do relógio: só um /api/queue/drain roda por vez (o do pg_cron e os que cada webhook dispara concorriam e podiam
 * passar do limite de 200 DMs por hora). Usa uma trava do próprio Postgres (pg_try_advisory_xact_lock) numa conexão
 * separada, dentro de uma transação aberta enquanto o relógio trabalha: funciona também pelo pooler de transação do
 * Supabase (porta 6543) e solta sozinha se a função cair (a conexão fecha e a transação acaba).
 * A conexão é separada do pool do app de propósito: com DATABASE_POOL_MAX=1, segurar a conexão do pool travaria o resto.
 */
export const DRAIN_LOCK_KEY = 7_726_001;
/** Trava só do envio da fila (os disparos de cada comentário): um por vez entre si, sem segurar o relógio do minuto. */
export const FILA_LOCK_KEY = 7_726_002;

export type DrainLockResult<T> = { ran: true; result: T } | { ran: false };

export async function withDrainLock<T>(work: () => Promise<T>, key: number = DRAIN_LOCK_KEY): Promise<DrainLockResult<T>> {
  let client: Client | null = new Client({
    connectionString: requireEnv("DATABASE_URL"),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 3000,
  });
  client.on("error", () => undefined); // queda da conexão da trava não pode derrubar o relógio

  try {
    await client.connect();
    await client.query("begin");
    // Prazos da transação da trava: se a função cair sem fechar a conexão, o banco solta a trava em 30 s (o relógio
    // inteiro leva ~9 s; o Netlify corta em 10–30 s). Nenhum comando nela pode passar de 5 s.
    await client.query("set local idle_in_transaction_session_timeout = '30s'");
    await client.query("set local statement_timeout = '5s'");
    const { rows } = await client.query<{ ok: boolean }>("select pg_try_advisory_xact_lock($1) as ok", [key]);
    if (!rows[0]?.ok) {
      await closeLockClient(client, "rollback");
      return { ran: false };
    }
  } catch (error) {
    // Sem conseguir a trava (banco cheio de conexões, por exemplo), o relógio roda como antes: melhor que parar tudo.
    console.warn("[relogio] não consegui pegar a trava do relógio; rodando sem ela:", error instanceof Error ? error.message : error);
    await closeLockClient(client, null);
    client = null;
  }

  try {
    return { ran: true, result: await work() };
  } finally {
    if (client) await closeLockClient(client, "commit");
  }
}

async function closeLockClient(client: Client, finish: "commit" | "rollback" | null) {
  if (finish) await client.query(finish).catch(() => undefined);
  await client.end().catch(() => undefined);
}
