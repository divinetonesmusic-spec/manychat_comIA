import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "../auth-form";
import { BrandMark } from "@/components/brand-mark";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/auth-errors";
import { isAllowedEmail, safeNextPath } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Entrar | UaiFlow",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  // Só volta para o painel quem pode entrar; quem não está em ALLOWED_EMAILS fica aqui com o aviso (sem isso,
  // o login mandava para o painel e o painel mandava de volta para o login, sem parar).
  if (data.user && isAllowedEmail(data.user.email)) {
    redirect(next);
  }
  const erro = params.error ?? (data.user ? "nao_autorizado" : undefined);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 text-foreground md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link className="flex items-center gap-2 self-center font-medium text-foreground" href="/">
          <div className="flex size-7 items-center justify-center overflow-hidden rounded-md bg-background shadow-sm ring-1 ring-border">
            <BrandMark className="size-7 object-cover" priority size={28} />
          </div>
          UaiFlow
        </Link>
        {erro ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{translateAuthError(erro)}</p> : null}
        <AuthForm next={next} />
        {/* Porta de emergência: a senha de administrador (ADMIN_PASSWORD) funciona mesmo sem e-mail na lista. */}
        <details className="rounded-lg border bg-background px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">Entrar com a senha de administrador</summary>
          <form action="/api/admin/login" method="post" className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="next" value={next} />
            <label className="sr-only" htmlFor="admin-password">Senha de administrador</label>
            <input id="admin-password" name="password" type="password" required autoComplete="current-password" className="h-9 rounded-md border bg-background px-3" placeholder="Senha de administrador" />
            <button type="submit" className="h-9 rounded-md bg-primary px-3 font-medium text-primary-foreground">Entrar</button>
          </form>
        </details>
      </div>
    </main>
  );
}
