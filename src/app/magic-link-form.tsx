"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Loader2, Mail, Sparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { translateAuthError } from "@/lib/auth-errors";

export function MagicLinkForm({ next = "/dashboard" }: { next?: string }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
      },
    });

    setLoading(false);

    if (error) {
      setError(translateAuthError(error));
      return;
    }

    setMessage("Link enviado. Abra o seu e-mail e toque no link para entrar.");
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <label className="field" htmlFor="email">
        <span>Seu e-mail</span>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ms-muted)]" size={17} />
          <input className="input pl-10" id="email" name="email" placeholder="seu@email.com" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
      </label>

      {error ? <p className="rounded-lg bg-red-500/10 p-3 text-sm font-semibold text-red-600 dark:text-red-300">{error}</p> : null}
      {message ? <p className="rounded-lg bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">{message}</p> : null}

      <button className="btn-primary h-11 w-full" disabled={loading}>
        {loading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
        Enviar link de recuperação
      </button>
    </form>
  );
}
