import { TELEGRAM_TIMEOUT_MS } from "@/lib/notify";

/**
 * Chamadas ao Telegram além do aviso simples (src/lib/notify.ts): mensagem com botões, resposta ao toque num botão,
 * edição da mensagem e registro do webhook. Mesmas variáveis dos avisos (TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID).
 * Nunca lança erro e nunca registra o token no log.
 */

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type TelegramCallResult<T = unknown> = { ok: true; result: T } | { ok: false; error: string; status?: number };

const TEXT_LIMIT = 4000;

export function telegramBotConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

/** Uma chamada qualquer da API do robô (sendMessage, editMessageText, answerCallbackQuery, setWebhook…). */
export async function telegramCall<T = unknown>(method: string, body: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<TelegramCallResult<T>> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: "Falta configurar TELEGRAM_BOT_TOKEN no Netlify." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(300, options.timeoutMs ?? TELEGRAM_TIMEOUT_MS));
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (response.ok && data?.ok !== false) return { ok: true, result: data?.result as T };
    const description = hideToken(String(data?.description ?? ""), token);
    console.error(`[telegram] ${method} recusado (HTTP ${response.status}): ${description || "sem detalhe"}`);
    return { ok: false, status: response.status, error: description || `erro ${response.status}` };
  } catch (error) {
    const detail = hideToken(error instanceof Error ? error.message : String(error), token);
    console.error(`[telegram] não consegui chamar ${method}: ${detail}`);
    return { ok: false, error: controller.signal.aborted ? "O Telegram não respondeu a tempo." : "Não consegui falar com o Telegram." };
  } finally {
    clearTimeout(timer);
  }
}

/** Mensagem para a conversa configurada, com botões (opcionais). Devolve o número da mensagem. */
export async function sendTelegramWithButtons(text: string, buttons: InlineButton[][] | null, options: { timeoutMs?: number; preview?: boolean } = {}) {
  const config = telegramBotConfig();
  if (!config) return { ok: false as const, error: "Telegram não configurado." };
  const result = await telegramCall<{ message_id?: number }>("sendMessage", {
    chat_id: config.chatId,
    text: text.slice(0, TEXT_LIMIT),
    disable_web_page_preview: options.preview !== true,
    ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  }, options);
  if (!result.ok) return result;
  return { ok: true as const, messageId: typeof result.result?.message_id === "number" ? result.result.message_id : null };
}

/** Troca o texto de uma mensagem já enviada e tira os botões dela (ou põe outros, com `buttons`). */
export async function editTelegramMessage(messageId: number, text: string, options: { timeoutMs?: number; buttons?: InlineButton[][] | null } = {}) {
  const config = telegramBotConfig();
  if (!config) return { ok: false as const, error: "Telegram não configurado." };
  const result = await telegramCall("editMessageText", {
    chat_id: config.chatId,
    message_id: messageId,
    text: text.slice(0, TEXT_LIMIT),
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: options.buttons ?? [] },
  }, options);
  // "message is not modified": o texto já era este (segundo toque no mesmo botão). Não é erro.
  if (!result.ok && /not modified/i.test(result.error)) return { ok: true as const };
  return result.ok ? { ok: true as const } : result;
}

/** Resposta ao toque num botão (o aviso rápido que aparece no alto do Telegram). */
export async function answerCallback(callbackQueryId: string, text: string, options: { timeoutMs?: number } = {}) {
  return telegramCall("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text.slice(0, 190) }, options);
}

function hideToken(text: string, token: string) {
  return text.split(token).join("***").replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***");
}
