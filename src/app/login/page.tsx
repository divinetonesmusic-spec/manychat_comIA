import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "../auth-form";
import { BrandMark } from "@/components/brand-mark";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/auth-errors";
import { safeNextPath } from "@/lib/auth";

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

  if (data.user) {
    redirect(next);
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 text-foreground md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link className="flex items-center gap-2 self-center font-medium text-foreground" href="/">
          <div className="flex size-7 items-center justify-center overflow-hidden rounded-md bg-background shadow-sm ring-1 ring-border">
            <BrandMark className="size-7 object-cover" priority size={28} />
          </div>
          UaiFlow
        </Link>
        {params.error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{translateAuthError(params.error)}</p> : null}
        <AuthForm mode="login" next={next} />
      </div>
    </main>
  );
}
