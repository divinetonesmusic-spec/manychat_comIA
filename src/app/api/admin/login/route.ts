import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionValue,
  getAdminCookieName,
  isValidAdminPassword,
  safeNextPath,
} from "@/lib/auth";
import { clearFailedLogins, clientIp, isLoginBlocked, recordFailedLogin } from "@/lib/login-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = String(formData.get("password") || "");
  const next = safeNextPath(String(formData.get("next") || "/dashboard"));
  const sessionValue = createAdminSessionValue();

  if (!sessionValue) {
    return NextResponse.redirect(new URL(`/login?error=config&next=${encodeURIComponent(next)}`, request.url));
  }

  // 5 senhas erradas do mesmo endereço em 15 minutos: nem confere a senha até o prazo passar.
  const ip = clientIp(request);
  if (await isLoginBlocked(ip)) {
    return NextResponse.redirect(new URL(`/login?error=bloqueado&next=${encodeURIComponent(next)}`, request.url));
  }

  if (!isValidAdminPassword(password)) {
    await recordFailedLogin(ip);
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
