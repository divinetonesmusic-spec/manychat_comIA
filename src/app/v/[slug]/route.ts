import { NextRequest, NextResponse } from "next/server";
import { CSP_PAGINA, htmlPublicado } from "@/lib/molde/paginas";

/** A página de venda do Molde (/v/<slug>, 0020): o HTML guardado, isolado pelo CSP sandbox (veja CSP_PAGINA). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Params = { params: Promise<{ slug: string }> };

const SEGURANCA = {
  "content-security-policy": CSP_PAGINA,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), usb=(), payment=()",
  "cross-origin-resource-policy": "same-origin",
};

function naoEncontrada(status = 404) {
  const corpo = status === 404
    ? "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Página não encontrada</title></head><body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#222\"><h1>Página não encontrada</h1><p>Esta página não existe ou saiu do ar.</p></body></html>"
    : "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Tente de novo</title></head><body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#222\"><h1>Estamos com um problema agora</h1><p>Tente de novo em instantes.</p></body></html>";
  return new NextResponse(corpo, {
    status,
    headers: { ...SEGURANCA, "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...(status === 503 ? { "retry-after": "5" } : {}) },
  });
}

async function handle(_request: NextRequest, { params }: Params, comCorpo: boolean) {
  const { slug } = await params;
  let achada: Awaited<ReturnType<typeof htmlPublicado>>;
  try {
    achada = await htmlPublicado(slug);
  } catch (error) {
    console.error("[paginas] não consegui abrir /v/:", error instanceof Error ? error.message : error);
    return naoEncontrada(503);
  }
  if (!achada) return naoEncontrada();
  return new NextResponse(comCorpo ? new Uint8Array(achada.html) : null, {
    status: 200,
    headers: {
      ...SEGURANCA,
      "content-type": "text/html; charset=utf-8",
      "content-length": String(achada.html.length),
      // 1 minuto no navegador: depois de atualizar (ou tirar do ar), em até 1 minuto todo mundo vê
      "cache-control": "public, max-age=60",
    },
  });
}

export async function GET(request: NextRequest, context: Params) {
  return handle(request, context, true);
}

export async function HEAD(request: NextRequest, context: Params) {
  return handle(request, context, false);
}
