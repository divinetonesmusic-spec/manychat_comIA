import type { NextRequest } from "next/server";
import { handleVendaWebhook } from "@/lib/vendas/handler";

export const runtime = "nodejs";

/** Aviso de venda/reembolso da Payhip. Público (a plataforma chama), mas só aceito com o segredo certo. Veja docs/redes-e-vendas.md. */
export async function POST(request: NextRequest) {
  return handleVendaWebhook("payhip", request);
}
