import { NextRequest, NextResponse } from "next/server";
import { appLink, sendTelegram } from "@/lib/notify";

export const runtime = "nodejs";

/**
 * POST /api/notify/test — botão "Enviar aviso de teste" da tela Configurações.
 * Rota privada: o proxy exige sessão (como as outras rotas /api que não estão na lista pública).
 */
export async function POST(request: NextRequest) {
  const link = appLink("/configuracoes", request.nextUrl.origin);
  const result = await sendTelegram(
    [
      "UaiFlow: aviso de teste.",
      "Se você recebeu esta mensagem, os avisos estão funcionando.",
      link ? `Abra: ${link}` : null,
    ].filter(Boolean).join("\n"),
  );

  if (result.ok) return NextResponse.json({ ok: true, message: "Aviso enviado! Confira o Telegram." });
  if (result.reason === "not_configured") {
    return NextResponse.json({ ok: false, error: "Falta configurar TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no Netlify." }, { status: 400 });
  }
  return NextResponse.json({ ok: false, error: `Não consegui enviar o aviso. ${result.error}` }, { status: 502 });
}
