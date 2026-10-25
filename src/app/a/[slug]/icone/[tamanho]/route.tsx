import { ImageResponse } from "next/og";
import { NextResponse, type NextRequest } from "next/server";
import { getAppPublico } from "@/lib/db/apps";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string; tamanho: string }> };

const TAMANHOS = new Set([180, 192, 512]);

/**
 * GET /a/<slug>/icone/<180|192|512> — o ícone do app na cor da marca do avatar: o fundo da marca, um círculo na cor do botão e a
 * inicial do nome no meio (com a margem do «maskable»: o desenho cabe no círculo de 80% que o Android recorta).
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { slug, tamanho } = await params;
  const t = Number(tamanho);
  if (!TAMANHOS.has(t)) return NextResponse.json({ error: "Tamanho de ícone inválido." }, { status: 404 });
  const a = await getAppPublico(slug);
  if (!a) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });
  const m = a.app.marca;
  const inicial = (a.app.nomeCurto || a.app.titulo).trim().charAt(0).toUpperCase() || "A";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: m.fundo }}>
        <div style={{ width: t * 0.62, height: t * 0.62, borderRadius: t, display: "flex", alignItems: "center", justifyContent: "center", background: m.primaria, color: m.textoPrimaria, fontSize: t * 0.34, fontWeight: 700 }}>
          {inicial}
        </div>
      </div>
    ),
    { width: t, height: t, headers: { "cache-control": "public, max-age=86400" } },
  );
}
