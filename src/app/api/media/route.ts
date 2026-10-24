import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/db/repositories";
import { listInstagramMedia } from "@/lib/instagram/client";
import { redactSecrets } from "@/lib/secrets";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const config = await getConfig(request.nextUrl.searchParams.get("accountId"));

    if (!config.instagram_access_token || !config.instagram_user_id) {
      return NextResponse.json({ data: [], error: "Instagram não conectado" }, { status: 409 });
    }

    const media = await listInstagramMedia(config.instagram_user_id, config.instagram_access_token);
    // Só a lista: o "paging" da Meta traz endereços com o access_token dentro e não pode ir para o navegador (v133).
    return NextResponse.json({ data: Array.isArray(media.data) ? media.data : [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não consegui carregar os posts e Reels.";
    const safe = redactSecrets(message);
    console.error("[api/media]", safe);

    return NextResponse.json(
      { data: [], error: safe },
      { status: 502 },
    );
  }
}
