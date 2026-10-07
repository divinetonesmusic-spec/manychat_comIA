"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { translateAuthError } from "@/lib/auth-errors";

type Props = {
  mode: "login" | "signup";
  next?: string;
};

export function AuthForm({ mode, next = "/dashboard" }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState<"password" | "magic" | "google" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` : undefined;
  const isSignup = mode === "signup";

  async function submitWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading("password");
    setError(null);
    setMessage(null);

    if (isSignup && password !== confirmPassword) {
      setLoading(null);
      setError("As senhas não conferem.");
      return;
    }

    const result = isSignup
      ? await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: { full_name: name },
          },
        })
      : await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setLoading(null);
      setError(translateAuthError(result.error));
      return;
    }

    if (isSignup && !result.data.session) {
      setLoading(null);
      setMessage("Conta criada. Verifique seu e-mail para confirmar o acesso.");
      return;
    }

    setMessage("Pronto! Abrindo o seu painel...");
    router.push(next);
    router.refresh();
  }

  async function sendMagicLink() {
    if (!email) {
      setError("Informe seu e-mail para receber o link de entrada.");
      return;
    }

    setLoading("magic");
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
      },
    });

    setLoading(null);

    if (error) {
      setError(translateAuthError(error));
      return;
    }

    setMessage("Link enviado. Abra o seu e-mail e toque no link para entrar.");
  }

  async function signInWithGoogle() {
    setLoading("google");
    setError(null);
    setMessage("Abrindo o Google...");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setLoading(null);
      setError(translateAuthError(error));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{isSignup ? "Criar sua conta" : "Bem-vindo de volta"}</CardTitle>
          <CardDescription>
            {isSignup ? "Use o Google ou o seu e-mail para começar" : "Entre com o Google ou com o seu e-mail"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitWithPassword}>
            <FieldGroup>
              <Field>
                <Button className="w-full" variant="outline" type="button" onClick={signInWithGoogle} disabled={Boolean(loading)}>
                  {loading === "google" ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
                  {loading === "google" ? "Conectando ao Google..." : "Continuar com Google"}
                </Button>
                <Button className="w-full" variant="outline" type="button" onClick={sendMagicLink} disabled={Boolean(loading)}>
                  {loading === "magic" ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  {loading === "magic" ? "Enviando link..." : "Receber link de entrada por e-mail"}
                </Button>
              </Field>

              <FieldSeparator>ou continue com e-mail</FieldSeparator>

              {isSignup ? (
                <Field>
                  <FieldLabel htmlFor="name">Nome completo</FieldLabel>
                  <Input id="name" type="text" placeholder="Seu nome" value={name} onChange={(event) => setName(event.target.value)} />
                </Field>
              ) : null}

              <Field>
                <FieldLabel htmlFor="email">E-mail</FieldLabel>
                <Input id="email" type="email" placeholder="seu@email.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </Field>

              {isSignup ? (
                <Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="password">Senha</FieldLabel>
                      <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="confirm-password">Confirmar senha</FieldLabel>
                      <Input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
                    </Field>
                  </div>
                  <FieldDescription>Mínimo de 6 caracteres.</FieldDescription>
                </Field>
              ) : (
                <Field>
                  <div className="flex items-center">
                    <FieldLabel htmlFor="password">Senha</FieldLabel>
                    <Link className="ml-auto text-sm underline-offset-4 hover:underline" href="/recuperar-senha">
                      Esqueci minha senha
                    </Link>
                  </div>
                  <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                </Field>
              )}

              {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
              {message ? <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}

              <Field>
                <Button type="submit" disabled={Boolean(loading)}>
                  {loading === "password" ? <Loader2 className="animate-spin" /> : null}
                  {loading === "password" ? "Entrando..." : isSignup ? "Criar minha conta" : "Entrar na UaiFlow"}
                </Button>
                {isSignup ? (
                  <FieldDescription className="text-center">
                    Já tem uma conta? <Link href="/login">Entrar agora</Link>
                  </FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        Ao continuar, você concorda com nossos <Link href="/privacy-policy">termos</Link> e com a <Link href="/privacy-policy">política de privacidade</Link>.
      </FieldDescription>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
        fill="currentColor"
      />
    </svg>
  );
}
