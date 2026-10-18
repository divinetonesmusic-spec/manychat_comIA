import { NextRequest, NextResponse } from "next/server";
import { listInstagramAccounts } from "@/lib/db/repositories";
import { checkMoldeToken } from "@/lib/content/molde-auth";
import { connectedRedesByAccount, redesConfiguradas } from "@/lib/db/redes";

export const runtime = "nodejs";

/**
 * Perfis conectados (sem tokens), para o Molde escolher onde publicar.
 * `redes` (campo novo, só acréscimo): para cada rede, { conectado, configurado, motivo?, nome? } — nunca token.
 * `redesConfiguradas` (campo novo): o servidor tem as variáveis de cada rede extra?
 */
export async function GET(request: NextRequest) {
  const denied = checkMoldeToken(request);
  if (denied) return denied;
  const accounts = await listInstagramAccounts();
  const redes = await connectedRedesByAccount(accounts).catch(() => new Map());
  return NextResponse.json({
    data: accounts.map((account) => ({
      id: account.id,
      username: account.instagram_username,
      name: account.instagram_name,
      picture: account.instagram_profile_picture_url,
      isDefault: account.is_default,
      connected: Boolean(account.instagram_access_token && account.instagram_user_id),
      tokenExpiresAt: account.token_expires_at,
      redes: redes.get(account.id) ?? null,
    })),
    redesConfiguradas: redesConfiguradas(),
  });
}
