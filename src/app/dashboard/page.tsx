import Link from "next/link";
import { Activity, AtSign, Contact, Inbox, MessageCircle, Plus, Send, Workflow } from "lucide-react";
import { AppFrame, PageHeader, formatDate } from "../app-frame";
import { getDashboardStats, listPublicInstagramAccounts } from "@/lib/db/repositories";
import { getCurrentWorkspaceContext } from "@/lib/workspace";
import { getSelectedAccountId, hrefWithAccount, type AccountRouteSearchParams } from "@/lib/account-routing";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<AccountRouteSearchParams>;
};

export default async function Home({ searchParams }: Props) {
  const params = await searchParams;
  const [workspaceContext, accounts] = await Promise.all([getCurrentWorkspaceContext(), listPublicInstagramAccounts()]);
  const activeAccountId = getSelectedAccountId(params, accounts);
  const stats = await getDashboardStats(activeAccountId);
  const connected = Boolean(stats.config.instagram_user_id);
  const activeAutomations = stats.automations.filter((automation) => automation.active).length;
  const pendingJobs = getQueueCount(stats.queue, "pending");
  const sentJobs = getQueueCount(stats.queue, "sent");

  return (
    <AppFrame active="inicio" connected={connected} username={stats.config.instagram_username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <PageHeader
        eyebrow="Visao geral"
        title="Painel"
        description="Acompanhe a saude das automacoes, eventos recebidos e contatos capturados pelo Instagram selecionado."
        action={
          <>
            <Link className="btn-secondary" href={hrefWithAccount("/caixa-de-entrada", activeAccountId)}>
              <Inbox size={16} />
              Ver inbox
            </Link>
            <Link className="btn-primary" href={hrefWithAccount("/automacoes/nova", activeAccountId)}>
              <Plus size={16} />
              Nova automacao
            </Link>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1.45fr)_repeat(4,minmax(150px,1fr))]">
        <ProfileMetricCard connected={connected} username={stats.config.instagram_username} />
        <MetricCard icon={<Workflow size={20} />} label="Automacoes ativas" value={String(activeAutomations)} tone="blue" />
        <MetricCard icon={<Activity size={20} />} label="Eventos" value={String(stats.eventCount)} tone="violet" />
        <MetricCard icon={<Contact size={20} />} label="Contatos" value={String(stats.contactCount)} tone="emerald" />
        <MetricCard icon={<Inbox size={20} />} label="Fila" value={pendingJobs ? `${pendingJobs} pendente(s)` : "limpa"} tone="amber" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_390px]">
        <RecentActivity events={stats.recentEvents} />

        <aside className="grid content-start gap-6">
          <OperationalSummary
            activeAutomations={activeAutomations}
            connected={connected}
            pendingJobs={pendingJobs}
            sentJobs={sentJobs}
            username={stats.config.instagram_username}
          />
          <QuickLinks accountId={activeAccountId} />
        </aside>
      </section>
    </AppFrame>
  );
}

function ProfileMetricCard({ connected, username }: { connected: boolean; username: string | null }) {
  const value = connected && username ? `@${username}` : "Desconectado";

  return (
    <article className="panel min-w-0 p-5">
      <div className="flex h-full items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--ms-muted)]">Instagram</p>
          <p className="mt-3 truncate text-xl font-bold leading-tight sm:text-2xl xl:text-xl 2xl:text-2xl" title={value}>{value}</p>
          <p className="mt-2 truncate text-xs font-semibold text-[var(--ms-muted)]">{connected ? "Perfil selecionado" : "Conecte um perfil"}</p>
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-pink-500/10 text-pink-600 dark:text-pink-300">
          <AtSign size={20} />
        </div>
      </div>
    </article>
  );
}

function MetricCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "emerald" | "blue" | "violet" | "amber" }) {
  return (
    <article className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--ms-muted)]">{label}</p>
          <p className="mt-3 truncate text-2xl font-bold" title={value}>{value}</p>
        </div>
        <div className={`metric-icon metric-${tone}`}>{icon}</div>
      </div>
    </article>
  );
}

