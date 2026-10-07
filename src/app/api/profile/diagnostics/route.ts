import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/db/repositories";
import {
  getInstagramMessengerProfile,
  getInstagramProfile,
  getInstagramSubscribedApps,
  listInstagramMedia,
} from "@/lib/instagram/client";

export const runtime = "nodejs";

type CheckStatus = "ok" | "warn" | "error";

type DiagnosticCheck = {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  const config = await getConfig(accountId);

  if (!config.instagram_user_id || !config.instagram_access_token) {
    return NextResponse.json({ error: "Instagram não conectado." }, { status: 400 });
  }

  const checks: DiagnosticCheck[] = [];

  checks.push(checkTokenDate(config.token_expires_at));

  const [profile, media, subscriptions, persistentMenu, iceBreakers] = await Promise.all([
    runCheck("profile", "Conexão e perfil", async () => {
      const result = await getInstagramProfile(config.instagram_access_token as string);
      return `Conectado como @${result.username}.`;
    }),
    runCheck("media", "Posts e Reels", async () => {
      const result = await listInstagramMedia(config.instagram_user_id as string, config.instagram_access_token as string);
      const count = result.data?.length ?? 0;
      return count ? `${count} ${count === 1 ? "post ou Reel encontrado" : "posts e Reels encontrados"}.` : "Conexão ok, mas o Instagram ainda não mostrou posts nem Reels.";
    }),
    runCheck("webhook", "Aviso de novas mensagens", async () => {
      const result = await getInstagramSubscribedApps(config.instagram_user_id as string, config.instagram_access_token as string);
      const count = result.data?.length ?? 0;
      if (count > 0) return `Ligado na Meta. ${config.webhook_subscribed_at ? `Salvo aqui desde ${formatDate(config.webhook_subscribed_at)}.` : "Sem data salva aqui."}`;
      return config.webhook_subscribed_at ? "Aqui consta como ligado, mas a Meta não retornou o aviso de novas mensagens." : "Nenhum aviso de novas mensagens ligado, segundo a Meta.";
    }),
    runCheck("persistent_menu", "Menu principal", async () => {
      const result = await getInstagramMessengerProfile({
        instagramUserId: config.instagram_user_id as string,
        accessToken: config.instagram_access_token as string,
        fields: "persistent_menu",
      });
      const hasMenu = Boolean(result.data?.[0]?.persistent_menu);
      return hasMenu ? "Menu publicado encontrado na Meta." : "A Meta respondeu, mas não há menu publicado.";
    }),
    runCheck("ice_breakers", "Iniciadores", async () => {
      const result = await getInstagramMessengerProfile({
        instagramUserId: config.instagram_user_id as string,
        accessToken: config.instagram_access_token as string,
        fields: "ice_breakers",
      });
      const hasIceBreakers = Boolean(result.data?.[0]?.ice_breakers);
      return hasIceBreakers ? "Iniciadores publicados encontrados na Meta." : "A Meta respondeu, mas não há iniciadores publicados.";
    }),
  ]);

  checks.push(profile, media, subscriptions, persistentMenu, iceBreakers);

  return NextResponse.json({
    data: {
      accountId: config.account_id,
      username: config.instagram_username,
      checkedAt: new Date().toISOString(),
      checks,
      summary: summarize(checks),
    },
  });
}

function checkTokenDate(value: string | null): DiagnosticCheck {
  if (!value) {
    return { key: "token_expiry", label: "Validade da conexão", status: "warn", detail: "Sem data de vencimento salva." };
  }

  const expiresAt = new Date(value).getTime();
  const days = Math.ceil((expiresAt - Date.now()) / 86_400_000);

  if (days <= 0) {
    return { key: "token_expiry", label: "Validade da conexão", status: "error", detail: "A conexão venceu. Reconecte o perfil." };
  }

  if (days <= 7) {
    return { key: "token_expiry", label: "Validade da conexão", status: "warn", detail: `Vence em ${days} dia(s). Toque em Atualizar permissões em breve.` };
  }

  return { key: "token_expiry", label: "Validade da conexão", status: "ok", detail: `Vence em ${days} dia(s).` };
}

async function runCheck(key: string, label: string, action: () => Promise<string>): Promise<DiagnosticCheck> {
  try {
    const detail = await action();
    const status: CheckStatus = detail.includes("não há") || detail.includes("não retornou") || detail.includes("Sem data") ? "warn" : "ok";
    return { key, label, status, detail };
  } catch (error) {
    return { key, label, status: "error", detail: translateMetaError(error) };
  }
}

function summarize(checks: DiagnosticCheck[]) {
  const errors = checks.filter((check) => check.status === "error").length;
  const warnings = checks.filter((check) => check.status === "warn").length;

  if (errors) return { status: "error" as const, label: `${errors} erro(s)` };
  if (warnings) return { status: "warn" as const, label: `${warnings} aviso(s)` };
  return { status: "ok" as const, label: "Tudo certo" };
}

function translateMetaError(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro desconhecido.";

  if (message.includes("Session has expired") || message.includes("Error validating access token")) {
    return "A conexão venceu ou não é válida. Reconecte o perfil.";
  }

  if (message.includes("Unsupported request") || message.includes("permission")) {
    return "A Meta recusou o pedido. Confira as permissões do perfil e se o app está em modo de teste.";
  }

  if (message.includes("User consent is required")) {
    return "A pessoa precisa aceitar antes. Ela deve iniciar a conversa ou tocar em um botão do menu ou dos iniciadores.";
  }

  return message.replace(/^Instagram Graph v\d+\.\d+:\s*/i, "Meta: ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
