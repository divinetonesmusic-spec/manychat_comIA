import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * O que vai escondido em cada botão do Telegram (callback_data, até 64 bytes), assinado para ninguém forjar um toque.
 *
 * Formato: <tipo>.<ação>.<id>.<versão>.<assinatura>
 *   tipo: j = trabalho do Molde (molde_jobs), d = resposta de DM (dm_pending)
 *   ação: a = aprovar, r = refazer (trabalho); m = mandar, n = não mandar (DM)
 *   id: o uuid em base64url (22 letras)
 *   versão: a rodada de aprovação (trabalho) ou o número do rascunho (DM), em base 36
 *   assinatura: HMAC-SHA256 (16 letras base64url) com uma chave tirada de TELEGRAM_WEBHOOK_SECRET
 * Ex.: j.a.q83vEjRWeJASNFZ4kBI0Vg.1.Xb3d9kQ0aPq1ZyZ2  (cerca de 45 letras)
 */

export type CallbackKind = "j" | "d";
export type CallbackAction = "a" | "r" | "m" | "n";
export type CallbackPayload = { kind: CallbackKind; action: CallbackAction; id: string; version: number };

const ACTIONS: Record<CallbackKind, CallbackAction[]> = { j: ["a", "r"], d: ["m", "n"] };
const SIG_LENGTH = 16;

function callbackKey() {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < 24) return null;
  return createHmac("sha256", secret).update("uaiflow-telegram-callback-v1").digest();
}

/** Os botões só existem com TELEGRAM_WEBHOOK_SECRET (24+ letras): sem ele, ninguém receberia o toque. */
export function callbacksEnabled() {
  return Boolean(callbackKey()) && Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
}

function uuidToB64(id: string) {
  return Buffer.from(id.replace(/-/g, ""), "hex").toString("base64url");
}

function b64ToUuid(value: string) {
  const hex = Buffer.from(value, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sign(key: Buffer, body: string) {
  return createHmac("sha256", key).update(body).digest("base64url").slice(0, SIG_LENGTH);
}

export function signCallback(payload: CallbackPayload): string | null {
  const key = callbackKey();
  if (!key) return null;
  const body = `${payload.kind}.${payload.action}.${uuidToB64(payload.id)}.${Math.max(0, Math.trunc(payload.version)).toString(36)}`;
  return `${body}.${sign(key, body)}`;
}

/** Confere a assinatura (em tempo constante) e devolve o que o botão pede, ou null se for falso/estragado. */
export function verifyCallback(data: unknown): CallbackPayload | null {
  const key = callbackKey();
  if (!key || typeof data !== "string" || data.length > 64) return null;
  const parts = data.split(".");
  if (parts.length !== 5) return null;
  const [kind, action, idB64, versionText, signature] = parts;
  const body = parts.slice(0, 4).join(".");
  const expected = Buffer.from(sign(key, body));
  const provided = Buffer.from(signature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  if (kind !== "j" && kind !== "d") return null;
  if (!ACTIONS[kind].includes(action as CallbackAction)) return null;
  if (!/^[A-Za-z0-9_-]{22}$/.test(idB64) || !/^[0-9a-z]{1,6}$/.test(versionText)) return null;
  const id = b64ToUuid(idB64);
  if (!id) return null;
  return { kind, action: action as CallbackAction, id, version: parseInt(versionText, 36) };
}
