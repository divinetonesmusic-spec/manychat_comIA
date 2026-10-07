import type { ReactNode } from "react";
import Link from "next/link";
import {
  Bot,
  Camera,
  CheckCheck,
  MessageCircle,
  PauseCircle,
  Search,
  Tag,
  UserRound,
  Workflow,
  Zap,
} from "lucide-react";
import { AppFrame, eventTypeLabel, formatDate } from "../app-frame";
import { ManualMessageComposer } from "./manual-message-composer";
import {
  getConfig,
  getInboxConversation,
  listAutomations,
  listContacts,
  listPublicInstagramAccounts,
  type ContactSummary,
  type InboxConversationMessage,
} from "@/lib/db/repositories";
import { getCurrentWorkspaceContext } from "@/lib/workspace";
import { getSelectedAccountId, type AccountRouteSearchParams } from "@/lib/account-routing";

export const dynamic = "force-dynamic";

type InboxSearchParams = AccountRouteSearchParams & {
  contactId?: string | string[];
  q?: string | string[];
  filter?: string | string[];
};

type Props = {
  searchParams: Promise<InboxSearchParams>;
};

export default async function CaixaDeEntradaPage({ searchParams }: Props) {
  const params = await searchParams;
  const [workspaceContext, accounts] = await Promise.all([getCurrentWorkspaceContext(), listPublicInstagramAccounts()]);
  const activeAccountId = getSelectedAccountId(params, accounts);
  const [config, contacts, automations] = await Promise.all([
    getConfig(activeAccountId),
    listContacts(120, activeAccountId),
    listAutomations(activeAccountId),
  ]);

  const connected = Boolean(config.instagram_user_id);
  const query = getParam(params.q).trim();
  const filter = getParam(params.filter) || "all";
  const filteredContacts = filterContacts(contacts, query, filter);
  const requestedContactId = getParam(params.contactId);
  const selectedContactId = filteredContacts.some((contact) => contact.id === requestedContactId)
    ? requestedContactId
    : filteredContacts[0]?.id ?? null;
  const { contact: selectedContact, messages } = await getInboxConversation(selectedContactId, activeAccountId);
  const currentPath = inboxHref({ accountId: activeAccountId, contactId: selectedContact?.id ?? selectedContactId, q: query, filter });
  const activeContacts = contacts.filter((contact) => !isPaused(contact)).length;
  const pendingContacts = contacts.filter((contact) => contact.pending_count > 0).length;
  const failedContacts = contacts.filter((contact) => contact.failed_count > 0).length;

  return (
    <AppFrame active="inbox" connected={connected} username={config.instagram_username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <section className="h-[calc(100svh-5.5rem)] min-h-0 overflow-hidden rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] shadow-[var(--ms-shadow)]">
        <div className="flex h-full min-h-0 flex-col xl:grid xl:grid-cols-[330px_minmax(0,1fr)_300px]">
          <ConversationList
            activeAccountId={activeAccountId}
            activeContacts={activeContacts}
            contacts={filteredContacts}
            failedContacts={failedContacts}
            filter={filter}
            pendingContacts={pendingContacts}
            query={query}
            selectedContactId={selectedContact?.id ?? selectedContactId}
          />

          <ConversationPane contact={selectedContact} messages={messages} currentPath={currentPath} />

          <ContactProfilePanel contact={selectedContact} automations={automations} currentPath={currentPath} />
        </div>
      </section>
    </AppFrame>
  );
}

function ConversationList({
  activeAccountId,
  activeContacts,
  contacts,
  failedContacts,
  filter,
  pendingContacts,
  query,
  selectedContactId,
}: {
  activeAccountId: string | null;
  activeContacts: number;
  contacts: ContactSummary[];
  failedContacts: number;
  filter: string;
  pendingContacts: number;
  query: string;
  selectedContactId: string | null;
}) {
  const filters = [
    { key: "all", label: "Todas", count: contacts.length },
    { key: "active", label: "Ativas", count: activeContacts },
    { key: "pending", label: "Esperando", count: pendingContacts },
    { key: "failed", label: "Com erro", count: failedContacts },
  ];

  return (
    <aside className="flex min-h-[420px] flex-col border-b border-[var(--ms-border)] bg-[var(--ms-surface)] xl:h-full xl:min-h-0 xl:border-b-0 xl:border-r">
      <div className="border-b border-[var(--ms-border)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-[var(--ms-muted)]">Caixa de entrada</p>
            <h1 className="mt-1 text-xl font-bold">Conversas</h1>
          </div>
          <span className="rounded-full bg-[var(--ms-primary)]/10 px-2.5 py-1 text-xs font-bold text-[var(--ms-primary)]">{activeContacts} ativas</span>
        </div>

        <form action="/caixa-de-entrada" className="mt-4">
          {activeAccountId ? <input name="accountId" type="hidden" value={activeAccountId} /> : null}
          {filter !== "all" ? <input name="filter" type="hidden" value={filter} /> : null}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ms-muted)]" size={16} />
            <input className="search-input h-10" defaultValue={query} name="q" placeholder="Buscar conversas" />
          </div>
        </form>

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {filters.map((item) => {
            const selected = item.key === filter;
            return (
              <Link
                className={selected ? "grid h-16 min-w-0 content-center rounded-xl bg-[var(--ms-primary)] px-1.5 py-2 text-center text-white dark:text-[#101522]" : "grid h-16 min-w-0 content-center rounded-xl px-1.5 py-2 text-center text-[var(--ms-muted)] hover:bg-[var(--ms-surface-soft)]"}
                href={inboxHref({ accountId: activeAccountId, q: query, filter: item.key })}
                key={item.key}
              >
                <span className="truncate text-xs font-bold">{item.label}</span>
                <span className={selected ? "mt-0.5 text-sm font-black" : "mt-0.5 text-sm font-bold opacity-75"}>{item.count}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {contacts.length ? contacts.map((contact) => (
          <ConversationItem
            contact={contact}
            href={inboxHref({ accountId: activeAccountId, contactId: contact.id, q: query, filter })}
            key={contact.id}
            selected={contact.id === selectedContactId}
          />
        )) : (
          <div className="grid place-items-center p-8 text-center text-sm text-[var(--ms-muted)]">
            <MessageCircle className="mb-3" size={28} />
            Nenhuma conversa encontrada.
          </div>
        )}
      </div>
    </aside>
  );
}

function ConversationItem({ contact, href, selected }: { contact: ContactSummary; href: string; selected: boolean }) {
  const name = contactLabel(contact);
  const preview = contact.last_event_text || contact.last_queue_error || (contact.last_event_type ? eventTypeLabel(contact.last_event_type) : "Sem mensagem recente");
  const lastActivity = contact.last_queue_at || contact.last_event_at || contact.updated_at;

  return (
    <Link className={selected ? "block border-l-4 border-[var(--ms-primary)] bg-[var(--ms-surface-soft)] p-4" : "block border-l-4 border-transparent p-4 hover:bg-[var(--ms-surface-soft)]"} href={href}>
      <div className="flex gap-3">
        <Avatar contact={contact} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="truncate text-sm font-bold">{name}</p>
            <span className="shrink-0 text-xs text-[var(--ms-muted)]">{shortDate(lastActivity)}</span>
          </div>
          <p className={contact.pending_count ? "mt-1 truncate text-sm font-bold" : "mt-1 truncate text-sm text-[var(--ms-muted)]"}>{preview}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-pink-500/10 px-2 py-1 text-xs font-bold text-pink-600 dark:text-pink-300"><Camera size={12} /> Instagram</span>
            {contact.pending_count ? <span className="rounded-md bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-700 dark:text-amber-300">{contact.pending_count} esperando</span> : null}
            {isPaused(contact) ? <span className="rounded-md bg-orange-500/15 px-2 py-1 text-xs font-bold text-orange-700 dark:text-orange-300">pausado</span> : null}
          </div>
        </div>
      </div>
    </Link>
  );
}

function ConversationPane({ contact, messages, currentPath }: { contact: ContactSummary | null; messages: InboxConversationMessage[]; currentPath: string }) {
  if (!contact) {
    return (
      <section className="grid min-h-[420px] place-items-center bg-[var(--ms-surface-soft)] p-8 text-center xl:h-full xl:min-h-0">
        <div className="max-w-sm">
          <MessageCircle className="mx-auto text-[var(--ms-muted)]" size={36} />
          <h2 className="mt-4 text-xl font-bold">Nenhuma conversa selecionada</h2>
          <p className="mt-2 text-sm text-[var(--ms-muted)]">Quando chegarem comentários ou mensagens no direct, eles aparecem aqui para você atender.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[520px] flex-col bg-[var(--ms-surface-soft)] xl:h-full xl:min-h-0">
      <div className="flex min-h-16 items-center justify-between gap-4 border-b border-[var(--ms-border)] bg-[var(--ms-surface)]/90 px-5 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar contact={contact} size="sm" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold">{contactLabel(contact)}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ms-muted)]">
              <span className="inline-flex items-center gap-1"><Camera size={12} /> @{contact.account_username ?? "perfil"}</span>
              <span>{isPaused(contact) ? "Atendimento humano" : "Automação ativa"}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-button" type="button" aria-label="Automações" title="Automações"><Workflow size={17} /></button>
          <button className="icon-button" type="button" aria-label="Ação rápida" title="Ação rápida"><Zap size={17} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length ? (
          <div className="flex min-h-full flex-col-reverse justify-start gap-4">
            {messages.map((message) => <MessageBubble key={`${message.direction}-${message.id}`} message={message} />)}
          </div>
        ) : (
          <div className="grid h-full place-items-center text-center text-sm text-[var(--ms-muted)]">
            <div>
              <MessageCircle className="mx-auto mb-3" size={28} />
              Nenhuma mensagem detalhada para este contato.
            </div>
          </div>
        )}
      </div>

      <ManualMessageComposer contact={contact} currentPath={currentPath} />
    </section>
  );
}

function MessageBubble({ message }: { message: InboxConversationMessage }) {
  const outbound = message.direction === "outbound";

  if (message.label === "message_reaction") {
    return (
      <article className="mx-auto max-w-[82%] rounded-full border border-[var(--ms-border)] bg-[var(--ms-surface)] px-3 py-1.5 text-center text-xs font-semibold text-[var(--ms-muted)]">
        <span>{message.body}</span>
        <span className="ml-2 font-normal">{formatDate(message.created_at)}</span>
      </article>
    );
  }

  return (
    <article className={outbound ? "ml-auto flex max-w-[82%] flex-row-reverse items-end gap-3" : "mr-auto flex max-w-[82%] items-end gap-3"}>
      <div className={outbound ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ms-primary)] text-xs font-bold text-white dark:text-[#101522]" : "flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ms-surface)] text-[var(--ms-primary)]"}>
        {outbound ? "UF" : <UserRound size={16} />}
      </div>
      <div className={outbound ? "text-right" : "text-left"}>
        <div className={outbound ? "rounded-l-2xl rounded-br-2xl bg-[var(--ms-primary)] p-4 text-white shadow-sm dark:text-[#101522]" : "rounded-r-2xl rounded-bl-2xl border border-[var(--ms-border)] bg-[var(--ms-surface)] p-4 text-[var(--ms-foreground)] shadow-sm"}>
          <p className="whitespace-pre-wrap text-sm leading-6">{message.body}</p>
        </div>
        <div className={outbound ? "mt-1 flex items-center justify-end gap-1 text-xs text-[var(--ms-muted)]" : "mt-1 flex items-center gap-1 text-xs text-[var(--ms-muted)]"}>
          <span>{formatDate(message.created_at)}</span>
          {outbound ? <CheckCheck size={13} /> : null}
          {message.status ? <span>{translateMessageStatus(message.status)}</span> : null}
        </div>
      </div>
    </article>
  );
}

function ContactProfilePanel({ contact, automations, currentPath }: { contact: ContactSummary | null; automations: { id: string; name: string; active: boolean }[]; currentPath: string }) {
  if (!contact) {
    return <aside className="hidden border-l border-[var(--ms-border)] bg-[var(--ms-surface)] xl:block xl:h-full xl:min-h-0" />;
  }

  const relatedAutomations = [contact.last_automation_name, ...automations.filter((automation) => automation.active).slice(0, 3).map((automation) => automation.name)].filter(Boolean);

  return (
    <aside className="flex min-h-[420px] flex-col border-t border-[var(--ms-border)] bg-[var(--ms-surface)] xl:h-full xl:min-h-0 xl:border-l xl:border-t-0">
      <div className="border-b border-[var(--ms-border)] p-6 text-center">
        <div className="mx-auto w-fit"><Avatar contact={contact} size="lg" /></div>
        <h2 className="mt-4 truncate text-lg font-bold">{contactLabel(contact)}</h2>
        <p className="mt-1 truncate text-sm text-[var(--ms-muted)]">{contact.instagram_username ? `@${contact.instagram_username}` : `ID ${contact.instagram_user_id}`}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <span className={contact.is_user_follow_business ? "status-pill status-pill-green justify-center" : "status-pill justify-center"}>Segue você</span>
          <span className={contact.is_business_follow_user ? "status-pill status-pill-green justify-center" : "status-pill justify-center"}>Você segue</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <PanelBlock icon={<UserRound size={17} />} title="Contato">
          <InfoRow label="ID no Instagram" value={contact.instagram_user_id} />
          <InfoRow label="Conta" value={contact.account_username ? `@${contact.account_username}` : "Perfil principal"} />
          <InfoRow label="Primeiro contato" value={formatDate(contact.first_contact_at)} />
          <InfoRow label="Última resposta" value={formatDate(contact.last_response_at)} />
        </PanelBlock>

        <PanelBlock icon={<Tag size={17} />} title="Tags">
          <div className="flex flex-wrap gap-2">
            {contact.tags.length ? contact.tags.map((tag) => (
              <form action={`/api/contacts/${contact.id}/tags`} key={tag} method="post">
                <input name="action" type="hidden" value="remove" />
                <input name="tag" type="hidden" value={tag} />
                <input name="next" type="hidden" value={currentPath} />
                <button className="rounded-md border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] px-2 py-1 text-xs font-bold text-[var(--ms-foreground)]" type="submit">{tag} x</button>
              </form>
            )) : <span className="text-sm text-[var(--ms-muted)]">Sem tags</span>}
          </div>
          <form action={`/api/contacts/${contact.id}/tags`} className="mt-3 flex gap-2" method="post">
            <input name="action" type="hidden" value="add" />
            <input name="next" type="hidden" value={currentPath} />
            <input className="input h-10 min-w-0 text-sm" name="tag" placeholder="Nova tag" />
            <button className="btn-secondary h-10 px-3" type="submit"><Tag size={15} /></button>
          </form>
        </PanelBlock>

        <PanelBlock icon={<Workflow size={17} />} title="Automações">
          <div className="grid gap-2">
            {relatedAutomations.length ? relatedAutomations.map((name, index) => (
              <div className="flex items-center justify-between rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3" key={`${name}-${index}`}>
                <span className="truncate text-sm font-bold">{name}</span>
                {index === 0 && contact.last_automation_name ? <Bot className="text-[var(--ms-primary)]" size={16} /> : <Workflow className="text-[var(--ms-muted)]" size={16} />}
              </div>
            )) : <p className="text-sm text-[var(--ms-muted)]">Sem automação ligada a este contato.</p>}
          </div>
        </PanelBlock>

        <PanelBlock icon={<PauseCircle size={17} />} title="Atendimento">
          <div className="grid gap-2 text-sm">
            <InfoRow label="Status" value={isPaused(contact) ? "Pausado: atendimento humano" : "Automação ativa"} />
            {contact.human_pause_reason ? <InfoRow label="Motivo" value={contact.human_pause_reason} /> : null}
            {contact.human_paused_until ? <InfoRow label="Retorno" value={formatDate(contact.human_paused_until)} /> : null}
          </div>
        </PanelBlock>
      </div>
    </aside>
  );
}

function PanelBlock({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="border-b border-[var(--ms-border)] py-5 first:pt-0 last:border-b-0">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase text-[var(--ms-muted)]">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-xs font-semibold text-[var(--ms-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

function Avatar({ contact, size }: { contact: ContactSummary; size: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "size-24" : size === "md" ? "size-12" : "size-10";
  const initials = getInitials(contact);

  return (
    <div className={`relative shrink-0 ${sizeClass}`}>
      {contact.instagram_profile_picture_url ? (
        <img alt="Foto do contato" className="h-full w-full rounded-full object-cover" src={contact.instagram_profile_picture_url} />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-full bg-[var(--ms-primary)]/10 text-sm font-black text-[var(--ms-primary)]">{initials}</div>
      )}
      <span className="absolute bottom-0 right-0 grid size-5 place-items-center rounded-full border border-[var(--ms-surface)] bg-pink-500 text-white">
        <Camera size={12} />
      </span>
    </div>
  );
}

function filterContacts(contacts: ContactSummary[], query: string, filter: string) {
  const normalizedQuery = normalize(query);

  return contacts.filter((contact) => {
    if (filter === "active" && isPaused(contact)) return false;
    if (filter === "pending" && contact.pending_count === 0) return false;
    if (filter === "failed" && contact.failed_count === 0) return false;

    if (!normalizedQuery) return true;
    const haystack = [contact.instagram_username, contact.instagram_name, contact.instagram_user_id, contact.last_event_text, contact.last_automation_name, ...contact.tags].filter(Boolean).join(" ");
    return normalize(haystack).includes(normalizedQuery);
  });
}

function inboxHref(input: { accountId?: string | null; contactId?: string | null; q?: string | null; filter?: string | null }) {
  const params = new URLSearchParams();
  if (input.accountId) params.set("accountId", input.accountId);
  if (input.contactId) params.set("contactId", input.contactId);
  if (input.q) params.set("q", input.q);
  if (input.filter && input.filter !== "all") params.set("filter", input.filter);
  const search = params.toString();
  return `/caixa-de-entrada${search ? `?${search}` : ""}`;
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function contactLabel(contact: ContactSummary) {
  return contact.instagram_name || (contact.instagram_username ? `@${contact.instagram_username}` : `Contato ${contact.instagram_user_id.slice(-6)}`);
}

function getInitials(contact: ContactSummary) {
  const label = contact.instagram_name || contact.instagram_username || contact.instagram_user_id;
  return label.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "IG";
}

function isPaused(contact: ContactSummary) {
  if (!contact.human_paused_at) return false;
  if (!contact.human_paused_until) return true;
  return new Date(contact.human_paused_until).getTime() > Date.now();
}

function shortDate(value: string | null) {
  if (!value) return "--";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function translateMessageStatus(status: string) {
  const labels: Record<string, string> = {
    delivered: "Entregue",
    failed: "Erro",
    pending: "Pendente",
    processing: "Enviando",
    queued: "Esperando para sair",
    read: "Lida",
    sending: "Enviando",
    sent: "Enviada",
    skipped: "Ignorado",
  };

  return labels[status] || status;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}