import { randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { deleteR2Object, getR2Config, getR2Object, listR2Objects, putR2Object, r2DownloadUrl, R2Error } from "@/lib/content/r2";

/**
 * Cópias de segurança do Molde no R2 (fora do Claude). O banco do artifact do Molde é a única casa dos dados; se ele
 * sumir, a página volta a partir daqui. Sem banco do UaiFlow: o R2 é a lista (nada de migração).
 *
 * Arquivo: uaiflow/molde-backups/<projeto|tudo>/<AAAAMMDD-HHMMSS-mmm>-<20 letras aleatórias>.json.gz
 * O sufixo aleatório impede adivinhar o endereço (o balde do R2 tem endereço público para as mídias dos posts).
 * Guarda as últimas 30 de cada projeto + a mais nova de cada mês dos últimos 12 meses; o resto é apagado a cada cópia nova.
 */

export const BACKUP_PREFIX = "uaiflow/molde-backups/";
const UPLOADS_PREFIX = `${BACKUP_PREFIX}_envios/`;

/** Tamanho máximo do JSON aberto (descomprimido). */
export const MAX_DADOS = 25 * 1024 * 1024;
/** Tamanho máximo de um pedido (o Netlify recusa corpo acima de 6 MB). */
export const MAX_PEDIDO = Math.floor(5.5 * 1024 * 1024);
/** Tamanho máximo de cada parte enviada em pedaços (comprimida, antes do base64). */
export const MAX_PARTE = 3 * 1024 * 1024;
/** Máximo de partes num envio em pedaços. */
export const MAX_PARTES = 12;
/** Tamanho de cada pedaço na leitura (?parte=N): 2 MB comprimidos ≈ 2,7 MB em base64. */
export const PARTE_LEITURA = 2 * 1024 * 1024;

export const KEEP_LATEST = 30;
export const KEEP_MONTHS = 12;
const MAX_DELETES = 100;
const PRUNE_BUDGET_MS = 8000;

export const PROJETO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENVIO = /^[a-z0-9]{16,40}$/;
const ID = /^([a-z0-9]+(?:-[a-z0-9]+)*)--(\d{8}-\d{6}-\d{3})-([a-f0-9]{20})$/;
const FILE = /^(\d{8}-\d{6}-\d{3})-([a-f0-9]{20})\.json\.gz$/;

/** Erro com frase para a dona e um código para o robô/página decidirem sem ler a frase. */
export class BackupError extends Error {
  constructor(message: string, readonly status: number, readonly codigo: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export type BackupItem = { id: string; projeto: string; criadoEm: string; tamanho: number; partes: number };

export function cleanProjeto(value: unknown): string {
  if (value === undefined || value === null || value === "") return "tudo";
  const projeto = String(value).trim().toLowerCase();
  if (projeto.length > 60 || !PROJETO.test(projeto)) {
    throw new BackupError("Projeto inválido: use letras minúsculas, números e hífen (ex.: birdie-lanier), ou deixe vazio para «tudo».", 400, "invalido");
  }
  return projeto;
}

export function stampOf(date: Date) {
  const iso = date.toISOString(); // 2026-10-16T13:05:00.123Z
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}-${iso.slice(20, 23)}`;
}

function dateOfStamp(stamp: string) {
  const [d, t, ms] = stamp.split("-");
  return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.${ms}Z`);
}

export function keyOf(projeto: string, stamp: string, rand: string) {
  return `${BACKUP_PREFIX}${projeto}/${stamp}-${rand}.json.gz`;
}

function itemFromKey(key: string, size: number): BackupItem | null {
  if (!key.startsWith(BACKUP_PREFIX)) return null;
  const [projeto, file, ...rest] = key.slice(BACKUP_PREFIX.length).split("/");
  if (rest.length || !projeto || !PROJETO.test(projeto) || !file) return null;
  const match = file.match(FILE);
  if (!match) return null;
  const criado = dateOfStamp(match[1]);
  if (Number.isNaN(criado.getTime())) return null;
  return { id: `${projeto}--${match[1]}-${match[2]}`, projeto, criadoEm: criado.toISOString(), tamanho: size, partes: Math.max(1, Math.ceil(size / PARTE_LEITURA)) };
}

/** id → chave no R2 (null se o id não tem o formato certo). */
export function keyFromId(id: string) {
  const match = id.match(ID);
  return match ? keyOf(match[1], match[2], match[3]) : null;
}

function needR2() {
  if (!getR2Config()) throw new BackupError("O armazenamento (Cloudflare R2) ainda não foi configurado no UaiFlow: sem ele não dá para guardar cópias.", 503, "sem_r2");
}

/** Falha do R2 vira 502 com frase; os outros erros seguem. */
async function r2<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BackupError) throw error;
    if (error instanceof R2Error || error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) {
      throw new BackupError("O armazenamento (R2) não respondeu direito agora. Tente de novo em alguns minutos.", 502, "r2_falhou");
    }
    throw error;
  }
}

const isGzip = (bytes: Buffer) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

