import Link from "next/link";
import { BellRing, Camera, CheckCircle2, ExternalLink, KeyRound, Link2, RefreshCcw, ShieldCheck } from "lucide-react";
import { AppFrame, PageHeader, formatDate, getTokenStatus } from "../app-frame";
import { PendingLink } from "../pending-link";
import { NotifyTestButton } from "./notify-test-button";
import { getAppBaseUrl } from "@/lib/env";
import { getConfig } from "@/lib/db/repositories";
import { isTelegramConfigured } from "@/lib/notify";
import { getCurrentWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const workspaceContext = await getCurrentWorkspaceContext();
  const config = await getConfig();
  const appBaseUrl = getAppBaseUrl();
  const connected = Boolean(config.instagram_user_id);
  const metaAppConfigured = Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
  const telegramConfigured = isTelegramConfigured();
  const metaDeveloperUrl = process.env.INSTAGRAM_APP_ID
    ? `https://developers.facebook.com/apps/${process.env.INSTAGRAM_APP_ID}/dashboard/`
    : "https://developers.facebook.com/apps/";

  return (
    <AppFrame active="configuracoes" connected={connected} username={config.instagram_username} workspaceName={workspaceContext?.workspace.name} userEmail={workspaceContext?.profile.email} plan={workspaceContext?.workspace.plan}>
      <PageHeader
        eyebrow="Configurações"
        title="Conexão e segurança"
        description="Como está a conexão com o Instagram, os endereços que a Meta pede e dados úteis para publicar."
        action={
          <PendingLink className="btn-primary" href="/api/oauth/login" disabled={!metaAppConfigured} pendingLabel="Abrindo o Instagram...">
            <Camera size={16} />
            {connected ? "Reconectar Instagram" : "Conectar Instagram"}
          </PendingLink>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard icon={<Camera size={20} />} label="Conta" value={connected ? `@${config.instagram_username}` : "Não conectada"} />
        <StatusCard icon={<KeyRound size={20} />} label="Conexão com o Instagram" value={getTokenStatus(config.token_expires_at)} />
        <StatusCard icon={<ShieldCheck size={20} />} label="Aviso de novas mensagens" value={config.webhook_subscribed_at ? "Ligado" : "Aguardando"} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <div className="panel p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Meta</p>
              <h2 className="mt-2 text-xl font-semibold">URLs oficiais</h2>
            </div>
            <Link2 size={20} className="text-[var(--ms-primary)]" />
          </div>
          <div className="mt-4 grid gap-3">
            <CopyLine label="URI de redirecionamento OAuth" value={`${appBaseUrl}/api/oauth/callback`} />
            <CopyLine label="URL de callback do webhook" value={`${appBaseUrl}/api/webhook`} />
            <CopyLine label="URL da política de privacidade" value={`${appBaseUrl}/privacy-policy`} />
            <CopyLine label="URL de exclusão de dados" value={`${appBaseUrl}/data-deletion`} />
          </div>
        </div>

        <div className="grid content-start gap-6">
          <div className="panel p-5 sm:p-6">
            <p className="eyebrow">Instagram</p>
            <h2 className="mt-2 text-xl font-semibold">Detalhes da conexão</h2>
            <div className="mt-5 grid gap-3 text-sm">
              <InfoRow label="ID do usuário" value={config.instagram_user_id || "Não conectado"} />
              <InfoRow label="Nome" value={config.instagram_name || "Não informado"} />
              <InfoRow label="Vence em" value={formatDate(config.token_expires_at)} />
              <InfoRow label="Aviso de novas mensagens ligado em" value={formatDate(config.webhook_subscribed_at)} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <PendingLink className="btn-secondary" href="/api/token/refresh" pendingLabel="Renovando...">
                <RefreshCcw size={16} />
                Renovar a conexão
              </PendingLink>
              <Link className="btn-secondary" href={metaDeveloperUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                Abrir o painel da Meta (avançado)
              </Link>
            </div>
          </div>

          <div className="panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Telegram</p>
                <h2 className="mt-2 text-xl font-semibold">Avisos no celular</h2>
              </div>
              <BellRing size={20} className="text-[var(--ms-primary)]" />
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--ms-muted)]">
              O UaiFlow avisa no Telegram quando um post não sai e quando a conexão do Instagram está para vencer.
            </p>
            <p className={telegramConfigured ? "status-pill status-pill-green mt-3 w-fit" : "status-pill mt-3 w-fit"}>
              {telegramConfigured ? "Telegram configurado" : "Telegram ainda não configurado"}
            </p>
            <NotifyTestButton />
          </div>

          <div className="panel p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 text-emerald-500" size={22} />
              <div>
                <p className="font-semibold">Pronto para a próxima etapa visual</p>
                <p className="mt-2 text-sm leading-6 text-[var(--ms-muted)]">
                  A estrutura agora separa produto, automações, contatos, caixa de entrada e configurações. O próximo salto é o editor visual em blocos.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppFrame>
  );
}

function StatusCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
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

function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3">
      <p className="text-xs font-semibold text-[var(--ms-muted)]">{label}</p>
      <code className="mt-2 block break-all text-sm text-[var(--ms-foreground)]">{value}</code>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-3">
      <p className="text-xs font-semibold text-[var(--ms-muted)]">{label}</p>
      <p className="mt-1 break-words font-semibold">{value}</p>
    </div>
  );
}
