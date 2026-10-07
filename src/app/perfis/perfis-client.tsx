"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Download,
  Loader2,
  Menu,
  MessageSquareText,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import type { Automation, IceBreakerItem, PersistentMenuItem, ProfileSettings } from "@/lib/db/repositories";
import type { PublicConfig, PublicInstagramAccount } from "@/lib/instagram/public-account";
import { hrefWithAccount } from "@/lib/account-routing";

type Props = {
  accounts: PublicInstagramAccount[];
  automations: Automation[];
  config: PublicConfig;
  settings: ProfileSettings;
  activeAccountId?: string | null;
  metaDeveloperUrl: string;
  /** Link de conexão com token assinado (30 min), gerado no servidor. */
  connectPath: string;
};

type Notice = { tone: "success" | "error"; text: string } | null;

type DiagnosticCheck = {
  key: string;
  label: string;
  status: "ok" | "warn" | "error";
  detail: string;
};

type DiagnosticResult = {
  accountId: string | null;
  username: string | null;
  checkedAt: string;
  checks: DiagnosticCheck[];
  summary: { status: "ok" | "warn" | "error"; label: string };
};
type BusyAction = "save" | "load_menu" | "sync_menu" | "delete_menu" | "load_ice" | "sync_ice" | "delete_ice" | "copy" | null;

const emptyMenuItem: PersistentMenuItem = { title: "", type: "postback", payload: "" };
const emptyIceBreaker: IceBreakerItem = { question: "", payload: "" };

