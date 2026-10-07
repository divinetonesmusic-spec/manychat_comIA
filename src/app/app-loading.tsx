import type { ReactNode } from "react";
import { Activity, Contact, GitBranch, ImageIcon, Inbox, Settings, UserCircle, Workflow } from "lucide-react";
import { AppFrame, type AppSection } from "./app-frame";
import { Skeleton } from "@/components/ui/skeleton";

const labels: Record<AppSection, { eyebrow: string; title: string; description: string; icon: ReactNode }> = {
  inicio: {
    eyebrow: "Início",
    title: "Preparando painel",
    description: "Carregando a conexão com o Instagram e os números recentes.",
    icon: <Activity size={20} />,
  },
  automacoes: {
    eyebrow: "Automações",
    title: "Carregando automações",
    description: "Buscando modelos, posts e regras para criar.",
    icon: <Workflow size={20} />,
  },
  fluxos: {
    eyebrow: "Fluxos",
    title: "Carregando fluxos",
    description: "Buscando status, regras salvas e logs recentes.",
    icon: <GitBranch size={20} />,
  },
  conteudo: {
    eyebrow: "Conteúdo",
    title: "Carregando publicações",
    description: "Buscando o histórico e preparando o publicador do perfil selecionado.",
    icon: <ImageIcon size={20} />,
  },  perfis: {
    eyebrow: "Perfis",
    title: "Carregando perfil",
    description: "Verificando menus, perguntas de início e automações do sistema.",
    icon: <UserCircle size={20} />,
  },
  contatos: {
    eyebrow: "Contatos",
    title: "Carregando contatos",
    description: "Organizando as pessoas e as últimas interações.",
    icon: <Contact size={20} />,
  },
  inbox: {
    eyebrow: "Caixa de entrada",
    title: "Carregando conversas",
    description: "Montando a linha do tempo das conversas recebidas.",
    icon: <Inbox size={20} />,
  },
  configuracoes: {
    eyebrow: "Configurações",
    title: "Carregando configurações",
    description: "Verificando a conta, a conexão com o Instagram e os endereços oficiais.",
    icon: <Settings size={20} />,
  },
  ai: {
    eyebrow: "Assistente UaiFlow",
    title: "Carregando assistente",
    description: "Preparando contexto do editor visual.",
    icon: <Workflow size={20} />,
  },
};

type Props = {
  active: AppSection;
  variant?: "dashboard" | "list" | "timeline" | "settings";
};

export function AppPageLoading({ active, variant = "dashboard" }: Props) {
  const copy = labels[active];

  return (
    <AppFrame active={active} connected={false} username={null} workspaceName="UaiFlow" userEmail="carregando..." plan="">
      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]" aria-live="polite" aria-busy="true">
        <section className="panel p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{copy.eyebrow}</p>
              <h1 className="mt-2 text-3xl font-bold tracking-normal sm:text-4xl">{copy.title}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ms-muted)] sm:text-base">{copy.description}</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] px-3 py-2 text-sm font-semibold text-[var(--ms-muted)]">
              <span className="inline-flex size-8 animate-spin items-center justify-center rounded-lg bg-[var(--ms-surface)] text-[var(--ms-primary)]">
                {copy.icon}
              </span>
              Sincronizando
            </div>
          </div>
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-3 w-24 bg-[var(--ms-surface-soft)]" />
              <Skeleton className="h-6 w-44 bg-[var(--ms-surface-soft)]" />
            </div>
            <Skeleton className="size-10 bg-[var(--ms-surface-soft)]" />
          </div>
          <div className="mt-5 grid gap-3">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        </section>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <article className="panel p-5" key={index}>
            <div className="flex items-start justify-between gap-4">
              <div className="grid flex-1 gap-3">
                <Skeleton className="h-4 w-24 bg-[var(--ms-surface-soft)]" />
                <Skeleton className="h-8 w-28 bg-[var(--ms-surface-soft)]" />
              </div>
              <Skeleton className="size-10 bg-[var(--ms-surface-soft)]" />
            </div>
          </article>
        ))}
      </section>

      {variant === "timeline" ? <TimelineSkeleton /> : variant === "settings" ? <SettingsSkeleton /> : variant === "list" ? <ListSkeleton /> : <DashboardSkeleton />}
    </AppFrame>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3">
      <Skeleton className="size-9 bg-[var(--ms-surface)]" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-3 w-28 bg-[var(--ms-surface)]" />
        <Skeleton className="h-3 w-full bg-[var(--ms-surface)]" />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <section className="grid gap-6 xl:grid-cols-[1fr_390px]">
      <ListPanelSkeleton rows={5} tall />
      <aside className="grid content-start gap-6">
        <PanelSkeleton rows={4} />
        <PanelSkeleton rows={3} />
      </aside>
    </section>
  );
}

function ListSkeleton() {
  return (
    <section className="grid gap-6 2xl:grid-cols-[0.9fr_1.1fr]">
      <FormSkeleton />
      <ListPanelSkeleton rows={6} />
    </section>
  );
}

function TimelineSkeleton() {
  return (
    <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <ListPanelSkeleton rows={8} />
      <ListPanelSkeleton rows={5} tall />
    </section>
  );
}

function SettingsSkeleton() {
  return (
    <section className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
      <PanelSkeleton rows={5} />
      <div className="grid content-start gap-6">
        <PanelSkeleton rows={5} />
        <PanelSkeleton rows={2} />
      </div>
    </section>
  );
}

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-3 w-20 bg-[var(--ms-surface-soft)]" />
          <Skeleton className="h-6 w-52 bg-[var(--ms-surface-soft)]" />
        </div>
        <Skeleton className="size-9 bg-[var(--ms-surface-soft)]" />
      </div>
      <div className="mt-5 grid gap-3">
        {Array.from({ length: rows }).map((_, index) => (
          <SkeletonRow key={index} />
        ))}
      </div>
    </section>
  );
}

function FormSkeleton() {
  return (
    <section className="panel overflow-hidden p-0">
      <div className="border-b border-[var(--ms-border)] p-5 sm:p-6">
        <Skeleton className="h-4 w-24 bg-[var(--ms-surface-soft)]" />
        <Skeleton className="mt-3 h-7 w-48 bg-[var(--ms-surface-soft)]" />
      </div>
      <div className="grid gap-5 p-5 sm:p-6">
        {Array.from({ length: 7 }).map((_, index) => (
          <div className="grid gap-2" key={index}>
            <Skeleton className="h-4 w-28 bg-[var(--ms-surface-soft)]" />
            <Skeleton className="h-11 w-full bg-[var(--ms-surface-soft)]" />
          </div>
        ))}
        <Skeleton className="h-11 w-full bg-[var(--ms-primary-soft)]" />
      </div>
    </section>
  );
}

function ListPanelSkeleton({ rows, tall = false }: { rows: number; tall?: boolean }) {
  return (
    <section className="panel overflow-hidden p-0">
      <div className="border-b border-[var(--ms-border)] p-5">
        <Skeleton className="h-6 w-48 bg-[var(--ms-surface-soft)]" />
      </div>
      <div className="grid divide-y divide-[var(--ms-border)]">
        {Array.from({ length: rows }).map((_, index) => (
          <article className="grid gap-3 p-4" key={index}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 bg-[var(--ms-surface-soft)]" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-36 bg-[var(--ms-surface-soft)]" />
                <Skeleton className="h-3 w-52 bg-[var(--ms-surface-soft)]" />
              </div>
            </div>
            {tall ? <Skeleton className="h-16 w-full bg-[var(--ms-surface-soft)]" /> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
