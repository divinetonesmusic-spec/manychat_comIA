import { NextResponse } from "next/server";
import { getAdminCookieName } from "@/lib/auth";

export const runtime = "nodejs";

/** "Sair": apaga o cookie de administrador (ele é httpOnly; só o servidor consegue apagar). A sessão do Supabase sai no navegador. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(getAdminCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
