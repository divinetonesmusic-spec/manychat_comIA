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
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": "host",
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
    `host:${input.host}\n`,
    "host",
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

function r2Request(config: R2Config, method: SignInput["method"], key: string, expiresSeconds: number) {
  return presignUrl({
    method,
    host: `${config.accountId}.r2.cloudflarestorage.com`,
    path: `/${config.bucket}/${key}`,
    region: "auto",
    service: "s3",
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresSeconds,
  });
}

const ALLOWED_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

/** Cria a chave do arquivo e os links: upload (PUT, 1 h) e o endereço público que a Meta vai ler. */
export function createUploadTarget(input: { fileName: string; contentType: string; size?: number; folder?: string }) {
  const config = getR2Config();
  if (!config) throw new Error("O armazenamento de mídia (Cloudflare R2) ainda não foi configurado.");
  const extension = ALLOWED_TYPES[input.contentType];
  if (!extension) throw new Error("Tipo de arquivo não aceito. Use MP4, MOV, JPG, PNG ou WEBP.");
  if (input.size && input.size > MAX_UPLOAD_BYTES) throw new Error("Arquivo grande demais (máximo 1 GB).");

  const month = new Date().toISOString().slice(0, 7);
  const base = cleanFileName(input.fileName.replace(/\.[a-z0-9]+$/i, ""));
  const folder = cleanFileName(input.folder || "geral");
  const key = `uaiflow/${folder}/${month}/${randomUUID().slice(0, 8)}-${base}.${extension}`;

  return {
    key,
    uploadUrl: r2Request(config, "PUT", key, 3600),
    publicUrl: `${config.publicBaseUrl}/${key.split("/").map(encode).join("/")}`,
    contentType: input.contentType,
  };
}

/** Apaga um arquivo do R2 (usado depois que o post já foi publicado). */
export async function deleteR2Object(key: string) {
  const config = getR2Config();
  if (!config) return false;
  const response = await fetch(r2Request(config, "DELETE", key, 300), { method: "DELETE" });
  return response.ok || response.status === 404;
}

/** Descobre a chave a partir do endereço público (para posts antigos que não guardaram media_keys). */
export function keyFromPublicUrl(url: string) {
  const config = getR2Config();
  if (!config || !url.startsWith(`${config.publicBaseUrl}/`)) return null;
  return decodeURIComponent(url.slice(config.publicBaseUrl.length + 1));
}
