import type { NextRequest } from "next/server";
import { handleVendaWebhook } from "@/lib/vendas/handler";

export const runtime = "nodejs";

/** Aviso de venda/reembolso/chargeback da Lemon Squeezy (0012). Público (a plataforma chama), mas só aceito com o segredo certo. Veja docs/ATUALIZACAO_0012.md. */
export async function POST(request: NextRequest) {
  return handleVendaWebhook("lemonsqueezy", request);
}