/** Abre o gzip (com teto contra "bomba") e confere que é um JSON de objeto. Devolve o gzip a guardar. */
function checkGzip(gz: Buffer): Buffer {
  let raw: Buffer;
  try {
    raw = gunzipSync(gz, { maxOutputLength: MAX_DADOS });
  } catch (error) {
    if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
      throw new BackupError("A cópia aberta passa de 25 MB. Guarde por projeto.", 413, "grande_demais");
    }
    throw new BackupError("O arquivo comprimido veio estragado (gzip inválido).", 400, "invalido");
  }
  checkJson(raw);
  return gz;
}

function checkJson(raw: Buffer) {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new BackupError("A cópia não é um JSON válido.", 400, "invalido");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BackupError("A cópia precisa ser um objeto JSON ({ … }).", 400, "invalido");
}

function decode64(value: unknown, max: number): Buffer {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/=\s]+$/.test(value)) throw new BackupError("gz64 precisa ser o gzip em base64.", 400, "invalido");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > max) throw new BackupError(`Pedaço grande demais (máximo ${Math.round(max / 1048576)} MB comprimido).`, 413, "grande_demais");
  return bytes;
}

/**
 * Entende o corpo de PUT/POST /api/molde/backup:
 * 1. bytes que começam com gzip (1f 8b) → o JSON comprimido;
 * 2. JSON com "gz64" (texto) → o gzip em base64 (o jeito da ponte do robô, que só leva JSON); "projeto" pode vir junto;
 * 3. qualquer outro objeto JSON → é a própria cópia (o servidor comprime).
 */
export function parseBody(bytes: Buffer, projetoQuery: string | null): { projeto: string; gz: Buffer } {
  if (!bytes.length) throw new BackupError("Corpo vazio: mande a cópia (JSON, gzip ou { gz64 }).", 400, "invalido");
  if (bytes.length > MAX_PEDIDO) throw new BackupError("Pedido grande demais (máximo 5,5 MB): mande em partes por /api/molde/backup/partes.", 413, "grande_demais");
  if (isGzip(bytes)) return { projeto: cleanProjeto(projetoQuery), gz: checkGzip(bytes) };
  if (bytes.length > MAX_DADOS) throw new BackupError("A cópia aberta passa de 25 MB. Guarde por projeto.", 413, "grande_demais");
  let body: unknown;
  try {
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new BackupError("A cópia não é um JSON válido.", 400, "invalido");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BackupError("A cópia precisa ser um objeto JSON ({ … }).", 400, "invalido");
  const record = body as Record<string, unknown>;
  const projeto = cleanProjeto(projetoQuery ?? record.projeto);
  if ("gz64" in record) return { projeto, gz: checkGzip(decode64(record.gz64, MAX_PEDIDO)) };
  return { projeto, gz: gzipSync(bytes) };
}

/** Guarda uma cópia e aplica a regra de quantas ficar. */
export async function saveBackup(projeto: string, gz: Buffer, now = new Date()): Promise<{ item: BackupItem; apagadas: number }> {
  needR2();
  const stamp = stampOf(now);
  const rand = randomBytes(10).toString("hex");
  const key = keyOf(projeto, stamp, rand);
  await r2(() => putR2Object(key, gz, "application/gzip"));
  const apagadas = await r2(() => prune(projeto, now)).catch((error) => {
    console.error("[molde-backup] não consegui apagar as cópias antigas:", error instanceof Error ? error.message : error);
    return 0;
  });
  return { item: itemFromKey(key, gz.length)!, apagadas };
}

/** Quais cópias de um projeto ficam: as 30 mais novas + a mais nova de cada um dos últimos 12 meses. */
export function toKeep(items: BackupItem[], now = new Date()) {
  const sorted = [...items].sort((a, b) => b.id.localeCompare(a.id));
  const months = new Set<string>();
  for (let back = 0; back < KEEP_MONTHS; back += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.add(d.toISOString().slice(0, 7));
  }
  const keep = new Set<string>();
  const seenMonths = new Set<string>();
  sorted.forEach((item, index) => {
    if (index < KEEP_LATEST) keep.add(item.id);
    const month = item.criadoEm.slice(0, 7);
    if (months.has(month) && !seenMonths.has(month)) {
      seenMonths.add(month);
      keep.add(item.id);
    }
  });
  return keep;
}

async function prune(projeto: string, now: Date) {
  const items = (await listR2Objects(`${BACKUP_PREFIX}${projeto}/`))
    .map((obj) => itemFromKey(obj.key, obj.size))
    .filter((item): item is BackupItem => Boolean(item));
  const keep = toKeep(items, now);
  let apagadas = 0;
  const ate = Date.now() + PRUNE_BUDGET_MS; // o resto fica para a próxima cópia (a rota tem 30 s)
  for (const item of items) {
    if (apagadas >= MAX_DELETES || Date.now() > ate) break;
    if (keep.has(item.id)) continue;
    if (await deleteR2Object(keyFromId(item.id)!).catch(() => false)) apagadas += 1;
  }
  // Partes de envios que nunca terminaram (mais de 1 dia).
  const old = (await listR2Objects(UPLOADS_PREFIX, 500)).filter((obj) => now.getTime() - new Date(obj.lastModified).getTime() > 86_400_000);
  for (const obj of old.slice(0, 50)) {
    if (Date.now() > ate) break;
    await deleteR2Object(obj.key).catch(() => false);
  }
  return apagadas;
}

/** Lista as cópias (mais novas primeiro), de um projeto ou de todos. */
export async function listBackups(projeto: string | null): Promise<BackupItem[]> {
  needR2();
  const prefix = projeto ? `${BACKUP_PREFIX}${projeto}/` : BACKUP_PREFIX;
  const objects = await r2(() => listR2Objects(prefix));
  return objects
    .map((obj) => itemFromKey(obj.key, obj.size))
    .filter((item): item is BackupItem => Boolean(item))
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm) || b.id.localeCompare(a.id));
}

