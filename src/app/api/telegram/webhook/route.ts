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

  // Num grupo, qualquer membro vê os botões: com TELEGRAM_ALLOWED_USER_IDS (ids separados por vírgula), só essas
  // pessoas decidem. Vazia (ou ausente): vale qualquer toque da conversa (como antes). Com texto, mas sem nenhum id
  // numérico válido (ex.: «@nicolas», erro de digitação): ninguém decide, em vez de abrir para todos sem querer.
  const allowed = allowedUserIds();
  if (allowed && !allowed.has(String(callback.from?.id ?? ""))) {
    await answerCallback(callback.id, "Você não pode decidir isto no UaiFlow.");
    return NextResponse.json({ ok: true, ignorado: true });
  }

  const result = await handleCallback(callback);
  return NextResponse.json({ ok: true, ...result });
}

/** null = a variável não está em uso (vazia); senão, o conjunto de ids válidos (pode ser vazio: bloqueia todos). */
function allowedUserIds(): Set<string> | null {
  const raw = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "").trim();
  if (!raw) return null;
  const ids = new Set(raw.split(/[\s,;]+/).map((id) => id.trim()).filter((id) => /^-?\d+$/.test(id)));
  if (!ids.size) console.warn("[telegram] TELEGRAM_ALLOWED_USER_IDS tem texto mas nenhum id numérico válido: nenhum toque nos botões será aceito até corrigir.");
  return ids;
}

export async function GET() {
  return NextResponse.json({ error: "Use POST (só o Telegram chama este endereço)." }, { status: 405 });
}
