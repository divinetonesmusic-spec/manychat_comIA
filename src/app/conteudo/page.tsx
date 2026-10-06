import { AppFrame, PageHeader } from "../app-frame";
import { ConteudoClient } from "./conteudo-client";
import { getConfig, listInstagramAccounts } from "@/lib/db/repositories";
import { listContentPostsInRange } from "@/lib/db/content-planner";
import { getSelectedAccountId, type AccountRouteSearchParams } from "@/lib/account-routing";
import { getCurrentWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<AccountRouteSearchParams>;
};

export default async function ConteudoPage({ searchParams }: Props) {
  const params = await searchParams;
  const [workspaceContext, accounts] = await Promise.all([getCurrentWorkspaceContext(), listInstagramAccounts()]);
  const activeAccountId = getSelectedAccountId(params, accounts);
  // Mês atual com folga de 1 semana em cada ponta (o calendário mostra as semanas de borda).
  const now = new Date();
  const initialMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const from = new Date(now.getFullYear(), now.getMonth(), -7);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 8);
  const [config, posts] = await Promise.all([getConfig(activeAccountId), listContentPostsInRange({ accountId: activeAccountId, from, to })]);
  const connected = Boolean(config.instagram_user_id);

  return (
    <AppFrame active="conteudo" connected={connected} username={config.instagram_username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <PageHeader
        eyebrow="Conteúdo"
        title="Planner de conteúdo"
        description="Agende Reels, carrosséis, fotos e stories. Na hora marcada o sistema publica, faz o 1º comentário e liga a automação da palavra-chave (comentou → DM com o link)."
      />

      <ConteudoClient activeAccountId={activeAccountId} connected={connected} username={config.instagram_username} initialPosts={posts} initialMonth={initialMonth} />
    </AppFrame>
  );
}