export function PerfisClient({ accounts, automations, config, settings, activeAccountId = null, metaDeveloperUrl, connectPath }: Props) {
  const [draft, setDraft] = useState(settings);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [defaultBusyId, setDefaultBusyId] = useState<string | null>(null);
  const [copySourceId, setCopySourceId] = useState("");
  const [includeAutomations, setIncludeAutomations] = useState(true);
  const [diagnostics, setDiagnostics] = useState<Record<string, DiagnosticResult>>({});
  const [diagnosticBusyId, setDiagnosticBusyId] = useState<string | null>(null);
  const connected = Boolean(config.instagram_user_id);
  const copySourceAccounts = accounts.filter((account) => account.id !== config.account_id);

  async function saveSettings(showNotice = true) {
    setBusy("save");
    setNotice(null);

    try {
      const response = await fetch("/api/profile/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, account_id: config.account_id }),
      });
      const result = (await response.json().catch(() => null)) as { data?: ProfileSettings; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error || "Nao consegui salvar as configuracoes.");
      setDraft(result.data);
      if (showNotice) setNotice({ tone: "success", text: "Configuracoes do perfil salvas." });
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Erro ao salvar perfil." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function loadMessengerProfile(kind: "persistent_menu" | "ice_breakers") {
    setBusy(kind === "persistent_menu" ? "load_menu" : "load_ice");
    setNotice(null);

    try {
      const response = await fetch(`/api/profile/messenger-profile?kind=${kind}&accountId=${config.account_id || ""}`);
      const result = (await response.json().catch(() => null)) as { data?: { data?: Array<Record<string, unknown>> }; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error || "Nao consegui buscar configuracao atual da Meta.");

      if (kind === "persistent_menu") {
        const items = parseRemotePersistentMenu(result.data);
        setDraft((current) => ({ ...current, persistent_menu_items: items }));
        setNotice({ tone: "success", text: `Menu atual carregado da Meta com ${items.length} item(ns).` });
      } else {
        const items = parseRemoteIceBreakers(result.data);
        setDraft((current) => ({ ...current, ice_breakers: items }));
        setNotice({ tone: "success", text: `Iniciadores carregados da Meta com ${items.length} item(ns).` });
      }
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Erro ao buscar configuracao da Meta." });
    } finally {
      setBusy(null);
    }
  }

  async function syncMessengerProfile(kind: "persistent_menu" | "ice_breakers") {
    const saved = await saveSettings(false);
    if (!saved) return;
    setBusy(kind === "persistent_menu" ? "sync_menu" : "sync_ice");
    setNotice(null);

    try {
      const response = await fetch("/api/profile/messenger-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, accountId: config.account_id }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Nao consegui sincronizar com a Meta.");
      setNotice({ tone: "success", text: kind === "persistent_menu" ? "Menu sincronizado com a Meta." : "Iniciadores sincronizados com a Meta." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Erro ao sincronizar com a Meta." });
    } finally {
      setBusy(null);
    }
  }

  async function deleteMessengerProfile(kind: "persistent_menu" | "ice_breakers") {
    if (!window.confirm(kind === "persistent_menu" ? "Remover o menu principal publicado na Meta?" : "Remover os iniciadores publicados na Meta?")) return;
    setBusy(kind === "persistent_menu" ? "delete_menu" : "delete_ice");
    setNotice(null);

    try {
      const response = await fetch(`/api/profile/messenger-profile?kind=${kind}&accountId=${config.account_id || ""}`, { method: "DELETE" });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Nao consegui remover na Meta.");
      setNotice({ tone: "success", text: kind === "persistent_menu" ? "Menu removido da Meta." : "Iniciadores removidos da Meta." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Erro ao remover na Meta." });
    } finally {
      setBusy(null);
    }
  }


  function getInstagramConnectUrl() {
    if (typeof window === "undefined") return connectPath;
    return new URL(connectPath, window.location.origin).toString();
  }


  async function copyMetaDeveloperUrl() {
    try {
      await navigator.clipboard.writeText(metaDeveloperUrl);
      setNotice({ tone: "success", text: "Link do Meta Developer copiado." });
    } catch {
      setNotice({ tone: "error", text: "Nao consegui copiar o link do Meta Developer automaticamente." });
    }
  }
  async function copyInstagramConnectUrl() {
    const url = getInstagramConnectUrl();
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ tone: "success", text: "Link de conexão copiado. Ele vale por 30 minutos." });
    } catch {
      setNotice({ tone: "error", text: "Nao consegui copiar automaticamente. Abra o link e copie pela barra do navegador." });
    }
  }


  async function runDiagnostics(accountId: string) {
    setDiagnosticBusyId(accountId);
    setNotice(null);

    try {
      const response = await fetch(`/api/profile/diagnostics?accountId=${encodeURIComponent(accountId)}`);
      const result = (await response.json().catch(() => null)) as { data?: DiagnosticResult; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error || "Nao consegui testar este perfil.");
      setDiagnostics((current) => ({ ...current, [accountId]: result.data as DiagnosticResult }));
      setNotice({ tone: "success", text: `Diagnostico de @${result.data.username || "perfil"} concluido.` });
    } catch (error) {
      const failed: DiagnosticResult = {
        accountId,
        username: null,
        checkedAt: new Date().toISOString(),
        summary: { status: "error", label: "Erro" },
        checks: [{ key: "diagnostic", label: "Diagnostico", status: "error", detail: error instanceof Error ? error.message : "Erro ao testar perfil." }],
      };
      setDiagnostics((current) => ({ ...current, [accountId]: failed }));
      setNotice({ tone: "error", text: failed.checks[0].detail });
    } finally {
      setDiagnosticBusyId(null);
    }
  }
  async function makeDefaultAccount(accountId: string) {
    setDefaultBusyId(accountId);
    setNotice(null);

    try {
      const response = await fetch(`/api/instagram-accounts/${accountId}/default`, { method: "POST" });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Nao consegui definir o perfil principal.");
      setNotice({ tone: "success", text: "Perfil principal atualizado." });
      window.location.reload();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Erro ao trocar perfil." });
    } finally {
      setDefaultBusyId(null);
    }
  }

  async function copyProfileSettings() {
    if (!copySourceId || !config.account_id) {
      setNotice({ tone: "error", text: "Escolha o perfil de origem e o perfil de destino." });
      return;
    }

    if (!window.confirm("Copiar configuracoes para este perfil? As configuracoes atuais deste perfil serao substituidas.")) return;

    setBusy("copy");
    setNotice(null);

    try {
      const response = await fetch("/api/profile/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceAccountId: copySourceId,
          targetAccountId: config.account_id,
          includeAutomations,
        }),
      });
      const result = (await response.json().catch(() => null)) as { data?: { clonedAutomations: number }; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error || "Nao consegui copiar as configuracoes.");
      setNotice({ tone: "success", text: `Configuracoes copiadas. ${result.data.clonedAutomations} fluxo(s) duplicado(s).` });
      window.location.href = hrefWithAccount("/perfis", activeAccountId);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Erro ao copiar configuracoes." });
    } finally {
      setBusy(null);
    }
  }
  function updateMenuItem(index: number, field: keyof PersistentMenuItem, value: string) {
    setDraft((current) => ({
      ...current,
      persistent_menu_items: current.persistent_menu_items.map((item, itemIndex) => itemIndex === index ? normalizeMenuItem({ ...item, [field]: value }) : item),
    }));
  }

  function updateIceBreaker(index: number, field: keyof IceBreakerItem, value: string) {
    setDraft((current) => ({
      ...current,
      ice_breakers: current.ice_breakers.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }));
  }

  function fillMenuExample() {
    const green = String.fromCodePoint(0x1f7e2);
    const point = String.fromCodePoint(0x1f449);
    const talk = String.fromCodePoint(0x1f5e3, 0xfe0f);
    const link = String.fromCodePoint(0x1f517);
    setDraft((current) => ({
      ...current,
      persistent_menu_items: [
        { type: "postback", title: `${green} Baixar APP`, payload: "1" },
        { type: "postback", title: `${point} Tirar duvidas`, payload: "2" },
        { type: "postback", title: `${talk} Contato Suporte`, payload: "3" },
        { type: "web_url", title: `${link} ACESSE O SITE`, url: window.location.origin },
      ],
    }));
  }

  return (
    <div className="grid gap-6">
      <details className="panel">
        <summary className="cursor-pointer select-none p-5 text-base font-bold sm:px-6">Avançado: configuração na Meta</summary>
        <div className="grid gap-5 px-5 pb-5 sm:px-6 sm:pb-6 xl:grid-cols-[1fr_440px] xl:items-start">
          <div>
            <p className="eyebrow">Antes de conectar</p>
            <h2 className="mt-1 text-2xl font-bold">Siga a ordem certa para adicionar um Instagram</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ms-muted)]">
              Enquanto o app esta em modo de teste, cada perfil precisa primeiro ser adicionado/autorizado no Meta Developer. Depois disso, use o login do UaiFlow no navegador onde a conta esta aberta.
            </p>
          </div>
          <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4">
            <OnboardingStep number="1" title="Adicionar no Meta Developer" text="Abra o caso de uso do app e adicione a conta profissional em Gerar tokens de acesso / Adicionar conta." />
            <OnboardingStep number="2" title="Conferir requisitos" text="A conta precisa ser profissional, publica, autorizada como teste e com webhook ativado no painel da Meta." />
            <OnboardingStep number="3" title="Fazer login pelo UaiFlow" text="Use Abrir neste navegador ou Copiar link para autenticar no navegador/computador onde o Instagram esta logado." />
            <OnboardingStep number="4" title="Testar conexao" text="Depois que o perfil aparecer na lista, clique em Testar conexao para validar token, posts, webhook, menu e iniciadores." />
            <div className="flex flex-wrap gap-2 border-t border-[var(--ms-border)] pt-3">
              <Link className="btn-primary" href={metaDeveloperUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Abrir Meta Developer</Link>
              <button className="btn-secondary" onClick={copyMetaDeveloperUrl} type="button"><Copy size={16} /> Copiar link Meta</button>
              <button className="btn-secondary" onClick={copyInstagramConnectUrl} type="button"><Copy size={16} /> Copiar login</button>
            </div>
          </div>
        </div>
      </details>
      <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            {config.instagram_profile_picture_url ? (
              <img alt="Perfil do Instagram" className="size-16 rounded-full object-cover" src={config.instagram_profile_picture_url} />
            ) : <div className="grid size-16 place-items-center rounded-full bg-[var(--ms-surface-soft)]"><ShieldCheck size={24} /></div>}
            <div className="min-w-0">
              <p className="eyebrow">Instagram</p>
              <h2 className="mt-1 truncate text-2xl font-bold">{connected ? `@${config.instagram_username}` : "Nenhum perfil conectado"}</h2>
              <p className="mt-1 text-sm text-[var(--ms-muted)]">{config.instagram_user_id || "Conecte o Instagram para liberar configuracoes via API."}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary" href={connectPath}><RefreshCcw size={16} /> Atualizar permissoes</Link>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] px-3 text-sm font-semibold">
              <input checked={draft.channel_active} onChange={(event) => setDraft((current) => ({ ...current, channel_active: event.target.checked }))} type="checkbox" />
              Canal ativo
            </label>
          </div>
        </div>
      </section>
      <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Perfis conectados</p>
            <h2 className="mt-1 text-xl font-bold">Gerencie suas contas de Instagram</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary" href={connectPath}><ExternalLink size={16} /> Abrir neste navegador</Link>
            <button className="btn-secondary" onClick={copyInstagramConnectUrl} type="button"><Copy size={16} /> Copiar link</button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {accounts.length ? accounts.map((account) => {
            const diagnostic = diagnostics[account.id];
            return (
              <article className={account.id === activeAccountId ? "rounded-lg border border-[var(--ms-primary-soft)] bg-[var(--ms-surface-soft)] p-4 ring-2 ring-[var(--ms-primary-soft)]" : "rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4"} key={account.id}>
                <div className="flex items-center gap-3">
                  {account.instagram_profile_picture_url ? <img alt="Perfil do Instagram" className="size-11 rounded-full object-cover" src={account.instagram_profile_picture_url} /> : <div className="grid size-11 place-items-center rounded-full bg-[var(--ms-surface)]"><ShieldCheck size={18} /></div>}
                  <div className="min-w-0">
                    <p className="truncate font-bold">@{account.instagram_username}</p>
                    <p className="truncate text-xs text-[var(--ms-muted)]">{account.instagram_user_id}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link className={account.id === activeAccountId ? "status-pill status-pill-green" : "status-pill"} href={hrefWithAccount("/perfis", account.id)}>{account.id === activeAccountId ? "Configurando" : "Configurar"}</Link>
                  {account.is_default ? <span className="status-pill status-pill-green">Principal</span> : <span className="status-pill">Conectado</span>}
                  {diagnostic ? <span className={diagnostic.summary.status === "ok" ? "status-pill status-pill-green" : diagnostic.summary.status === "warn" ? "status-pill status-pill-amber" : "status-pill text-red-500"}>{diagnostic.summary.label}</span> : null}
                  {!account.is_default ? (
                    <button className="btn-secondary h-9" disabled={defaultBusyId === account.id} onClick={() => makeDefaultAccount(account.id)} type="button">
                      {defaultBusyId === account.id ? <Loader2 className="animate-spin" size={15} /> : <RefreshCcw size={15} />}
                      Tornar principal
                    </button>
                  ) : null}
                  <button className="btn-secondary h-9" disabled={diagnosticBusyId === account.id} onClick={() => runDiagnostics(account.id)} type="button">
                    {diagnosticBusyId === account.id ? <Loader2 className="animate-spin" size={15} /> : <Activity size={15} />}
                    Testar conexao
                  </button>
                </div>
                {diagnostic ? <DiagnosticPanel result={diagnostic} /> : null}
              </article>
            );
          }) : <div className="rounded-lg border border-dashed border-[var(--ms-border-strong)] bg-[var(--ms-surface-soft)] p-6 text-center text-sm text-[var(--ms-muted)]">Nenhum perfil conectado ainda.</div>}
        </div>
      </section>
      <section className="panel p-5 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_420px] lg:items-start">
          <div>
            <p className="eyebrow">Copiar configuracao</p>
            <h2 className="mt-1 text-xl font-bold">Usar outro perfil como modelo</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ms-muted)]">Copie menu principal, iniciadores, automacoes de sistema e, se quiser, duplique todos os fluxos para este Instagram ativo.</p>
          </div>
          <div className="grid gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4">
            <label className="field">
              <span>Copiar de</span>
              <select className="input" value={copySourceId} onChange={(event) => setCopySourceId(event.target.value)}>
                <option value="">Selecione um perfil</option>
                {copySourceAccounts.map((account) => <option key={account.id} value={account.id}>@{account.instagram_username}</option>)}
              </select>
            </label>
            <label className="check">
              <input checked={includeAutomations} onChange={(event) => setIncludeAutomations(event.target.checked)} type="checkbox" />
              Duplicar fluxos/automacoes tambem
            </label>
            <button className="btn-primary justify-center" disabled={!copySourceId || busy === "copy"} onClick={copyProfileSettings} type="button">
              {busy === "copy" ? <Loader2 className="animate-spin" size={16} /> : <Copy size={16} />}
              Copiar para @{config.instagram_username || "perfil ativo"}
            </button>
          </div>
        </div>
      </section>
