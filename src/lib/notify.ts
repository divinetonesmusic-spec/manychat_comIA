import type { TokenAlert } from "@/lib/instagram/token-refresh";

/**
 * Avisos no celular pelo Telegram.
 *
 * Variáveis (opcionais): TELEGRAM_BOT_TOKEN (o token que o @BotFather entrega) e TELEGRAM_CHAT_ID (o número
 * da conversa). Sem as duas, nada é enviado e nada quebra. Quem chama nunca recebe erro: no máximo fica um
 * registro no console, sempre sem o token.
 */

/** Prazo de cada envio ao Telegram. */
export const TELEGRAM_TIMEOUT_MS = 5000;
/** O Telegram aceita até 4096 caracteres por mensagem. */
const TELEGRAM_TEXT_LIMIT = 4000;

export type NotifyResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" }
  /** `error` é uma explicação em português, pronta para mostrar na tela. */
  | { ok: false; reason: "error"; error: string };

function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

export function isTelegramConfigured() {
  return Boolean(telegramConfig());
}

/** Manda uma mensagem de texto puro. Nunca lança erro. */
export async function sendTelegram(text: string, options: { timeoutMs?: number } = {}): Promise<NotifyResult> {
  const config = telegramConfig();
  if (!config) return { ok: false, reason: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TELEGRAM_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text: text.slice(0, TELEGRAM_TEXT_LIMIT), disable_web_page_preview: true }),
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as { description?: string } | null;
    const description = hideToken(String(body?.description ?? ""), config.token);
    console.error(`[aviso] O Telegram recusou o aviso (HTTP ${response.status}): ${description || "sem detalhe"}`);
    return { ok: false, reason: "error", error: explainTelegramError(response.status, description) };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const timedOut = controller.signal.aborted || name === "TimeoutError" || name === "AbortError";
    const detail = hideToken(error instanceof Error ? error.message : String(error), config.token);
    console.error(`[aviso] Não consegui mandar o aviso pelo Telegram: ${detail}`);
    return {
      ok: false,
      reason: "error",
      error: timedOut
        ? "O Telegram não respondeu a tempo. Tente de novo em alguns minutos."
        : "Não consegui falar com o Telegram. Tente de novo em alguns minutos.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function explainTelegramError(status: number, description: string) {
  if (status === 401 || status === 404) {
    return "O Telegram não aceitou o TELEGRAM_BOT_TOKEN. Confira se você copiou o token inteiro que o @BotFather mandou.";
  }
  if (/chat not found/i.test(description)) {
    return "O Telegram não achou a conversa. Confira o número em TELEGRAM_CHAT_ID e mande um \"oi\" para o seu robô no Telegram.";
  }
  if (status === 403) {
    return "O robô ainda não pode falar com você. Abra o seu robô no Telegram, toque em Começar e tente de novo.";
  }
  if (status === 429) return "O Telegram pediu para esperar um pouco. Tente de novo em 1 minuto.";
  return `O Telegram recusou o aviso (erro ${status}${description ? `: ${description}` : ""}).`;
}

function hideToken(text: string, token: string) {
  return text.split(token).join("***").replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***");
}

/**
 * Link para uma tela do UaiFlow: APP_BASE_URL (o endereço do site no ar) + caminho.
 * Sem APP_BASE_URL, usa o endereço do pedido (quando houver); sem os dois, não há link.
 */
export function appLink(path: string, origin?: string | null): string | null {
  const base = (process.env.APP_BASE_URL || origin || "").trim().replace(/\/+$/, "");
  return base ? `${base}${path}` : null;
}

export type FailedPostInfo = {
  id: string;
  title?: string | null;
  caption?: string | null;
  account_id: string | null;
  account_username: string | null;
};

/** Ex.: UaiFlow: o post "Antes do café…" (@conta) não saiu. / Motivo: … / Abra: <site>/conteudo */
export function postFailedMessage(post: FailedPostInfo, motivo: string, origin?: string | null) {
  const name = shorten(post.title?.trim() || firstLine(post.caption) || "sem título", 40);
  const account = post.account_username ? ` (@${post.account_username})` : "";
  const path = post.account_id ? `/conteudo?accountId=${encodeURIComponent(post.account_id)}` : "/conteudo";
  const link = appLink(path, origin);
  return [
    `UaiFlow: o post "${name}"${account} não saiu.`,
    `Motivo: ${shorten(motivo.trim() || "não informado.", 400)}`,
    link ? `Abra: ${link}` : null,
  ].filter(Boolean).join("\n");
}

/** Aviso de post que acabou de passar para "Com erro". Nunca lança erro. */
export async function notifyPostFailed(post: FailedPostInfo, motivo: string, origin?: string | null, options: { timeoutMs?: number } = {}) {
  try {
    return await sendTelegram(postFailedMessage(post, motivo, origin), options);
  } catch {
    return { ok: false, reason: "error", error: "Falha ao montar o aviso." } as const;
  }
}

/** Uma mensagem só, com todas as contas que precisam de atenção depois da renovação do token. */
export function tokenAlertsMessage(alerts: TokenAlert[], origin?: string | null) {
  const lines = alerts.map((alert) => {
    const days = daysText(alert.diasParaVencer);
    if (alert.motivo === "falha_na_renovacao") {
      const detail = alert.detalhe?.trim() ? ` (Detalhe: ${shorten(alert.detalhe.trim(), 150)})` : "";
      return `- @${alert.username}: não consegui renovar a conexão.${days ? ` Ela ${days}.` : ""}${detail}`;
    }
    return `- @${alert.username}: a conexão ${days || "vence em breve"}.`;
  });
  const link = appLink("/perfis", origin);
  return [
    "UaiFlow: atenção com a conexão do Instagram.",
    ...lines,
    link ? `Reconecte o perfil em Perfis: ${link}` : "Reconecte o perfil na tela Perfis do UaiFlow.",
  ].join("\n");
}

/** Aviso de renovação de token (falhas e contas vencendo em menos de 10 dias). Nunca lança erro. */
export async function notifyTokenAlerts(alerts: TokenAlert[], origin?: string | null) {
  if (!alerts.length) return { ok: true } as const;
  try {
    return await sendTelegram(tokenAlertsMessage(alerts, origin));
  } catch {
    return { ok: false, reason: "error", error: "Falha ao montar o aviso." } as const;
  }
}

function daysText(days: number | null) {
  if (days === null || !Number.isFinite(days)) return "";
  if (days < 0) return "já venceu";
  if (days === 0) return "vence hoje";
  return `vence em ${days} ${days === 1 ? "dia" : "dias"}`;
}

function firstLine(text?: string | null) {
  return (text ?? "").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function shorten(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
