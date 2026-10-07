import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppFrame, PageHeader } from "../../app-frame";
import { DashboardClient } from "../../dashboard-client";
import { getDashboardStats, listPublicInstagramAccounts } from "@/lib/db/repositories";
import { getCurrentWorkspaceContext } from "@/lib/workspace";
import { getSelectedAccountId, hrefWithAccount, type AccountRouteSearchParams } from "@/lib/account-routing";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<AccountRouteSearchParams & { modelo?: string }>;
};

export default async function NovaAutomacaoPage({ searchParams }: Props) {
  const params = await searchParams;
  const [workspaceContext, accounts] = await Promise.all([getCurrentWorkspaceContext(), listPublicInstagramAccounts()]);
  const activeAccountId = getSelectedAccountId(params, accounts);
  const stats = await getDashboardStats(activeAccountId);
  const connected = Boolean(stats.config.instagram_user_id);
  const metaAppConfigured = Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
  const hasModel = Boolean(params.modelo);

  return (
    <AppFrame active="automacoes" connected={connected} username={stats.config.instagram_username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <PageHeader
        eyebrow="Editor"
        title={hasModel ? "Editar modelo" : "Nova automação"}
        description={hasModel ? "Revise o modelo escolhido, escolha o post ou Reel e ajuste as mensagens antes de ligar no perfil selecionado." : "Respostas automáticas no Instagram. Defina quando acontece, as mensagens, os botões, a espera e se só seguidores recebem."}
        action={
          <Link className="btn-secondary" href={hrefWithAccount("/automacoes", activeAccountId)}>
            <ArrowLeft size={16} />
            Modelos
          </Link>
        }
      />

      <DashboardClient
        initialAutomations={stats.automations}
        isInstagramConnected={connected}
        metaAppConfigured={metaAppConfigured}
        showFlowList={false}
        showTemplates={false}
        initialTemplateId={params.modelo}
        editorTitle={hasModel ? "Editar modelo selecionado" : "Nova automação do zero"}
        accountId={activeAccountId}
      />
    </AppFrame>
  );
}
