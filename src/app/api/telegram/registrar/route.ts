import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { registerTelegramWebhook } from "@/lib/telegram/webhook-setup";

export const runtime = "nodejs";

/**
 * POST /api/telegram/registrar — botão "Ligar os botões do Telegram" da tela Configurações.
 * Rota privada: o proxy exige sessão (não está na lista pública; só /api/telegram/webhook está).
 */
export async function POST(request: NextRequest) {
  const result = await registerTelegramWebhook(getAppBaseUrl(request.url));
  if (result.ok) return NextResponse.json({ ok: true, message: result.message });
  return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
}
