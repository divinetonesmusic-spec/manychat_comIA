import Link from "next/link";
import { ArrowRight, Boxes, GitBranch, Plus, Sparkles, Workflow } from "lucide-react";
import { AppFrame, PageHeader } from "../app-frame";
import { getDashboardStats, listPublicInstagramAccounts } from "@/lib/db/repositories";
import { getCurrentWorkspaceContext } from "@/lib/workspace";
import { getSelectedAccountId, hrefWithAccount, type AccountRouteSearchParams } from "@/lib/account-routing";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<AccountRouteSearchParams>;
};

const catalogTemplates = [
  {
    id: "comment-follower-gate",
    title: "Comentário + verifica seguidor",
    category: "Seguidores",
    description: "Responde o comentário, confere se a pessoa segue o perfil e só libera o acesso para seguidores.",
    flow: ["Comentário", "Seguidor", "Direct"],
  },
  {
    id: "comment-dm-button",
    title: "Comentário + mensagem com botão",
    category: "Mais usado",
    description: "Percebe a palavra-chave no post ou Reel, responde no comentário e envia uma mensagem no direct com botão.",
    flow: ["Palavra-chave", "Comentário", "Botão"],
  },
  {
    id: "dm-keyword",
    title: "Palavra-chave no Direct",
    category: "Direct",
    description: "Quando a pessoa escreve uma palavra-chave no direct, o fluxo responde com botão e link.",
    flow: ["Direct", "Palavra-chave", "Link"],
  },
  {
    id: "story-reply",
    title: "Resposta de story",
    category: "Stories",
    description: "Transforma as respostas aos stories em uma conversa guiada no direct.",
    flow: ["Story", "Direct", "Botão"],
  },
  {
    id: "public-private-reply",
    title: "Comentário público + resposta privada",
    category: "Comentários",
    description: "Responde no post e leva a conversa para o direct, sem mandar mensagem para quem não conhece você.",
    flow: ["Público", "Privado", "Direct"],
  },
  {
    id: "follow-up-direct",
    title: "Lembrete no direct",
    category: "Recuperação",
    description: "Agenda um lembrete, dentro do prazo permitido pelo Instagram, depois do primeiro contato.",
    flow: ["Direct", "Espera", "Lembrete"],
  },
];

export default async function AutomacoesPage({ searchParams }: Props) {
  const params = await searchParams;
  const [workspaceContext, accounts] = await Promise.all([getCurrentWorkspaceContext(), listPublicInstagramAccounts()]);
  const activeAccountId = getSelectedAccountId(params, accounts);
  const stats = await getDashboardStats(activeAccountId);
  const connected = Boolean(stats.config.instagram_user_id);

  return (
    <AppFrame active="automacoes" connected={connected} username={stats.config.instagram_username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <PageHeader
        eyebrow="Automações"
        title="Criar automação"
        description="Respostas automáticas no Instagram. Escolha um modelo pronto para editar ou comece uma automação do zero para o perfil selecionado. Para pausar, apagar ou ver o que foi enviado, abra Fluxos, no menu Avançado."
        action={
          <Link className="btn-primary" href={hrefWithAccount("/automacoes/nova", activeAccountId)}>
            <Plus size={16} />
            Nova do zero
          </Link>
        }
      />

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Modelos</p>
              <h2 className="mt-2 text-xl font-semibold">Comece pelo fluxo certo</h2>
            </div>
            <span className="status-pill">{catalogTemplates.length} modelos</span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {catalogTemplates.map((template) => (
              <Link
                className="group grid gap-4 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] p-4 transition hover:border-[var(--ms-primary-soft)] hover:bg-[var(--ms-surface-soft)]"
                href={hrefWithAccount(`/automacoes/nova?modelo=${template.id}`, activeAccountId)}
                key={template.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="metric-icon metric-blue shrink-0"><Workflow size={18} /></span>
                  <span className="rounded-md bg-[var(--ms-surface-soft)] px-2 py-1 text-xs font-bold text-[var(--ms-muted)]">{template.category}</span>
                </div>
                <div>
                  <h3 className="text-base font-bold leading-5">{template.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--ms-muted)]">{template.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {template.flow.map((step) => <span className="rounded-md border border-[var(--ms-border)] px-2 py-1 text-xs font-semibold text-[var(--ms-muted)]" key={step}>{step}</span>)}
                </div>
                <span className="inline-flex items-center gap-2 text-sm font-bold text-[var(--ms-primary)]">
                  Editar modelo
                  <ArrowRight className="transition group-hover:translate-x-0.5" size={15} />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <aside className="grid content-start gap-4">
          <Link className="panel grid gap-4 p-5 transition hover:border-[var(--ms-primary-soft)]" href={hrefWithAccount("/automacoes/nova", activeAccountId)}>
            <span className="metric-icon metric-green"><Sparkles size={18} /></span>
            <div>
              <h2 className="text-lg font-bold">Nova do zero</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ms-muted)]">Abre o editor em branco para criar uma regra só sua no perfil selecionado.</p>
            </div>
            <span className="inline-flex items-center gap-2 text-sm font-bold text-[var(--ms-primary)]">Abrir editor <ArrowRight size={15} /></span>
          </Link>

          <Link className="panel grid gap-4 p-5 transition hover:border-[var(--ms-primary-soft)]" href={hrefWithAccount("/fluxos", activeAccountId)}>
            <span className="metric-icon metric-amber"><GitBranch size={18} /></span>
            <div>
              <h2 className="text-lg font-bold">Gerenciar fluxos</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ms-muted)]">{stats.automations.length} {stats.automations.length === 1 ? "criado" : "criados"}, {stats.automations.filter((item) => item.active).length} {stats.automations.filter((item) => item.active).length === 1 ? "ativo" : "ativos"}.</p>
            </div>
            <span className="inline-flex items-center gap-2 text-sm font-bold text-[var(--ms-primary)]">Ver fluxos <ArrowRight size={15} /></span>
          </Link>

          <section className="panel p-5">
            <div className="flex items-center gap-3">
              <span className="metric-icon metric-blue"><Boxes size={18} /></span>
              <div>
                <p className="text-sm font-semibold text-[var(--ms-muted)]">Comentários e mensagens recebidos</p>
                <p className="mt-1 text-2xl font-bold">{stats.eventCount}</p>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </AppFrame>
  );
}
