import { createHash, createHmac, randomUUID } from "node:crypto";

/**
 * Cloudflare R2 (compatível com S3) sem SDK: links assinados (SigV4) para o navegador ou o robô do Mac
 * enviarem o vídeo direto para o R2, e para apagar a mídia depois de publicada.
 */

type SignInput = {
  method: "GET" | "PUT" | "DELETE";
  host: string;
  path: string; // já começando com "/"
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresSeconds: number;
  now?: Date;
  /**
   * Cabeçalhos que entram na assinatura além do host (ex.: content-length). Quem usar o link tem que mandar exatamente
   * esses valores; senão o R2 recusa (403 SignatureDoesNotMatch).
   */
  headers?: Record<string, string>;
  /** Parâmetros extras da query (ex.: list-type=2 e prefix para listar uma pasta). Entram na assinatura. */
  query?: Record<string, string>;
};

const encode = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();
const sha256 = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");

function amzDates(now: Date) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20130524T000000Z
  return { amzDate: iso, shortDate: iso.slice(0, 8) };
}

/** Gera uma URL pré-assinada (AWS Signature V4, assinatura na query string). */
export function presignUrl(input: SignInput) {
  const { amzDate, shortDate } = amzDates(input.now ?? new Date());
  const scope = `${shortDate}/${input.region}/${input.service}/aws4_request`;
  const headers: Record<string, string> = { host: input.host };
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = String(value).trim();
  const headerNames = Object.keys(headers).sort();
  const signedHeaders = headerNames.join(";");
  const query: Record<string, string> = {
    ...(input.query ?? {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${encode(key)}=${encode(query[key])}`)
    .join("&");
  const canonicalPath = input.path.split("/").map((segment) => encode(decodeURIComponent(segment))).join("/");
  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery,
    headerNames.map((name) => `${name}:${headers[name]}\n`).join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, shortDate);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return `https://${input.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl: publicBaseUrl.replace(/\/$/, "") };
}

/**
 * Configuração do R2 para as cópias de segurança do Molde. Com `R2_BACKUP_BUCKET` (as mesmas credenciais, outro balde),
 * as cópias ficam num balde PRIVADO, sem domínio público; sem ela, caem no balde das mídias (R2_BUCKET), como antes.
 * O balde privado não precisa de `R2_PUBLIC_BASE_URL`.
 */
export function getR2BackupConfig(): R2Config | null {
  const bucket = process.env.R2_BACKUP_BUCKET?.trim();
  if (!bucket) return getR2Config();
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl: "" };
}

function r2Request(config: R2Config, method: SignInput["method"], key: string, expiresSeconds: number, headers?: Record<string, string>, query?: Record<string, string>) {
  return presignUrl({
    method,
    host: `${config.accountId}.r2.cloudflarestorage.com`,
    path: key ? `/${config.bucket}/${key}` : `/${config.bucket}`,
    query,
    region: "auto",
    service: "s3",
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresSeconds,
    headers,
  });
}

const ALLOWED_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Áudio só serve de prévia de aprovação (pasta molde-previas): nunca vai para um post. */
const PREVIEW_AUDIO_TYPES: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};
export const PREVIEW_FOLDER = "molde-previas";

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB (limite de Reel na API é bem menor; isto só evita abuso)

export function cleanFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "arquivo";
}

/**
 * Cria a chave do arquivo e os links: upload (PUT, 1 h) e o endereço público que a Meta vai ler.
 * O tamanho (`size`, em bytes) é obrigatório e vai assinado no link (content-length): o R2 só aceita um arquivo
 * exatamente desse tamanho. O navegador e o robô do Mac mandam o tamanho certo sozinhos ao enviar o arquivo.
 */
export function createUploadTarget(input: { fileName: string; contentType: string; size?: number; folder?: string }) {
  const config = getR2Config();
  if (!config) throw new Error("O armazenamento de mídia (Cloudflare R2) ainda não foi configurado.");
  const folder = cleanFileName(input.folder || "geral");
  const extension = ALLOWED_TYPES[input.contentType] ?? (folder === PREVIEW_FOLDER ? PREVIEW_AUDIO_TYPES[input.contentType] : undefined);
  if (!extension) {
    throw new Error(folder === PREVIEW_FOLDER
      ? "Tipo de arquivo não aceito. Use MP4, MOV, JPG, PNG, WEBP, M4A ou MP3."
      : "Tipo de arquivo não aceito. Use MP4, MOV, JPG, PNG ou WEBP.");
  }
  const size = input.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) throw new Error("Falta o tamanho do arquivo (size, em bytes).");
  if (size > MAX_UPLOAD_BYTES) throw new Error("Arquivo grande demais (máximo 1 GB).");

  const month = new Date().toISOString().slice(0, 7);
  const base = cleanFileName(input.fileName.replace(/\.[a-z0-9]+$/i, ""));
  const key = `uaiflow/${folder}/${month}/${randomUUID().slice(0, 8)}-${base}.${extension}`;

  return {
    key,
    uploadUrl: r2Request(config, "PUT", key, 3600, { "content-length": String(size) }),
    size,
    publicUrl: `${config.publicBaseUrl}/${key.split("/").map(encode).join("/")}`,
    contentType: input.contentType,
  };
}

