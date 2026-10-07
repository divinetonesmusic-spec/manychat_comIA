import { AlertCircle, CheckCircle2, Clock3, Contact, MessageCircle, PauseCircle, Send, UserRound } from "lucide-react";
import { AppFrame, PageHeader, eventTypeLabel, formatDate } from "../app-frame";
import { getConfig, listContacts, listPublicInstagramAccounts, type ContactSummary } from "@/lib/db/repositories";
import { getCurrentWorkspaceContext } from "@/lib/workspace";
import { getSelectedAccountId, type AccountRouteSearchParams } from "@/lib/account-routing";
import { ContactPauseControls } from "./contact-pause-controls";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<AccountRouteSearchParams>;
};

export default async function ContatosPage({ searchParams }: Props) {
  const params = await searchParams;
  const [workspaceContext, accounts] = await Promise.all([getCurrentWorkspaceContext(), listPublicInstagramAccounts()]);
  const activeAccountId = getSelectedAccountId(params, accounts);
  const [config, contacts] = await Promise.all([getConfig(activeAccountId), listContacts(80, activeAccountId)]);
  const connected = Boolean(config.instagram_user_id);
  const withResponse = contacts.filter((contact) => contact.sent_count > 0 || Boolean(contact.last_response_at)).length;
  const withErrors = contacts.filter((contact) => contact.failed_count > 0).length;

  return (
    <AppFrame active="contatos" connected={connected} username={config.instagram_username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <PageHeader
        eyebrow="Contatos"
        title="Pessoas que falaram com você"
        description="O histórico de cada contato do perfil selecionado: o que recebeu, o que foi respondido, o que está esperando para sair e o que deu erro."
      />

      <section className="grid gap-4 sm:grid-cols-4">
        <MiniCard icon={<Contact size={20} />} label="Total" value={String(contacts.length)} />
        <MiniCard icon={<Send size={20} />} label="Com resposta" value={String(withResponse)} />
        <MiniCard icon={<AlertCircle size={20} />} label="Com erro" value={String(withErrors)} />
        <MiniCard icon={<UserRound size={20} />} label="Instagram" value={connected ? `@${config.instagram_username}` : "Desconectado"} />
      </section>

      <section className="panel overflow-hidden p-0">
        <div className="border-b border-[var(--ms-border)] p-5 sm:p-6">
          <h2 className="text-xl font-semibold">Lista de contatos</h2>
          <p className="mt-2 text-sm text-[var(--ms-muted)]">Quando o Instagram não mostra a foto ou o nome da pessoa, aparece só o @usuario e uma foto padrão.</p>
        </div>
        <div className="grid divide-y divide-[var(--ms-border)]">
          {contacts.length ? contacts.map((contact) => <ContactRow contact={contact} key={contact.id} />) : (
            <div className="p-8 text-center text-sm text-[var(--ms-muted)]">Nenhum contato ainda.</div>
          )}
        </div>
      </section>
    </AppFrame>
  );
}

function ContactRow({ contact }: { contact: ContactSummary }) {
  const profileLabel = contact.instagram_username ? `@${contact.instagram_username}` : contact.instagram_user_id;
  const lastActivity = contact.last_queue_at || contact.last_event_at || contact.updated_at;

  return (
    <article className="grid gap-4 p-4 xl:grid-cols-[1.15fr_0.95fr_1fr_0.9fr] xl:items-center">
      <div className="flex min-w-0 items-center gap-3">
        {contact.instagram_profile_picture_url ? (
          <img alt="Foto do perfil" className="size-12 shrink-0 rounded-full object-cover" src={contact.instagram_profile_picture_url} />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300">
            <UserRound size={20} />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold">{profileLabel}</p>
          <p className="truncate text-xs text-[var(--ms-muted)]">ID {contact.instagram_user_id}</p>
          <p className="truncate text-xs text-[var(--ms-muted)]">Perfil {contact.account_username ? `@${contact.account_username}` : "principal"}</p>
        </div>
      </div>

      <div className="grid gap-2 text-sm">
        <p className="text-xs font-semibold text-[var(--ms-muted)]">Histórico</p>
        <div className="flex flex-wrap gap-2">
          <span className="status-pill"><MessageCircle size={13} /> {contact.event_count} recebidos</span>
          <span className="status-pill status-pill-green"><CheckCircle2 size={13} /> {contact.sent_count} enviadas</span>
          {contact.pending_count ? <span className="status-pill status-pill-amber"><Clock3 size={13} /> {contact.pending_count} esperando</span> : null}
          {contact.failed_count ? <span className="status-pill text-red-500"><AlertCircle size={13} /> {contact.failed_count} erros</span> : null}
        </div>
      </div>

      <div className="min-w-0 text-sm">
        <p className="text-xs font-semibold text-[var(--ms-muted)]">Última interação</p>
        <p className="mt-1 truncate font-medium">{contact.last_event_text || (contact.last_event_type ? eventTypeLabel(contact.last_event_type) : "Sem texto")}</p>
        <p className="mt-1 text-xs text-[var(--ms-muted)]">{formatDate(lastActivity)}</p>
        {contact.last_queue_error ? <p className="mt-2 text-xs text-red-500">{contact.last_queue_error}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        {contact.human_paused_at ? <span className="status-pill status-pill-amber"><PauseCircle size={13} /> Pausado</span> : <span className="status-pill status-pill-green">Automático ligado</span>}
        {contact.last_automation_name ? <span className="status-pill max-w-full truncate">{contact.last_automation_name}</span> : <span className="status-pill">Sem automação</span>}
        <ContactPauseControls contactId={contact.id} paused={Boolean(contact.human_paused_at)} />
      </div>
    </article>
  );
}

function MiniCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--ms-muted)]">{label}</p>
          <p className="mt-3 break-words text-2xl font-bold">{value}</p>
        </div>
        <div className="metric-icon metric-violet">{icon}</div>
      </div>
    </article>
  );
}
