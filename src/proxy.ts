import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminSessionValue, getAdminCookieName, isAllowedEmail } from "@/lib/auth";

const PUBLIC_EXACT_PATHS = [
  "/",
  "/login",
  "/cadastro",
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
  "/api/oauth/login",
  "/api/oauth/callback",
  "/api/webhook",
  "/api/queue/drain",
  "/api/token/refresh",
  "/api/health", // saúde do relógio para o monitor; não mostra segredo nem @ de conta
  "/api/molde", // protegido pelo MOLDE_API_TOKEN dentro das rotas
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const adminSession = request.cookies.get(getAdminCookieName())?.value;
  const adminValue = await createAdminSessionValue();
  if (adminValue && adminSession === adminValue) {
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

function isPublicPath(pathname: string) {
  return PUBLIC_EXACT_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
