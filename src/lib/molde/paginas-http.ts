import { NextResponse } from "next/server";
import { MIGRATION_0020 } from "@/lib/molde/paginas";

/** Pedaços comuns das rotas /api/molde/paginas (respostas em português). Contrato: docs/API_MOLDE_PAGINAS.md. */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function erro(status: number, codigo: string, mensagem: string) {
  return NextResponse.json({ error: mensagem, codigo }, { status });
}

export function falta0020() {
  return erro(503, "falta_0020", MIGRATION_0020);
}

/** O projeto do Molde: letras, números, _ . : - (até 80). Vazio = inválido. */
export function moldeDe(value: unknown) {
  const t = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(t) ? t : "";
}
