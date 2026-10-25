import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getAdminCookieName, isAllowedEmail, isValidAdminSession } from "@/lib/auth";

const PUBLIC_EXACT_PATHS = [
  "/",
  "/login",
  "/recuperar-senha",
  "/privacidade",
  "/exclusao-de-dados",
  "/privacy-policy",
  "/data-deletion",
  "/manifest.webmanifest",
];

const PUBLIC_PREFIXES = [
  "/auth/callback",
  "/api/admin/login",
  "/api/admin/logout", // só apaga o cookie de administrador; precisa funcionar mesmo com a sessão já vencida
  "/api/oauth/login",
  "/api/oauth/callback",
  "/api/webhook",
  "/api/webhooks", // vendas (Stripe, Whop, Gumroad, Payhip, Cakto e as 10 da 0012: Hotmart, Kiwify...): cada rota confere a assinatura/segredo da plataforma
  "/api/queue/drain",
  "/api/token/refresh",
  "/api/health", // saúde do relógio para o monitor; não mostra segredo nem @ de conta
  "/api/molde", // protegido pelo MOLDE_API_TOKEN dentro das rotas
  "/api/telegram/webhook", // os toques nos botões do Telegram: protegido pelo TELEGRAM_WEBHOOK_SECRET e pela assinatura de cada botão
  "/p", // páginas públicas de venda (/p/<slug>: produto, oferta pós-compra, obrigado): quem compra não tem login
  "/depoimento", // formulário público do depoimento (/depoimento/<token> do e-mail)
  "/q", // quiz público do Molde (/q/<slug>, 0013): quem responde não tem login
  "/e", // página de entrega do material grátis (/e/<slug>, 0013); o download só depois do e-mail
  "/lista", // sair da Lista própria (/lista/sair/<código>, 0013)
  "/a", // o app por assinatura (/a/<slug>, 0018): quem assina entra pelo link ou código do e-mail (sessão própria do app), sem login do UaiFlow
  "/l", // links rastreados (/l/<código>): quem clica no Instagram não tem login; só redireciona e conta o clique
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // O cadastro foi desligado: quem abrir o endereço antigo vai para a entrada.
  if (pathname === "/cadastro" || pathname.startsWith("/cadastro/")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (await isValidAdminSession(request.cookies.get(getAdminCookieName())?.value)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user && isAllowedEmail(data.user.email)) {
      return response;
    }
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Sessão expirada. Entre novamente para continuar." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Ícones e imagens ficam de fora (a tela de login precisa deles), MENOS dentro de /api: antes, um endereço como
  // /api/automations/<id>.png pulava a conferência de sessão (v133).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|(?!api/).*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

function isPublicPath(pathname: string) {
  return PUBLIC_EXACT_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
