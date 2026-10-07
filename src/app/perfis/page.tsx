import Link from "next/link";
import { Camera, RefreshCcw } from "lucide-react";
import { AppFrame, PageHeader } from "../app-frame";
import { PerfisClient } from "./perfis-client";
import { getConfig, getProfileSettings, listAutomations, listPublicInstagramAccounts } from "@/lib/db/repositories";
import { getCurrentWorkspaceContext } from "@/lib/workspace";
import { getSelectedAccountId, hrefWithAccount, type AccountRouteSearchParams } from "@/lib/account-routing";
import { toPublicConfig } from "@/lib/instagram/public-account";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<AccountRouteSearchParams>;
};

export default async function PerfisPage({ searchParams }: Props) {
  const params = await searchParams;
  const [workspaceContext, accounts] = await Promise.all([
    getCurrentWorkspaceContext(),
    listPublicInstagramAccounts(),
  ]);
  const activeAccountId = getSelectedAccountId(params, accounts);
  const [config, settings, automations] = await Promise.all([
    getConfig(activeAccountId),
    getProfileSettings(activeAccountId),
    listAutomations(activeAccountId),
  ]);
  const connected = Boolean(config.instagram_user_id);
  const next = encodeURIComponent(hrefWithAccount("/perfis", activeAccountId));
  const instagramAppId = process.env.INSTAGRAM_APP_ID;
  const metaDeveloperUrl = instagramAppId
    ? `https://developers.facebook.com/apps/${instagramAppId}/use_cases/customize/`
    : "https://developers.facebook.com/apps/";

  return (
    <AppFrame active="perfis" connected={connected} username={config.instagram_username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <PageHeader
        eyebrow="Perfis"
        title="Instagram conectado"
        description="Configure cada perfil individualmente ou copie configuracoes de outro Instagram conectado."
        action={
          <Link className="btn-primary" href={`/api/oauth/login?next=${next}`}>
            {connected ? <RefreshCcw size={16} /> : <Camera size={16} />}
            Adicionar via Meta + Login
          </Link>
        }
      />

      <PerfisClient key={activeAccountId ?? "sem-perfil"} accounts={accounts} automations={automations} config={toPublicConfig(config)} settings={settings} activeAccountId={activeAccountId} metaDeveloperUrl={metaDeveloperUrl} />
    </AppFrame>
  );
}
