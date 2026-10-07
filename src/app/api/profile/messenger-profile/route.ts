import { NextRequest, NextResponse } from "next/server";
import { getConfig, getProfileSettings, markProfileSettingSynced } from "@/lib/db/repositories";
import {
  deleteInstagramMessengerProfile,
  getInstagramMessengerProfile,
  setInstagramIceBreakers,
  setInstagramPersistentMenu,
} from "@/lib/instagram/client";

export const runtime = "nodejs";

type MessengerProfileKind = "persistent_menu" | "ice_breakers";

export async function GET(request: NextRequest) {
  const kind = parseKind(request.nextUrl.searchParams.get("kind"));
  const accountId = request.nextUrl.searchParams.get("accountId");
  const config = await getConfig(accountId);
  if (!config.instagram_user_id || !config.instagram_access_token) {
    return NextResponse.json({ error: "Instagram não conectado." }, { status: 400 });
  }

  const data = await getInstagramMessengerProfile({
    instagramUserId: config.instagram_user_id,
    accessToken: config.instagram_access_token,
    fields: kind,
  });

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { kind?: string; accountId?: string | null };
  const kind = parseKind(body.kind);
  const accountId = body.accountId ?? null;
  const [config, settings] = await Promise.all([getConfig(accountId), getProfileSettings(accountId)]);

  if (!config.instagram_user_id || !config.instagram_access_token) {
    return NextResponse.json({ error: "Instagram não conectado." }, { status: 400 });
  }

  if (kind === "ice_breakers") {
    await setInstagramIceBreakers({
      instagramUserId: config.instagram_user_id,
      accessToken: config.instagram_access_token,
      items: settings.ice_breakers,
    });
    await markProfileSettingSynced("ice_breakers", config.account_id);
    return NextResponse.json({ ok: true });
  }

  await setInstagramPersistentMenu({
    instagramUserId: config.instagram_user_id,
    accessToken: config.instagram_access_token,
    items: settings.persistent_menu_items,
  });
  await markProfileSettingSynced("persistent_menu", config.account_id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const kind = parseKind(request.nextUrl.searchParams.get("kind"));
  const config = await getConfig(request.nextUrl.searchParams.get("accountId"));
  if (!config.instagram_user_id || !config.instagram_access_token) {
    return NextResponse.json({ error: "Instagram não conectado." }, { status: 400 });
  }

  await deleteInstagramMessengerProfile({
    instagramUserId: config.instagram_user_id,
    accessToken: config.instagram_access_token,
    fields: kind,
  });

  return NextResponse.json({ ok: true });
}

function parseKind(value: string | null | undefined): MessengerProfileKind {
  return value === "ice_breakers" ? "ice_breakers" : "persistent_menu";
}