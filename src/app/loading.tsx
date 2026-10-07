import { Loader2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export default function Loading() {
  return (
    <main className="grid min-h-svh place-items-center bg-[var(--ms-background)] px-6 text-[var(--ms-foreground)]">
      <section className="grid w-full max-w-md gap-6 text-center" aria-live="polite" aria-busy="true">
        <div className="mx-auto flex size-14 items-center justify-center overflow-hidden rounded-lg bg-[var(--ms-surface)] shadow-sm ring-1 ring-[var(--ms-border)]">
          <BrandMark className="size-14 object-cover" priority size={56} />
        </div>
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--ms-muted)]">UaiFlow</p>
          <h1 className="mt-2 text-2xl font-bold tracking-normal">Carregando sua área</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ms-muted)]">Buscando automações, conta conectada e seus dados.</p>
        </div>
        <div className="mx-auto inline-flex items-center gap-2 rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface)] px-4 py-3 text-sm font-semibold shadow-sm">
          <Loader2 className="size-4 animate-spin text-[var(--ms-primary)]" />
          Aguarde um instante
        </div>
        <div className="grid gap-3 text-left">
          <div className="h-20 animate-pulse rounded-lg bg-[var(--ms-surface-soft)]" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-16 animate-pulse rounded-lg bg-[var(--ms-surface-soft)]" />
            <div className="h-16 animate-pulse rounded-lg bg-[var(--ms-surface-soft)]" />
            <div className="h-16 animate-pulse rounded-lg bg-[var(--ms-surface-soft)]" />
          </div>
        </div>
      </section>
    </main>
  );
}
