import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCompradorPorToken, salvarDepoimento } from "@/lib/db/funil";
import { getR2Config, PASTA_PRINTS_DEPOIMENTO, putR2Object } from "@/lib/content/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

const MAX_PRINT_BYTES = 4 * 1024 * 1024;
const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function voltar(request: NextRequest, caminho: string) {
  return NextResponse.redirect(new URL(caminho, request.url), { status: 303, headers: { "cache-control": "no-store" } });
}

/**
 * POST /depoimento/<token>/enviar: guarda a resposta com a data e a permissão («autorizo usar» marcada ou não).
 * O print (opcional) vai para o R2 se ele estiver configurado; sem R2, a resposta é guardada sem o print.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { token } = await params;
  const comprador = await getCompradorPorToken(token);
  if (!comprador) return new NextResponse("Link não encontrado.", { status: 404 });
  const pagina = `/depoimento/${token}`;
  const form = await request.formData().catch(() => null);
  if (!form) return voltar(request, `${pagina}?erro=texto`);
  if (String(form.get("site") ?? "")) return voltar(request, `${pagina}?enviado=1`);

  const oQueFuncionou = String(form.get("o_que_funcionou") ?? "").trim().slice(0, 2000);
  if (oQueFuncionou.length < 2) return voltar(request, `${pagina}?erro=texto`);

  let printKey: string | null = null;
  const arquivo = form.get("print");
  if (arquivo && typeof arquivo === "object" && "size" in arquivo && arquivo.size > 0) {
    const extensao = TIPOS[arquivo.type];
    if (!extensao || arquivo.size > MAX_PRINT_BYTES) return voltar(request, `${pagina}?erro=print`);
    if (getR2Config()) {
      const key = `${PASTA_PRINTS_DEPOIMENTO}/${randomUUID()}.${extensao}`;
      try {
        await putR2Object(key, Buffer.from(await arquivo.arrayBuffer()), arquivo.type, { timeoutMs: 6000 });
        printKey = key;
      } catch (error) {
        console.error("[depoimento] não consegui guardar o print:", error instanceof Error ? error.message : error);
      }
    }
  }

  await salvarDepoimento(comprador, {
    nomeExibicao: String(form.get("nome_exibicao") ?? "").trim().slice(0, 80) || null,
    oQueFuncionou,
    depoimento: String(form.get("depoimento") ?? "").trim().slice(0, 2000) || null,
    printKey,
    autorizaUso: form.get("autorizo") === "on",
  });
  return voltar(request, `${pagina}?enviado=1`);
}