/** Quanto um DELETE no R2 pode esperar (o relógio e as rotas têm orçamento curto). */
export const R2_DELETE_TIMEOUT_MS = 2000;

/** Apaga um arquivo do R2 (usado depois que o post já foi publicado). Desiste em 2 s (erro de prazo: quem chama trata). */
export async function deleteR2Object(key: string, timeoutMs = R2_DELETE_TIMEOUT_MS, onConfig?: R2Config) {
  const config = onConfig ?? getR2Config();
  if (!config) return false;
  const response = await fetch(r2Request(config, "DELETE", key, 300), { method: "DELETE", signal: AbortSignal.timeout(Math.max(100, timeoutMs)) });
  return response.ok || response.status === 404;
}

/** Prints mandados no formulário de depoimento (0011). Privados: o painel abre por link com prazo. */
export const PASTA_PRINTS_DEPOIMENTO = "uaiflow/depoimentos";

/** Vídeos de resposta da DM (Molde v133, 0014): ficam enquanto o post estiver respondendo; nunca saem com o post. */
export const DMVIDEOS_FOLDER = "molde-dmvideos";

/** Prefixos do R2 que NÃO são mídia de post: cópias de segurança do Molde, prévias de aprovação, prints de depoimento e vídeos de resposta da DM. */
const NOT_POST_MEDIA = ["uaiflow/molde-backups/", `uaiflow/${PREVIEW_FOLDER}/`, `${PASTA_PRINTS_DEPOIMENTO}/`, `uaiflow/${DMVIDEOS_FOLDER}/`];

/** true = a chave é de cópia de segurança ou prévia: um post nunca apaga isto. */
export function isProtectedKey(key: string) {
  return NOT_POST_MEDIA.some((prefix) => key.startsWith(prefix));
}

/** Descobre a chave a partir do endereço público (para posts antigos que não guardaram media_keys). */
export function keyFromPublicUrl(url: string) {
  const config = getR2Config();
  if (!config || !url.startsWith(`${config.publicBaseUrl}/`)) return null;
  return decodeURIComponent(url.slice(config.publicBaseUrl.length + 1));
}

/* ---------- Arquivos privados do servidor (cópias de segurança do Molde): enviar, ler, listar ---------- */

export class R2Error extends Error {}

function needConfig(config?: R2Config) {
  const found = config ?? getR2Config();
  if (!found) throw new R2Error("O armazenamento (Cloudflare R2) ainda não foi configurado.");
  return found;
}

/** Opções comuns das operações abaixo: outro balde (cópias do Molde) e o prazo desta chamada. */
export type R2Options = { config?: R2Config; timeoutMs?: number };

/** Guarda um arquivo no R2 (o servidor envia direto, sem link para ninguém). */
export async function putR2Object(key: string, body: Buffer, contentType: string, options: R2Options = {}) {
  const config = needConfig(options.config);
  const response = await fetch(r2Request(config, "PUT", key, 300), {
    method: "PUT",
    headers: { "content-type": contentType, "content-length": String(body.length) },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(Math.max(100, options.timeoutMs ?? 20_000)),
  });
  if (!response.ok) throw new R2Error(`O R2 recusou guardar o arquivo (${response.status}).`);
}

/** Lê um arquivo do R2. null = não existe. */
export async function getR2Object(key: string, options: R2Options = {}): Promise<Buffer | null> {
  const config = needConfig(options.config);
  const response = await fetch(r2Request(config, "GET", key, 300), { method: "GET", signal: AbortSignal.timeout(Math.max(100, options.timeoutMs ?? 20_000)) });
  if (response.status === 404) return null;
  if (!response.ok) throw new R2Error(`O R2 não entregou o arquivo (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

/** Link de leitura com prazo (para baixar no computador). */
export function r2DownloadUrl(key: string, expiresSeconds: number, config?: R2Config) {
  return r2Request(needConfig(config), "GET", key, expiresSeconds);
}

export type R2Listed = { key: string; size: number; lastModified: string };

const xmlText = (value: string) =>
  value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * Lista os arquivos de uma pasta (ListObjectsV2), até `max` arquivos. `timeoutMs` vale para cada página (padrão 15 s);
 * `deadline` (Date.now() em ms) é o prazo da listagem inteira: passou dele, a listagem para com o que já tem.
 */
export async function listR2Objects(prefix: string, max = 5000, options: R2Options & { deadline?: number } = {}): Promise<R2Listed[]> {
  const config = needConfig(options.config);
  const items: R2Listed[] = [];
  let token: string | null = null;
  for (let page = 0; page < 20 && items.length < max; page += 1) {
    const perPage = Math.min(options.timeoutMs ?? 15_000, options.deadline ? options.deadline - Date.now() : Infinity);
    if (perPage < 200) throw new R2Error("Sem tempo para listar a pasta do R2.");
    const query: Record<string, string> = { "list-type": "2", prefix, "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const response = await fetch(r2Request(config, "GET", "", 300, undefined, query), { method: "GET", signal: AbortSignal.timeout(perPage) });
    if (!response.ok) throw new R2Error(`O R2 não listou a pasta (${response.status}).`);
    const xml = await response.text();
    for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
      const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      if (!key) continue;
      items.push({
        key: xmlText(key),
        size: Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
        lastModified: block.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] ?? "",
      });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? null) : null;
    if (!token) break;
  }
  return items.slice(0, max);
}