async function findBackup(id: string) {
  const key = keyFromId(id);
  if (!key) throw new BackupError("Cópia não encontrada (id inválido).", 404, "nao_encontrada");
  needR2();
  return { key };
}

/** Um pedaço da cópia (gzip em base64), para a ponte do robô, que só leva JSON. */
export async function readBackupPart(id: string, parte: number) {
  const { key } = await findBackup(id);
  const gz = await r2(() => getR2Object(key));
  if (!gz) throw new BackupError("Cópia não encontrada (já foi apagada?).", 404, "nao_encontrada");
  const item = itemFromKey(key, gz.length)!;
  if (!Number.isInteger(parte) || parte < 0 || parte >= item.partes) {
    throw new BackupError(`Parte inválida: esta cópia tem ${item.partes} parte(s) (0 a ${item.partes - 1}).`, 400, "invalido");
  }
  const slice = gz.subarray(parte * PARTE_LEITURA, (parte + 1) * PARTE_LEITURA);
  return { ...item, parte, gz64: slice.toString("base64") };
}

/** Link de 15 minutos para baixar o .json.gz inteiro (ex.: no navegador do computador). */
export async function backupLink(id: string) {
  const { key } = await findBackup(id);
  const found = await r2(() => listR2Objects(key, 1));
  const obj = found.find((entry) => entry.key === key);
  if (!obj) throw new BackupError("Cópia não encontrada (já foi apagada?).", 404, "nao_encontrada");
  return { ...itemFromKey(key, obj.size)!, link: r2DownloadUrl(key, 900), expiraEm: new Date(Date.now() + 900_000).toISOString() };
}

/**
 * Envio em partes (cópia comprimida maior que um pedido): cada parte (≤ 3 MB comprimidos) fica numa pasta temporária;
 * na última, o servidor junta, confere e guarda como uma cópia normal.
 */
export async function savePart(input: { projeto: unknown; envio: unknown; parte: unknown; total: unknown; gz64: unknown }, now = new Date()) {
  const projeto = cleanProjeto(input.projeto);
  const envio = typeof input.envio === "string" ? input.envio : "";
  if (!ENVIO.test(envio)) throw new BackupError("envio precisa ser um código aleatório de 16 a 40 letras minúsculas e números.", 400, "invalido");
  const total = Number(input.total);
  const parte = Number(input.parte);
  if (!Number.isInteger(total) || total < 1 || total > MAX_PARTES) throw new BackupError(`total precisa ser de 1 a ${MAX_PARTES}.`, 400, "invalido");
  if (!Number.isInteger(parte) || parte < 0 || parte >= total) throw new BackupError(`parte precisa ser de 0 a ${total - 1}.`, 400, "invalido");
  const bytes = decode64(input.gz64, MAX_PARTE);
  needR2();
  const folder = `${UPLOADS_PREFIX}${projeto}-${envio}/`;
  const partKey = (n: number) => `${folder}${String(n).padStart(2, "0")}-de-${String(total).padStart(2, "0")}`;
  await r2(() => putR2Object(partKey(parte), bytes, "application/octet-stream"));
  if (parte < total - 1) return { pronto: false as const, envio, parte, total };

  const present = new Set((await r2(() => listR2Objects(folder, 100))).map((obj) => obj.key));
  const faltam = Array.from({ length: total }, (_, n) => n).filter((n) => !present.has(partKey(n)));
  if (faltam.length) throw new BackupError(`Faltam partes deste envio: ${faltam.join(", ")}. Mande as que faltam e a última de novo.`, 409, "faltam_partes", { faltam });
  const parts: Buffer[] = [];
  for (let n = 0; n < total; n += 1) {
    const part = await r2(() => getR2Object(partKey(n)));
    if (!part) throw new BackupError(`Faltam partes deste envio: ${n}.`, 409, "faltam_partes", { faltam: [n] });
    parts.push(part);
  }
  const gz = Buffer.concat(parts);
  if (!isGzip(gz)) throw new BackupError("As partes juntas não formam um gzip (mande os pedaços do arquivo .json.gz, na ordem).", 400, "invalido");
  const saved = await saveBackup(projeto, checkGzip(gz), now);
  for (const key of present) await deleteR2Object(key).catch(() => false);
  return { pronto: true as const, ...saved };
}