<section className="grid gap-4">
        <SettingsSection icon={<MessageSquareText size={18} />} title="Resposta Padrao" description="Acionada quando uma pessoa digita algo no Direct e nenhum fluxo reconhece a palavra-chave.">
          <AutomationSelect value={draft.default_automation_id} automations={automations} onChange={(value) => setDraft((current) => ({ ...current, default_automation_id: value }))} />
          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary" href={hrefWithAccount("/automacoes/nova", activeAccountId)}><Plus size={16} /> Criar nova resposta</Link>
            {draft.default_automation_id ? <Link className="btn-secondary" href={hrefWithAccount(`/fluxos/${draft.default_automation_id}/editar`, activeAccountId)}>Editar fluxo</Link> : null}
          </div>
        </SettingsSection>

        <SettingsSection icon={<Menu size={18} />} title="Menu Principal" description="Menu sempre disponivel dentro da conversa do Instagram. Use postbacks para chamar fluxos por payload ou URLs externas.">
          <ActionBar>
            <ActionButton label="Buscar atual" icon={<Download size={16} />} tone="blue" loading={busy === "load_menu"} disabled={!connected} onClick={() => loadMessengerProfile("persistent_menu")} />
            <ActionButton label="Recarregar local" icon={<RotateCcw size={16} />} tone="orange" onClick={() => setDraft(settings)} />
            <ActionButton label="Exemplo" icon={<Sparkles size={16} />} tone="green" onClick={fillMenuExample} />
            <ActionButton label="Adicionar item" icon={<Plus size={16} />} tone="blue" onClick={() => setDraft((current) => ({ ...current, persistent_menu_items: [...current.persistent_menu_items, emptyMenuItem] }))} />
          </ActionBar>

          <div className="grid gap-3">
            {draft.persistent_menu_items.length ? draft.persistent_menu_items.map((item, index) => (
              <article className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4" key={index}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="status-pill">Item {index + 1}</span>
                  <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-sm font-bold text-red-600 transition hover:bg-red-500/15" type="button" onClick={() => setDraft((current) => ({ ...current, persistent_menu_items: current.persistent_menu_items.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={15} /> Excluir item</button>
                </div>
                <div className="mt-4 grid gap-4">
                  <label className="field"><span>Titulo do botao</span><input className="input" placeholder="Ex: Baixar APP" value={item.title} onChange={(event) => updateMenuItem(index, "title", event.target.value)} /></label>
                  <label className="field"><span>Tipo</span><select className="input" value={item.type} onChange={(event) => updateMenuItem(index, "type", event.target.value)}><option value="postback">Postback / payload</option><option value="web_url">URL externa</option></select></label>
                  {item.type === "web_url" ? (
                    <label className="field"><span>URL</span><input className="input" placeholder="https://..." value={item.url || ""} onChange={(event) => updateMenuItem(index, "url", event.target.value)} /></label>
                  ) : (
                    <label className="field"><span>Payload</span><input className="input" placeholder="Ex: 1 ou automation:id-do-fluxo" value={item.payload || ""} onChange={(event) => updateMenuItem(index, "payload", event.target.value)} /></label>
                  )}
                </div>
              </article>
            )) : (
              <div className="rounded-lg border border-dashed border-[var(--ms-border-strong)] bg-[var(--ms-surface-soft)] p-8 text-center text-sm text-[var(--ms-muted)]">Nenhum item no menu principal.</div>
            )}
          </div>

          <ActionBar>
            <ActionButton label="Salvar" icon={<Save size={16} />} tone="green" loading={busy === "save"} onClick={() => saveSettings()} />
            <ActionButton label="Sincronizar Meta" icon={<UploadCloud size={16} />} tone="blue" loading={busy === "sync_menu"} disabled={!connected} onClick={() => syncMessengerProfile("persistent_menu")} />
            <ActionButton label="Remover da Meta" icon={<XCircle size={16} />} tone="red" loading={busy === "delete_menu"} disabled={!connected} onClick={() => deleteMessengerProfile("persistent_menu")} />
          </ActionBar>
        </SettingsSection>

        <SettingsSection icon={<Sparkles size={18} />} title="Iniciadores de conversa" description="Perguntas sugeridas para iniciar conversa com o perfil. A Meta normalmente permite ate 4 itens.">
          <ActionBar>
            <ActionButton label="Buscar atuais" icon={<Download size={16} />} tone="blue" loading={busy === "load_ice"} disabled={!connected} onClick={() => loadMessengerProfile("ice_breakers")} />
            <ActionButton label="Adicionar" icon={<Plus size={16} />} tone="green" disabled={draft.ice_breakers.length >= 4} onClick={() => setDraft((current) => ({ ...current, ice_breakers: [...current.ice_breakers, emptyIceBreaker] }))} />
          </ActionBar>
          <div className="grid gap-3">
            {draft.ice_breakers.length ? draft.ice_breakers.map((item, index) => (
              <article className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-4" key={index}>
                <div className="flex flex-wrap items-center justify-between gap-3"><span className="status-pill">Iniciador {index + 1}</span><button className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-sm font-bold text-red-600" type="button" onClick={() => setDraft((current) => ({ ...current, ice_breakers: current.ice_breakers.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={15} /> Excluir</button></div>
                <div className="mt-4 grid gap-4"><label className="field"><span>Pergunta</span><input className="input" placeholder="Ex: Quero saber mais" value={item.question} onChange={(event) => updateIceBreaker(index, "question", event.target.value)} /></label><label className="field"><span>Payload</span><input className="input" placeholder="Ex: 1 ou automation:id-do-fluxo" value={item.payload} onChange={(event) => updateIceBreaker(index, "payload", event.target.value)} /></label></div>
              </article>
            )) : <div className="rounded-lg border border-dashed border-[var(--ms-border-strong)] bg-[var(--ms-surface-soft)] p-8 text-center text-sm text-[var(--ms-muted)]">Nenhum iniciador configurado.</div>}
          </div>
          <ActionBar>
            <ActionButton label="Salvar" icon={<Save size={16} />} tone="green" loading={busy === "save"} onClick={() => saveSettings()} />
            <ActionButton label="Sincronizar Meta" icon={<UploadCloud size={16} />} tone="blue" loading={busy === "sync_ice"} disabled={!connected} onClick={() => syncMessengerProfile("ice_breakers")} />
            <ActionButton label="Remover da Meta" icon={<XCircle size={16} />} tone="red" loading={busy === "delete_ice"} disabled={!connected} onClick={() => deleteMessengerProfile("ice_breakers")} />
          </ActionBar>
        </SettingsSection>

        <SettingsSection icon={<ToggleLeft size={18} />} title="Automacoes de sistema" description="Fluxos chamados por palavras reservadas ou eventos especiais do canal.">
          <div className="grid gap-4 md:grid-cols-3">
            <SystemAutomation label="Opt-in" value={draft.opt_in_automation_id} automations={automations} onChange={(value) => setDraft((current) => ({ ...current, opt_in_automation_id: value }))} />
            <SystemAutomation label="Opt-out" value={draft.opt_out_automation_id} automations={automations} onChange={(value) => setDraft((current) => ({ ...current, opt_out_automation_id: value }))} />
            <SystemAutomation label="Mencao ao story" value={draft.story_mention_automation_id} automations={automations} onChange={(value) => setDraft((current) => ({ ...current, story_mention_automation_id: value }))} />
          </div>
        </SettingsSection>

        <section className="panel p-5 sm:p-6">
          <p className="eyebrow">Disponibilidade</p>
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-4">
            <InfoRow label="Menu principal" value="GET, POST e DELETE" />
            <InfoRow label="Iniciadores" value="GET, POST e DELETE" />
            <InfoRow label="Boas-vindas seguidores" value="Indisponivel agora" />
            <InfoRow label="Publicacao conteudo" value="Feed, Reel e Story" />
          </div>
        </section>
      </section>

      <div className="md:sticky md:bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)]/95 p-3 shadow-lg backdrop-blur">
        {notice ? <p className={notice.tone === "success" ? "status-pill status-pill-green" : "status-pill text-red-500"}>{notice.tone === "success" ? <Check size={14} /> : null}{notice.text}</p> : <p className="text-sm text-[var(--ms-muted)]">Payloads postback tambem funcionam como gatilho. Ex: payload 1 dispara fluxo com palavra-chave 1.</p>}
        <button className="btn-primary" disabled={busy === "save"} type="button" onClick={() => saveSettings()}>{busy === "save" ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}{busy === "save" ? "Salvando..." : "Salvar perfil"}</button>
      </div>
    </div>
  );
}

