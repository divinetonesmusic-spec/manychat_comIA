import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Banco de teste: cada arquivo de teste cria um banco novo (vazio) no Postgres apontado por
 * TEST_DATABASE_URL, aplica supabase/migrations/*.sql em ordem e apaga o banco no fim.
 * Sem TEST_DATABASE_URL, os testes de banco são pulados (os de unidade continuam rodando).
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "";

/** Motivo do "pulado" (ou false quando há banco). Use em describe(..., { skip: semBanco }). */
export const semBanco: string | false = TEST_DATABASE_URL
  ? false
  : "sem TEST_DATABASE_URL: teste com banco pulado (veja tests/README.md)";

if (!TEST_DATABASE_URL) {
  console.warn("[aviso] TEST_DATABASE_URL não definida: os testes que precisam de Postgres serão pulados.");
}

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/** O que o Supabase já traz pronto e as migrações usam (auth.users e auth.uid()). */
const SUPABASE_STUB = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`;

export type TestDatabase = {
  url: string;
  name: string;
  /** Consulta direta (fora do app), para preparar dados e conferir resultados. */
  sql: <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<T[]>;
  close: () => Promise<void>;
};

export function listMigrations() {
  return readdirSync(MIGRATIONS_DIR).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
}

/**
 * Cria o banco de teste e aponta process.env.DATABASE_URL para ele.
 * Chame ANTES de importar módulos do app que usam o banco (o pool lê DATABASE_URL ao carregar).
 * `ate`: aplica só as migrações com número menor ou igual (ex.: "0002" para simular a 0003 não aplicada).
 */
export async function createTestDatabase(options: { ate?: string } = {}): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL não definida.");
  const name = `uaiflow_teste_${process.pid}_${randomBytes(4).toString("hex")}`;

  const admin = new pg.Client({ connectionString: withSslDefault(TEST_DATABASE_URL) });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const url = new URL(withSslDefault(TEST_DATABASE_URL));
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });

  await pool.query(SUPABASE_STUB);
  for (const file of listMigrations()) {
    if (options.ate && file.slice(0, 4) > options.ate) continue;
    await pool.query(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  process.env.DATABASE_URL = url.toString();

  return {
    url: url.toString(),
    name,
    sql: async (text, params = []) => (await pool.query(text, params)).rows,
    close: async () => {
      await pool.end();
      const appPool = (globalThis as { postgresPool?: pg.Pool }).postgresPool;
      await appPool?.end().catch(() => undefined);
      const cleaner = new pg.Client({ connectionString: withSslDefault(TEST_DATABASE_URL) });
      await cleaner.connect();
      try {
        await cleaner.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await cleaner.end();
      }
    },
  };
}

/** Postgres local normalmente não tem SSL; o app pede SSL, então o padrão dos testes é desligar. */
function withSslDefault(value: string) {
  const url = new URL(value);
  if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "disable");
  return url.toString();
}
