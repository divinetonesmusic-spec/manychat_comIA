import { NextRequest, NextResponse } from "next/server";
import { safeEqualSecret } from "@/lib/secrets";
import { handleCallback, type TelegramCallbackQuery } from "@/lib/telegram/approvals";
import { answerCallback } from "@/lib/telegram/api";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/telegram/webhook — o Telegram chama aqui quando a dona toca num botão («Aprovar», «Refazer», «Mandar»,
 * «Não mandar»). Rota pública, protegida por:
 * 1. o cabeçalho X-Telegram-Bot-Api-Secret-Token igual a TELEGRAM_WEBHOOK_SECRET (comparado em tempo constante);
 * 2. só aceita toques da conversa TELEGRAM_CHAT_ID;
 * 3. cada botão leva uma assinatura (HMAC) que só o UaiFlow sabe fazer.
 * Depois de conferido, responde sempre 200 (senão o Telegram repete o mesmo toque várias vezes).
 * Registrar o webhook: botão em Configurações (POST /api/telegram/registrar) ou `npm run telegram:webhook`.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected || expected.length < 24) {
    return NextResponse.json({ error: "Defina TELEGRAM_WEBHOOK_SECRET (24+ caracteres) nas variáveis do servidor.", codigo: "sem_segredo" }, { status: 503 });
  }
  if (!safeEqualSecret(request.headers.get("x-telegram-bot-api-secret-token"), expected)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as { callback_query?: TelegramCallbackQuery } | null;
  const callback = update?.callback_query;
  if (!callback?.id) return NextResponse.json({ ok: true, ignorado: true }); // mensagens comuns: nada a fazer

  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId || String(callback.message?.chat?.id ?? "") !== chatId) {
    await answerCallback(callback.id, "Esta conversa não pode aprovar nada no UaiFlow.");
    return NextResponse.json({ ok: true, ignorado: true });
  }

  const result = await handleCallback(callback);
  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  return NextResponse.json({ error: "Use POST (só o Telegram chama este endereço)." }, { status: 405 });
}
