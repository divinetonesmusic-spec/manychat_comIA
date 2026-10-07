import Link from "next/link";
import { Plus } from "lucide-react";
import { AppFrame, PageHeader } from "../app-frame";
import { FluxosClient } from "./fluxos-client";
import { getDashboardStats, listFlowLogs, listPublicInstagramAccounts } from "@/lib/db/repositories";
import { getCurrentWorkspaceContext } from "@/lib/workspace";
import { getSelectedAccountId, hrefWithAccount, type AccountRouteSearchParams } from "@/lib/account-routing";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<AccountRouteSearchParams>;
};

export default async function FluxosPage({ searchParams }: Props) {
  const params = await searchParams;
  const [workspaceContext, accounts] = await Promise.all([getCurrentWorkspaceContext(), listPublicInstagramAccounts()]);
  const activeAccountId = getSelectedAccountId(params, accounts);
  const [stats, logs] = await Promise.all([getDashboardStats(activeAccountId), listFlowLogs(80, activeAccountId)]);
  const connected = Boolean(stats.config.instagram_user_id);

  return (
    <AppFrame active="fluxos" connected={connected} username={stats.config.instagram_username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <PageHeader
        eyebrow="Fluxos"
        title="Gerenciar fluxos"
        description="Edite, pause, exclua e acompanhe os envios recentes das automacoes do perfil selecionado."
        action={
          <Link className="btn-primary" href={hrefWithAccount("/automacoes/nova", activeAccountId)}>
            <Plus size={16} />
            Nova automacao
          </Link>
        }
      />

      <FluxosClient initialAutomations={stats.automations} initialLogs={logs} activeAccountId={activeAccountId} />
    </AppFrame>
  );
}
