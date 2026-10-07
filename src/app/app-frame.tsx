import type { ReactNode } from "react";
import { AppShell, type AppSection } from "./app-shell";
import type { PublicInstagramAccount } from "@/lib/instagram/public-account";

export type { AppSection };

type Props = {
  active: AppSection;
  connected: boolean;
  username: string | null;
  accounts?: PublicInstagramAccount[];
  activeAccountId?: string | null;
  workspaceName?: string | null;
  userEmail?: string | null;
  plan?: string | null;
  children: ReactNode;
};

export function AppFrame({ active, connected, username, accounts = [], activeAccountId = null, workspaceName, userEmail, plan, children }: Props) {
  return (
    <AppShell active={active} connected={connected} username={username} accounts={accounts} activeAccountId={activeAccountId} workspaceName={workspaceName} userEmail={userEmail} plan={plan}>
      {children}
    </AppShell>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-normal sm:text-4xl">{title}</h1>
          {description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ms-muted)] sm:text-base">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap gap-2 lg:justify-end">{action}</div> : null}
      </div>
    </section>
  );
}

export function MiniStat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <article className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--ms-muted)]">{label}</p>
          <p className="mt-3 break-words text-2xl font-bold">{value}</p>
        </div>
        <div className="metric-icon metric-blue">{icon}</div>
      </div>
    </article>
  );
}

export function formatDate(value: string | null) {
  if (!value) return "Sem registro";
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function getTokenStatus(value: string | null) {
  if (!value) return "Não conectada";
  const expiresAt = new Date(value).getTime();
  const days = Math.max(0, Math.ceil((expiresAt - Date.now()) / 86_400_000));
  return days > 0 ? `Vence em ${days} ${days === 1 ? "dia" : "dias"}` : "Vencida";
}

/** Nome simples do tipo de evento que o Instagram mandou (o valor guardado no banco continua o mesmo). */
export function eventTypeLabel(type: string | null) {
  const nomes: Record<string, string> = {
    comment: "Comentário",
    message: "Mensagem",
    story_reply: "Resposta a um story",
    message_reaction: "Reação a uma mensagem",
  };
  return (type && nomes[type]) || type || "Mensagem";
}
