"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Bot, CircleHelp, Contact, GitBranch, Home, ImageIcon, Inbox, Plus, Settings, UserCircle, Workflow } from "lucide-react";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";
import { BrandMark } from "@/components/brand-mark";
import type { PublicInstagramAccount } from "@/lib/instagram/public-account";
import { hrefWithAccount } from "@/lib/account-routing";
import { mensagemRetornoInstagram, PARAMETROS_RETORNO_INSTAGRAM } from "@/lib/instagram-retorno";
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
  { key: "inicio", label: "Início", icon: Home, href: "/dashboard" },
  { key: "inbox", label: "Caixa de entrada", icon: Inbox, href: "/caixa-de-entrada" },
  { key: "conteudo", label: "Conteúdo", icon: ImageIcon, href: "/conteudo" },
  { key: "contatos", label: "Contatos", icon: Contact, href: "/contatos" },
  { key: "automacoes", label: "Automações", icon: Workflow, href: "/automacoes" },
  { key: "perfis", label: "Perfis", icon: UserCircle, href: "/perfis" },
] as const;

const advancedNavigation = [
  { key: "fluxos", label: "Fluxos", icon: GitBranch, href: "/fluxos" },
  { key: "ai", label: "Assistente UaiFlow", icon: Bot, href: "/automacoes#ai" },
  { key: "configuracoes", label: "Configurações", icon: Settings, href: "/configuracoes" },
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

  const retorno = mensagemRetornoInstagram(searchParams);

  function closeInstagramNotice() {
    const params = new URLSearchParams(searchParams.toString());
    for (const name of PARAMETROS_RETORNO_INSTAGRAM) params.delete(name);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`);
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
            <SidebarGroup>
              <SidebarGroupLabel>Avançado</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {advancedNavigation.map((item) => {
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
                <Link className="btn-primary hidden sm:inline-flex" href={accountHref("/automacoes/nova")}>
                  <Plus size={16} />
                  Nova automacao
                </Link>
              </div>
            </div>
          </header>

          {accounts.length ? (
            <div className="border-b border-[var(--ms-border)] bg-[var(--ms-surface)] px-4 py-3 md:hidden">
              {accounts.length > 1 ? (
                <>
                  <label className="mb-1 block text-xs font-semibold text-[var(--ms-muted)]" htmlFor="perfil-do-instagram-celular">Perfil do Instagram</label>
                  <select id="perfil-do-instagram-celular" className="input h-11 w-full py-0 text-base leading-normal" value={selectedAccountId ?? ""} onChange={(event) => changeAccount(event.target.value)}>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>{`@${account.instagram_username}${account.is_default ? " (principal)" : ""}`}</option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="text-sm">
                  <span className="block text-xs font-semibold text-[var(--ms-muted)]">Perfil do Instagram</span>
                  <span className="font-semibold">{`@${accounts[0].instagram_username}`}</span>
                </p>
              )}
            </div>
          ) : null}

          <div className="mx-auto grid w-full max-w-[1500px] gap-4 px-3 py-3 sm:px-4 lg:px-5">
            {retorno ? (
              <div
                role={retorno.tom === "erro" ? "alert" : "status"}
                className={
                  retorno.tom === "sucesso"
                    ? "flex items-start justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-800 dark:text-emerald-200"
                    : "flex items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-700 dark:text-red-200"
                }
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{retorno.texto}</p>
                  {retorno.detalhe ? <p className="mt-1 break-words text-xs opacity-80">{retorno.detalhe}</p> : null}
                </div>
                <button className="btn-secondary shrink-0" type="button" onClick={closeInstagramNotice}>Fechar</button>
              </div>
            ) : null}
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
