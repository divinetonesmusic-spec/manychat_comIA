import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { MagicLinkForm } from "../magic-link-form";

export const metadata = {
  title: "Recuperar Senha | UaiFlow",
};

export default function RecuperarSenhaPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ms-background)] px-4 py-10 text-[var(--ms-foreground)]">
      <section className="w-full max-w-md">
        <Link className="mx-auto mb-8 flex w-fit flex-col items-center gap-3" href="/">
          <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-[var(--ms-surface)] shadow-sm ring-1 ring-[var(--ms-border)]"><BrandMark className="size-12 object-cover" priority size={48} /></span>
          <span className="text-xl font-black">UaiFlow</span>
        </Link>

        <div className="panel p-6 sm:p-8">
          <p className="eyebrow">Recuperação</p>
          <h1 className="mt-2 text-3xl font-bold tracking-normal">Esqueceu a senha?</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--ms-muted)]">Informe seu e-mail para receber um link de entrada.</p>

          <div className="mt-6">
            <MagicLinkForm next="/dashboard" />
          </div>

          <Link className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--ms-primary)]" href="/login">
            <ArrowLeft size={16} />
            Voltar para o login
          </Link>
        </div>
      </section>
    </main>
  );
}