function OperationalSummary({
  activeAutomations,
  connected,
  pendingJobs,
  sentJobs,
  username,
}: {
  activeAutomations: number;
  connected: boolean;
  pendingJobs: number;
  sentJobs: number;
  username: string | null;
}) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Operacao</p>
          <h2 className="mt-2 text-lg font-semibold">Resumo do perfil</h2>
        </div>
        <Activity size={20} className="text-[var(--ms-primary)]" />
      </div>
      <div className="mt-5 grid gap-3">
        <SummaryRow icon={<AtSign size={18} />} label="Conta conectada" value={connected ? `@${username}` : "Nenhuma conta"} good={connected} />
        <SummaryRow icon={<Workflow size={18} />} label="Fluxos ativos" value={`${activeAutomations} ativo(s)`} good={activeAutomations > 0} />
        <SummaryRow icon={<Inbox size={18} />} label="Fila de envio" value={pendingJobs ? `${pendingJobs} pendente(s)` : "limpa"} good={!pendingJobs} />
        <SummaryRow icon={<Send size={18} />} label="Envios processados" value={`${sentJobs} envio(s)`} good={sentJobs > 0} />
      </div>
    </section>
  );
}

function SummaryRow({ icon, label, value, good }: { icon: React.ReactNode; label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3">
      <div className={good ? "action-icon action-done" : "action-icon"}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="truncate text-xs text-[var(--ms-muted)]">{value}</p>
      </div>
    </div>
  );
}

function QuickLinks({ accountId }: { accountId: string | null }) {
  return (
    <section className="panel p-5 sm:p-6">
      <p className="eyebrow">Atalhos</p>
      <h2 className="mt-2 text-lg font-semibold">Ir direto para</h2>
      <div className="mt-5 grid gap-2">
        <Link className="btn-secondary justify-start" href={hrefWithAccount("/automacoes", accountId)}>
          <Workflow size={16} />
          Gerenciar automacoes
        </Link>
        <Link className="btn-secondary justify-start" href={hrefWithAccount("/contatos", accountId)}>
          <Contact size={16} />
          Ver contatos
        </Link>
        <Link className="btn-secondary justify-start" href={hrefWithAccount("/perfis", accountId)}>
          <AtSign size={16} />
          Configurar Instagram
        </Link>
      </div>
    </section>
  );
}

function RecentActivity({ events }: { events: Awaited<ReturnType<typeof getDashboardStats>>["recentEvents"] }) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Tempo real</p>
          <h2 className="mt-2 text-xl font-semibold">Atividade recente</h2>
        </div>
        <MessageCircle size={20} className="text-emerald-500" />
      </div>
      <div className="mt-5 grid gap-3">
        {events.length ? (
          events.map((event) => (
            <article className="flex gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4" key={event.id}>
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                <MessageCircle size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{event.instagram_username ? `@${event.instagram_username}` : event.event_type}</p>
                    <p className="mt-1 text-xs text-[var(--ms-muted)]">{formatDate(event.received_at)}</p>
                  </div>
                  <span className="w-fit rounded-md bg-[var(--ms-surface)] px-2 py-1 text-xs font-semibold text-[var(--ms-muted)]">
                    {event.instagram_media_id ? "Post/Reel" : "Evento"}
                  </span>
                </div>
                {event.instagram_media_id ? <p className="mt-2 truncate text-xs text-[var(--ms-muted)]">Midia {event.instagram_media_id}</p> : null}
              </div>
            </article>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--ms-border-strong)] bg-[var(--ms-surface-soft)] p-8 text-center">
            <MessageCircle className="mx-auto text-[var(--ms-muted)]" size={28} />
            <p className="mt-3 text-sm text-[var(--ms-muted)]">Nenhum evento recebido ainda.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function getQueueCount(queue: { status: string; count: number }[], status: string) {
  return queue.find((item) => item.status === status)?.count ?? 0;
}
