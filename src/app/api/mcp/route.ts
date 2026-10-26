import { NextRequest, NextResponse } from "next/server";
import { atenderCorpo } from "@/lib/mcp/molde";
import { safeEqualSecret } from "@/lib/secrets";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * /api/mcp — o Molde como servidor MCP remoto (Streamable HTTP, modo simples: cada POST recebe uma resposta JSON).
 * Protegido por MOLDE_MCP_TOKEN (24+ caracteres): «Authorization: Bearer <token>» ou, para o conector do Claude (que não
 * deixa pôr cabeçalho), no endereço: /api/mcp?chave=<token>. Sem a variável, a porta fica fechada (503).
 * Ferramentas e regras: src/lib/mcp/molde.ts. Como ligar no Claude: docs/MOLDE_MCP.md.
 */
function conferir(request: NextRequest): NextResponse | null {
  const esperado = process.env.MOLDE_MCP_TOKEN?.trim();
  if (!esperado || esperado.length < 24) {
    return NextResponse.json({ error: "A porta do MCP está fechada: defina MOLDE_MCP_TOKEN (24+ caracteres) nas variáveis do servidor.", codigo: "fechado" }, { status: 503 });
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const naUrl = request.nextUrl.searchParams.get("chave")?.trim();
  if (safeEqualSecret(bearer, esperado) || safeEqualSecret(naUrl, esperado)) return null;
  return NextResponse.json({ error: "Token do MCP inválido.", codigo: "token_invalido" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const negado = conferir(request);
  if (negado) return negado;
  const corpo = await request.json().catch(() => undefined);
  if (corpo === undefined) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido." } }, { status: 400 });
  const resposta = await atenderCorpo(corpo);
  if (resposta === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(resposta, { headers: { "cache-control": "no-store" } });
}

/** Sem fluxo SSE do servidor: o GET responde 405 (o transporte Streamable HTTP permite). */
export async function GET(request: NextRequest) {
  const negado = conferir(request);
  if (negado) return negado;
  return NextResponse.json({ error: "Use POST (JSON-RPC). Este servidor não abre fluxo SSE." }, { status: 405, headers: { allow: "POST" } });
}

/** Sem sessão: nada a encerrar. */
export async function DELETE(request: NextRequest) {
  const negado = conferir(request);
  if (negado) return negado;
  return NextResponse.json({ error: "Este servidor não guarda sessão." }, { status: 405, headers: { allow: "POST" } });
}