function OnboardingStep({ number, text, title }: { number: string; text: string; title: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] p-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--ms-primary)] text-sm font-black text-white dark:text-[#101522]">{number}</span>
      <div className="min-w-0">
        <p className="text-sm font-bold">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--ms-muted)]">{text}</p>
      </div>
    </div>
  );
}
function DiagnosticPanel({ result }: { result: DiagnosticResult }) {
  return (
    <div className="mt-4 grid gap-2 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ms-muted)]">Diagnostico</p>
        <span className="text-xs text-[var(--ms-muted)]">{formatDiagnosticDate(result.checkedAt)}</span>
      </div>
      <div className="grid gap-2">
        {result.checks.map((check) => (
          <div className="flex gap-2 rounded-md border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-2" key={check.key}>
            <span className={diagnosticIconClass(check.status)}>{diagnosticIcon(check.status)}</span>
            <div className="min-w-0">
              <p className="text-sm font-bold">{check.label}</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--ms-muted)]">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function diagnosticIcon(status: DiagnosticCheck["status"]) {
  if (status === "ok") return <CheckCircle2 size={15} />;
  if (status === "warn") return <AlertCircle size={15} />;
  return <XCircle size={15} />;
}

function diagnosticIconClass(status: DiagnosticCheck["status"]) {
  if (status === "ok") return "mt-0.5 text-emerald-500";
  if (status === "warn") return "mt-0.5 text-amber-500";
  return "mt-0.5 text-red-500";
}

function formatDiagnosticDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
function SettingsSection({ children, description, icon, title }: { children: React.ReactNode; description: string; icon: React.ReactNode; title: string }) {
  return <section className="panel p-5 sm:p-6"><div className="grid gap-5"><div><div className="flex items-center gap-3"><span className="metric-icon metric-blue">{icon}</span><h2 className="text-lg font-bold">{title}</h2></div><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ms-muted)]">{description}</p></div><div className="grid content-start gap-4">{children}</div></div></section>;
}

function ActionBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function ActionButton({ disabled, icon, label, loading, onClick, tone }: { disabled?: boolean; icon: React.ReactNode; label: string; loading?: boolean; onClick: () => void; tone: "blue" | "green" | "orange" | "red" }) {
  const tones = {
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-700 hover:bg-blue-500/15 dark:text-blue-300",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300",
    orange: "border-orange-500/30 bg-orange-500/10 text-orange-700 hover:bg-orange-500/15 dark:text-orange-300",
    red: "border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300",
  };
  return <button className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`} disabled={disabled || loading} type="button" onClick={onClick}>{loading ? <Loader2 className="animate-spin" size={16} /> : icon}{label}</button>;
}

function AutomationSelect({ automations, onChange, value }: { automations: Automation[]; onChange: (value: string | null) => void; value: string | null }) {
  return <select className="input" value={value || ""} onChange={(event) => onChange(event.target.value || null)}><option value="">Selecionar existente</option>{automations.map((automation) => <option key={automation.id} value={automation.id}>{automation.name}</option>)}</select>;
}

function SystemAutomation({ automations, label, onChange, value }: { automations: Automation[]; label: string; onChange: (value: string | null) => void; value: string | null }) {
  return <label className="field"><span>{label}</span><AutomationSelect automations={automations} value={value} onChange={onChange} /></label>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3"><p className="text-xs font-semibold text-[var(--ms-muted)]">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}

function normalizeMenuItem(item: PersistentMenuItem): PersistentMenuItem {
  if (item.type === "web_url") return { type: "web_url", title: item.title, url: item.url || item.payload || "" };
  return { type: "postback", title: item.title, payload: item.payload || "" };
}

function parseRemotePersistentMenu(payload: { data?: Array<Record<string, unknown>> }): PersistentMenuItem[] {
  const profile = payload.data?.[0] ?? {};
  const menus = Array.isArray(profile.persistent_menu) ? profile.persistent_menu as Array<Record<string, unknown>> : [];
  const actions = Array.isArray(menus[0]?.call_to_actions) ? menus[0].call_to_actions as Array<Record<string, unknown>> : [];
  return actions.map((action): PersistentMenuItem => action.type === "web_url" ? { type: "web_url", title: String(action.title || ""), url: String(action.url || "") } : { type: "postback", title: String(action.title || ""), payload: String(action.payload || "") }).filter((item) => item.title);
}

function parseRemoteIceBreakers(payload: { data?: Array<Record<string, unknown>> }): IceBreakerItem[] {
  const profile = payload.data?.[0] ?? {};
  const groups = Array.isArray(profile.ice_breakers) ? profile.ice_breakers as Array<Record<string, unknown>> : [];
  const actions = Array.isArray(groups[0]?.call_to_actions) ? groups[0].call_to_actions as Array<Record<string, unknown>> : [];
  return actions.map((action) => ({ question: String(action.question || ""), payload: String(action.payload || "") })).filter((item) => item.question && item.payload);
}
