import { NextResponse } from "next/server";
import { isMissing0008, JOB_STATES, MISSING_0008, type JobPreview, type JobState } from "@/lib/molde/jobs";

/** Pedaços comuns das rotas /api/molde/jobs (validação e respostas em português). */

/** Frase que a página manda para liberar um trabalho a passar do teto de gastos do mês (só depois de a dona confirmar). */
export const FORCE_PHRASE = "passar do teto";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TIPO = /^[a-z][a-z0-9_]{1,39}$/;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_URL = 1000;

export function answer(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Erro inesperado (ou a 0008 faltando) nas rotas: frase em português, sem detalhe interno. */
export function failure(error: unknown, contexto: string) {
  if (isMissing0008(error)) return answer(MISSING_0008, 503);
  console.error(`[molde-jobs] ${contexto}:`, error instanceof Error ? error.message : error);
  return answer("Não consegui fazer isso agora. Tente de novo em instantes.", 500);
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean && Array.from(clean).length <= max ? clean : null;
}

/** Objeto JSON de até 64 KB (payload, resultado). `undefined` = não veio; `null` = veio errado. */
export function jsonObject(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Buffer.byteLength(JSON.stringify(value)) <= MAX_JSON_BYTES ? (value as Record<string, unknown>) : null;
}

/** Nome do Mac que pediu (1–80 letras). */
export function workerName(value: unknown) {
  return text(value, 80);
}

export function parseStates(value: string | null): JobState[] | null | "invalid" {
  if (!value) return null;
  const states = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!states.every((state) => (JOB_STATES as readonly string[]).includes(state))) return "invalid";
  return states as JobState[];
}

function httpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_URL) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Prévia para aprovar: texto (até 2000 letras) e links https (imagem, vídeo, áudio, link). Pelo menos um. */
export function parsePreview(value: unknown): JobPreview | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Mande a prévia (previa) com texto ou um link." };
  const raw = value as Record<string, unknown>;
  const previa: JobPreview = {};
  if (raw.texto !== undefined && raw.texto !== null && raw.texto !== "") {
    const texto = text(raw.texto, 2000);
    if (!texto) return { error: "O texto da prévia precisa ter até 2000 letras." };
    previa.texto = texto;
  }
  for (const key of ["imagem", "video", "audio", "link"] as const) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
    const url = httpsUrl(raw[key]);
    if (!url) return { error: `O link da prévia (${key}) precisa começar com https://.` };
    previa[key] = url;
  }
  if (!Object.keys(previa).length) return { error: "Mande a prévia (previa) com texto ou um link." };
  return previa;
}
