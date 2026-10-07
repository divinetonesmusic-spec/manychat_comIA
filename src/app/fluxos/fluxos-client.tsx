"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Edit3, Loader2, Pause, Play, RefreshCw, Trash2, Workflow } from "lucide-react";
import { hrefWithAccount } from "@/lib/account-routing";
import type { Automation, FlowLog } from "@/lib/db/repositories";
import { matchLabel, triggerLabel } from "@/lib/rotulos";

type Props = {
  initialAutomations: Automation[];
  initialLogs: FlowLog[];
  activeAccountId?: string | null;
};

type Notice = { tone: "success" | "error"; text: string } | null;

const variableExamples = ["{{username}}", "{{first_name}}", "{{name}}", "{{profile_url}}", "{{automation_name}}"];

export function FluxosClient({ initialAutomations, initialLogs, activeAccountId = null }: Props) {
  const router = useRouter();
  const [automations, setAutomations] = useState(initialAutomations);
  const [logs] = useState(initialLogs);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const stats = useMemo(() => {
    const active = automations.filter((automation) => automation.active).length;
    const pending = logs.filter((log) => log.status === "pending" || log.status === "sending").length;
    const failed = logs.filter((log) => log.status === "failed").length;
    return { active, pending, failed };
  }, [automations, logs]);

  async function toggleAutomation(automation: Automation) {
    await patchAutomation(automation.id, { active: !automation.active }, (updated) =>
      setAutomations((current) => current.map((item) => (item.id === updated.id ? updated : item))),
    );
  }

  async function deleteFlow(automation: Automation) {
    if (!window.confirm(`Excluir o fluxo "${automation.name}"?`)) return;
    setBusyId(automation.id);
    setNotice(null);

    try {
      const response = await fetch(`/api/automations/${automation.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Não consegui excluir o fluxo.");
      setAutomations((current) => current.filter((item) => item.id !== automation.id));
      setNotice({ tone: "success", text: "Fluxo excluído." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Erro ao excluir fluxo." });
    } finally {
      setBusyId(null);
    }
  }

  async function duplicateFlow(automation: Automation) {
    setBusyId(automation.id);
    setNotice(null);

    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cloneAutomationPayload(automation)),
      });
      const result = (await response.json().catch(() => null)) as { data?: Automation; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error || "Não consegui duplicar o fluxo.");
      setAutomations((current) => [result.data!, ...current]);
      router.push(hrefWithAccount(`/fluxos/${result.data.id}/editar`, activeAccountId));
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Erro ao duplicar fluxo." });
    } finally {
      setBusyId(null);
    }
  }

  async function patchAutomation(id: string, payload: Record<string, unknown>, onSuccess: (automation: Automation) => void) {
    setBusyId(id);
    setNotice(null);

    try {
      const response = await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as { data?: Automation; error?: string } | null;
      if (!response.ok || !result?.data) throw new Error(result?.error || "Não consegui atualizar o fluxo.");
      onSuccess(result.data);
      setNotice({ tone: "success", text: "Fluxo atualizado." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Erro ao atualizar fluxo." });
    } finally {
      setBusyId(null);
    }
  }

  function refreshPage() {
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => setRefreshing(false), 900);
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Fluxos ativos" value={String(stats.active)} />
        <MetricCard label="Mensagens esperando para sair" value={String(stats.pending)} />
        <MetricCard label="Com erro" value={String(stats.failed)} tone={stats.failed ? "danger" : "normal"} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {variableExamples.map((variable) => (
            <code className="rounded-md border border-[var(--ms-border)] bg-[var(--ms-surface)] px-2 py-1 text-xs" key={variable}>{variable}</code>
          ))}
        </div>
        <button className="btn-secondary" onClick={refreshPage} type="button" disabled={refreshing}>
          {refreshing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
          Atualizar
        </button>
      </div>

      {notice ? (
        <p className={notice.tone === "success" ? "status-pill status-pill-green w-fit" : "status-pill w-fit text-red-500"} aria-live="polite">
          {notice.tone === "success" ? <Check size={14} /> : null}
          {notice.text}
        </p>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="grid content-start gap-4">
          {automations.length ? automations.map((automation) => (
            <article className="panel overflow-hidden" key={automation.id}>
              <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={automation.active ? "h-2.5 w-2.5 rounded-full bg-emerald-500" : "h-2.5 w-2.5 rounded-full bg-[var(--ms-border-strong)]"} />
                    <h2 className="truncate text-lg font-bold">{automation.name}</h2>
                    {automation.require_follower ? <span className="status-pill status-pill-green">Verifica seguidor</span> : null}
                  </div>
                  <p className="mt-2 text-sm text-[var(--ms-muted)]">
                    {automation.triggers.map(triggerLabel).join(", ")} | {matchLabel(automation.match_type)} | {automation.keywords.join(", ") || "sem palavras"}
                  </p>
                  <p className="mt-2 truncate text-sm text-[var(--ms-muted)]">{automation.link_url || "Sem link configurado"}</p>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Link className="btn-secondary h-10" href={hrefWithAccount(`/fluxos/${automation.id}/editar`, activeAccountId)}>
                    <Edit3 size={16} />
                    Editar
                  </Link>
                  <button className="btn-secondary h-10" disabled={busyId === automation.id} onClick={() => toggleAutomation(automation)} type="button">
                    {automation.active ? <Pause size={16} /> : <Play size={16} />}
                    {automation.active ? "Pausar" : "Ativar"}
                  </button>
                  <button className="btn-secondary h-10" disabled={busyId === automation.id} onClick={() => duplicateFlow(automation)} type="button">
                    {busyId === automation.id ? <Loader2 className="animate-spin" size={16} /> : <Copy size={16} />}
                    Duplicar e editar
                  </button>
                  <button className="btn-secondary h-10 text-red-500" disabled={busyId === automation.id} onClick={() => deleteFlow(automation)} type="button">
                    {busyId === automation.id ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                    Excluir
                  </button>
                </div>
              </div>
            </article>
          )) : (
            <div className="panel grid place-items-center p-10 text-center">
              <Workflow className="text-[var(--ms-muted)]" size={32} />
              <p className="mt-3 text-sm text-[var(--ms-muted)]">Nenhum fluxo criado ainda.</p>
            </div>
          )}
        </div>

        <section className="panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Histórico</p>
              <h2 className="mt-2 text-xl font-semibold">Últimos envios</h2>
            </div>
            <span className="status-pill">{logs.length}</span>
          </div>
          <div className="mt-5 grid gap-3">
            {logs.length ? logs.map((log) => (
              <article className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3" key={log.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{log.automation_name || "Fluxo removido"}</p>
                    <p className="mt-1 text-xs text-[var(--ms-muted)]">{log.instagram_username ? `@${log.instagram_username}` : log.instagram_user_id || "contato sem usuário"}</p>
                  </div>
                  <span className={log.status === "sent" ? "status-pill status-pill-green" : "status-pill"}>{translateStatus(log.status)}</span>
                </div>
                <p className="mt-2 text-xs text-[var(--ms-muted)]">{translateSendType(log.send_type)} | {formatDate(log.sent_at || log.created_at)}</p>
                {log.last_error ? <p className="mt-2 text-xs text-red-500">{log.last_error}</p> : null}
              </article>
            )) : <p className="text-sm text-[var(--ms-muted)]">Nenhum envio ainda.</p>}
          </div>
        </section>
      </section>
    </div>
  );
}

function cloneAutomationPayload(automation: Automation) {
  return {
    account_id: automation.account_id,
    name: `${automation.name} (cópia)`,
    active: false,
    triggers: automation.triggers,
    keywords: automation.keywords,
    match_type: automation.match_type,
    post_id: automation.post_id,
    public_replies: automation.public_replies,
    public_reply_mode: automation.public_reply_mode,
    welcome_dm: automation.welcome_dm,
    quick_reply_label: automation.quick_reply_label,
    quick_replies: automation.quick_replies,
    link_text: automation.link_text,
    link_button_label: automation.link_button_label,
    link_url: automation.link_url,
    reply_delay_seconds: automation.reply_delay_seconds,
    reply_delay_mode: automation.reply_delay_mode,
    reply_delay_min_seconds: automation.reply_delay_min_seconds,
    reply_delay_max_seconds: automation.reply_delay_max_seconds,
    reminder_text: automation.reminder_text,
    reminder_delay_minutes: automation.reminder_delay_minutes,
    reminder_delay_seconds: automation.reminder_delay_seconds,
    reminder_delay_mode: automation.reminder_delay_mode,
    reminder_delay_min_seconds: automation.reminder_delay_min_seconds,
    reminder_delay_max_seconds: automation.reminder_delay_max_seconds,
    require_follower: automation.require_follower,
    non_follower_dm: automation.non_follower_dm,
    non_follower_button_label: automation.non_follower_button_label,
    follower_confirmation_text: automation.follower_confirmation_text,
    follower_confirmation_greetings: automation.follower_confirmation_greetings,
    flow_nodes: automation.flow_nodes,
    flow_edges: automation.flow_edges,
  };
}

function MetricCard({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "danger" }) {
  return (
    <article className="panel p-5">
      <p className="text-sm font-medium text-[var(--ms-muted)]">{label}</p>
      <p className={tone === "danger" ? "mt-3 text-2xl font-bold text-red-500" : "mt-3 text-2xl font-bold"}>{value}</p>
    </article>
  );
}

function translateStatus(status: string) {
  const labels: Record<string, string> = {
    pending: "Esperando",
    sending: "Enviando",
    sent: "Enviado",
    failed: "Erro",
    skipped: "Ignorado",
  };
  return labels[status] || status;
}

function translateSendType(sendType: string) {
  const labels: Record<string, string> = {
    private_reply: "Resposta privada",
    public_reply: "Comentário público",
    dm: "Direct",
  };
  return labels[sendType] || sendType;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
