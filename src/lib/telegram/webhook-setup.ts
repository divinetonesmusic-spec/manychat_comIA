import { telegramCall } from "@/lib/telegram/api";

/**
 * Registra no Telegram o endereço do webhook do UaiFlow (setWebhook), com o segredo TELEGRAM_WEBHOOK_SECRET.
 * Usado pelo botão "Ligar os botões do Telegram" (Configurações) e, com a mesma regra, por `npm run telegram:webhook`.
 */
export const WEBHOOK_PATH = "/api/telegram/webhook";
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{24,256}$/;

export type SetupResult = { ok: true; message: string; url: string } | { ok: false; error: string };

export async function registerTelegramWebhook(baseUrl: string): Promise<SetupResult> {
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim() || !process.env.TELEGRAM_CHAT_ID?.trim()) {
    return { ok: false, error: "Falta configurar TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no Netlify." };
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  if (!SECRET_PATTERN.test(secret)) {
    return { ok: false, error: "Falta configurar TELEGRAM_WEBHOOK_SECRET no Netlify: 24 a 256 letras, números, _ ou - (sem espaço)." };
  }
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+/i.test(base)) {
    return { ok: false, error: "O endereço do site precisa começar com https:// (confira APP_BASE_URL no Netlify)." };
  }
  const url = `${base}${WEBHOOK_PATH}`;
  const result = await telegramCall("setWebhook", { url, secret_token: secret, allowed_updates: ["callback_query"], max_connections: 5 });
  if (!result.ok) {
    if (result.status === 401 || result.status === 404) return { ok: false, error: "O Telegram não aceitou o TELEGRAM_BOT_TOKEN. Confira o token que o @BotFather mandou." };
    return { ok: false, error: `O Telegram recusou o registro: ${result.error}` };
  }
  return { ok: true, message: "Botões do Telegram ligados! As aprovações agora chegam com «Aprovar» e «Refazer».", url };
}
