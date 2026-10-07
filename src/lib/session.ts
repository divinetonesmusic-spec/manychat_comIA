import type { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminSessionValue, getAdminCookieName, isAllowedEmail } from "@/lib/auth";

type CookieToSet = { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] };

/**
 * Confere a sessão do UaiFlow dentro de uma rota pública (a mesma regra do proxy: cookie de administrador
 * ou usuário do Supabase permitido). Se o Supabase renovar a sessão no caminho, os cookies novos voltam
 * em `applyCookies` para irem na resposta (senão a renovação se perderia).
 */
export async function readUaiFlowSession(request: NextRequest): Promise<{ ok: boolean; applyCookies: (response: NextResponse) => NextResponse }> {
  const cookies: CookieToSet[] = [];
  const applyCookies = (response: NextResponse) => {
    for (const cookie of cookies) response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  };

  const adminValue = await createAdminSessionValue();
  if (adminValue && request.cookies.get(getAdminCookieName())?.value === adminValue) return { ok: true, applyCookies };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return { ok: false, applyCookies };

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookies.push(...cookiesToSet);
        },
      },
    });
    const { data, error } = await supabase.auth.getUser();
    return { ok: Boolean(!error && data.user && isAllowedEmail(data.user.email)), applyCookies };
  } catch {
    return { ok: false, applyCookies };
  }
}
