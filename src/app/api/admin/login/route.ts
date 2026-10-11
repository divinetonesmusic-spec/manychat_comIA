import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionValue,
  getAdminCookieName,
  safeNextPath,
} from "@/lib/auth";
import { isValidAdminPassword } from "@/lib/admin-password";
import { clearFailedLogins, clientIp, registerLoginAttempt } from "@/lib/login-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = String(formData.get("password") || "");
  const next = safeNextPath(String(formData.get("next") || "/dashboard"));
  const sessionValue = await createAdminSessionValue();

  if (!sessionValue) {
    return NextResponse.redirect(new URL(`/login?error=config&next=${encodeURIComponent(next)}`, request.url));
  }

  // Conta a tentativa antes de conferir a senha (pedidos ao mesmo tempo não passam de 5). Passou de 5 em 15 minutos
  // sem acertar: nem confere a senha até o prazo passar. O IP vem do x-nf-client-connection-ip (Netlify) primeiro.
  const ip = clientIp(request);
  if (await registerLoginAttempt(ip)) {
    return NextResponse.redirect(new URL(`/login?error=bloqueado&next=${encodeURIComponent(next)}`, request.url));
  }

  if (!isValidAdminPassword(password)) {
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(next)}`, request.url));
  }

  await clearFailedLogins(ip);
  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.set(getAdminCookieName(), sessionValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
