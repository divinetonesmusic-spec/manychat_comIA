import { NextRequest, NextResponse } from "next/server";
import { listInstagramAccounts } from "@/lib/db/repositories";
import { checkMoldeToken } from "@/lib/content/molde-auth";

export const runtime = "nodejs";

/** Perfis conectados (sem tokens), para o Molde escolher onde publicar. */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const accounts = await listInstagramAccounts();
  return NextResponse.json({
    data: accounts.map((account) => ({
      id: account.id,
      username: account.instagram_username,
      name: account.instagram_name,
      picture: account.instagram_profile_picture_url,
      isDefault: account.is_default,
      connected: Boolean(account.instagram_access_token && account.instagram_user_id),
      tokenExpiresAt: account.token_expires_at,
    })),
  });
}
