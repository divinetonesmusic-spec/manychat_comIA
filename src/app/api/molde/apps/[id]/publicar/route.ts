import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/env";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { r2Tamanho } from "@/lib/content/r2";
import { getAppMolde, isMissing0018, MIGRATION_0018, publicarApp, type AppRow } from "@/lib/db/apps";
import { lerApp } from "@/lib/app/pacote";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/molde/apps/<id>/publicar  { molde }
 * Confere no R2 cada áudio pedido (existe e tem o tamanho anunciado) e abre /a/<slug>. Áudio que não chegou: erro 409 com a frase
 * (a página manda de novo). O app só abre com TODOS os áudios da rotina guardados.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const molde = typeof body.molde === "string" ? body.molde.trim() : "";
  try {
    const a = await getAppMolde(id, molde);
    if (!a) return NextResponse.json({ error: "App não encontrado neste projeto." }, { status: 404 });
    const audios: AppRow["audios"] = { ...(a.audios ?? {}) };
    for (const [audio, p] of Object.entries(a.pendentes ?? {})) {
      const tamanho = await r2Tamanho(p.key);
      if (tamanho === null) return NextResponse.json({ error: `O áudio (${audio}) ainda não chegou ao armazenamento. Mande de novo.`, codigo: "arquivo_faltando" }, { status: 409 });
      if (tamanho !== p.size) return NextResponse.json({ error: `O áudio (${audio}) chegou com outro tamanho. Mande de novo.`, codigo: "arquivo_diferente" }, { status: 409 });
      audios[audio] = p;
    }
    const lido = lerApp({ app: a.pacote as Record<string, unknown> });
    if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
    const faltam = lido.app.audios.filter((x) => !audios[x.id]);
    if (faltam.length) return NextResponse.json({ error: `Falta mandar ${faltam.length === 1 ? "o áudio" : "os áudios"} ${faltam.map((x) => `«${x.titulo}»`).join(", ")}.`, codigo: "audio_faltando" }, { status: 400 });
    for (const k of Object.keys(audios)) if (!lido.app.audios.some((x) => x.id === k)) delete audios[k];
    const pub = await publicarApp(a.id, audios);
    return NextResponse.json({ data: { id: a.id, slug: a.slug, url: `${getAppBaseUrl(request.url)}/a/${a.slug}`, ativo: Boolean(pub?.ativo), versao: pub?.versao ?? a.versao, audios: Object.keys(audios).length, publicadoEm: pub?.publicado_em ?? null } });
  } catch (error) {
    if (isMissing0018(error)) return NextResponse.json({ error: MIGRATION_0018, codigo: "falta_0018" }, { status: 503 });
    console.error("[app] não consegui publicar:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não consegui conferir os áudios agora. Tente de novo em instantes." }, { status: 500 });
  }
}
