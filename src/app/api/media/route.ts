import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/db/repositories";
import { listInstagramMedia } from "@/lib/instagram/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const config = await getConfig(request.nextUrl.searchParams.get("accountId"));

    if (!config.instagram_access_token || !config.instagram_user_id) {
      return NextResponse.json({ data: [], error: "Instagram não conectado" }, { status: 409 });
    }

    const media = await listInstagramMedia(config.instagram_user_id, config.instagram_access_token);
    return NextResponse.json(media);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não consegui carregar os posts e Reels.";
    console.error("[api/media]", message);

    return NextResponse.json(
      { data: [], error: message },
      { status: 502 },
    );
  }
}
