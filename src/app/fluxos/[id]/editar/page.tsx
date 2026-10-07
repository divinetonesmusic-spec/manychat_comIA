import { notFound } from "next/navigation";
import { AppFrame } from "../../../app-frame";
import { FluxoEditorClient } from "./fluxo-editor-client";
import { getAutomation, getDashboardStats, listPublicInstagramAccounts } from "@/lib/db/repositories";
import { getCurrentWorkspaceContext } from "@/lib/workspace";
import { getSelectedAccountId, hrefWithAccount, type AccountRouteSearchParams } from "@/lib/account-routing";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<AccountRouteSearchParams>;
};

export default async function EditarFluxoPage({ params, searchParams }: Props) {
  const [{ id }, routeParams] = await Promise.all([params, searchParams]);
  const [workspaceContext, accounts] = await Promise.all([getCurrentWorkspaceContext(), listPublicInstagramAccounts()]);
  const activeAccountId = getSelectedAccountId(routeParams, accounts);
  const [stats, automation] = await Promise.all([
    getDashboardStats(activeAccountId),
    getAutomation(id, activeAccountId),
  ]);

  if (!automation) notFound();

  const connected = Boolean(stats.config.instagram_user_id);

  return (
    <AppFrame active="fluxos" connected={connected} username={stats.config.instagram_username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <FluxoEditorClient automation={automation} backHref={hrefWithAccount("/fluxos", activeAccountId)} accountId={activeAccountId} isInstagramConnected={connected} />
    </AppFrame>
  );
}
