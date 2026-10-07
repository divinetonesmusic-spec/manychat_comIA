"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Bell, Bot, CircleHelp, Contact, GitBranch, Home, ImageIcon, Inbox, Plus, Search, Settings, UserCircle, Workflow } from "lucide-react";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";
import { BrandMark } from "@/components/brand-mark";
import type { PublicInstagramAccount } from "@/lib/instagram/public-account";
import { hrefWithAccount } from "@/lib/account-routing";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export type AppSection = "inicio" | "automacoes" | "fluxos" | "conteudo" | "perfis" | "contatos" | "inbox" | "configuracoes" | "ai";

type AppShellProps = {
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

const navigation = [
  { key: "inicio", label: "Inicial", icon: Home, href: "/dashboard" },
  { key: "inbox", label: "Caixa de entrada", icon: Inbox, href: "/caixa-de-entrada" },
  { key: "automacoes", label: "Automacoes", icon: Workflow, href: "/automacoes" },
  { key: "fluxos", label: "Fluxos", icon: GitBranch, href: "/fluxos" },
  { key: "conteudo", label: "Conteudo", icon: ImageIcon, href: "/conteudo" },
  { key: "perfis", label: "Perfis", icon: UserCircle, href: "/perfis" },
  { key: "contatos", label: "Contatos", icon: Contact, href: "/contatos" },
  { key: "ai", label: "Assistente UaiFlow", icon: Bot, href: "/automacoes#ai" },
  { key: "configuracoes", label: "Configuracoes", icon: Settings, href: "/configuracoes" },
] as const;

export function AppShell({ active, connected, accounts = [], activeAccountId = null, children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? accounts.find((account) => account.is_default) ?? accounts[0] ?? null;
  const selectedAccountId = activeAccount?.id ?? activeAccountId ?? null;

  function accountHref(href: string) {
    return hrefWithAccount(href, selectedAccountId);
  }

  function changeAccount(accountId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (accountId) params.set("accountId", accountId);
    else params.delete("accountId");
    const query = params.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}`);
    router.refresh();
  }

  return (
    <TooltipProvider>
      <SidebarProvider className="bg-[var(--ms-background)] text-[var(--ms-foreground)]">
        <Sidebar collapsible="icon" className="border-[var(--ms-border)] bg-[var(--ms-sidebar)]">
          <SidebarHeader className="px-3 py-4">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  tooltip="UaiFlow"
                  render={<Link href={accountHref("/dashboard")} />}
                  className="h-12 data-[active=true]:bg-sidebar-accent"
                >
                  <div className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-[var(--ms-surface)] shadow-sm ring-1 ring-[var(--ms-border)]">
                    <BrandMark className="size-8 object-cover" priority size={32} />
                  </div>
                  <div className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate text-base font-black">UaiFlow</span>
                    <span className="truncate text-xs text-sidebar-foreground/65">Automacao Instagram</span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Menu</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigation.map((item) => {
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton
                          isActive={active === item.key}
                          tooltip={item.label}
                          render={<Link href={accountHref(item.href)} />}
                          className="data-[active=true]:bg-[var(--ms-primary)] data-[active=true]:text-white dark:data-[active=true]:text-[#101522]"
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarSeparator />

          <SidebarFooter className="p-3">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Ajuda" render={<Link href={accountHref("/configuracoes")} />}>
                  <CircleHelp />
                  <span>Ajuda</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SignOutButton />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-h-screen bg-[var(--ms-background)]">
          <header className="sticky top-0 z-20 border-b border-[var(--ms-border)] bg-[var(--ms-surface)]/90 backdrop-blur">
            <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <SidebarTrigger className="text-[var(--ms-muted)] hover:bg-[var(--ms-surface-soft)]" />
                <div className="relative hidden w-full max-w-md sm:block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ms-muted)]" size={17} />
                  <input className="search-input" placeholder="Buscar automacoes, contatos ou eventos" />
                </div>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                {accounts.length ? (
                  <select className="input hidden h-11 w-[240px] max-w-[28vw] truncate py-0 text-sm leading-normal lg:w-[280px] md:block" value={selectedAccountId ?? ""} onChange={(event) => changeAccount(event.target.value)}>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>@{account.instagram_username}</option>
                    ))}
                  </select>
                ) : null}
                <span className={connected ? "status-pill status-pill-green" : "status-pill"}>{connected ? "Conectado" : "Desconectado"}</span>
                <ThemeToggle />
                <button className="icon-button" type="button" aria-label="Notificacoes" title="Notificacoes">
                  <Bell size={18} />
                </button>
                <Link className="btn-primary hidden sm:inline-flex" href={accountHref("/automacoes/nova")}>
                  <Plus size={16} />
                  Nova automacao
                </Link>
              </div>
            </div>
          </header>

          <div className="mx-auto grid w-full max-w-[1500px] gap-4 px-3 py-3 sm:px-4 lg:px-5">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
