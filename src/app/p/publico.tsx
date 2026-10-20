import type { ReactNode } from "react";
import { formatarPreco } from "@/lib/vendas/escada";

/** Moldura das páginas públicas de venda (/p/...) e do formulário de depoimento: uma tela, sem o menu do painel. */
export function PaginaPublica({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--ms-background)] px-4 py-8 text-[var(--ms-foreground)] sm:py-14">
      <div className="mx-auto grid w-full max-w-xl gap-5">{children}</div>
    </main>
  );
}

export function Cartao({ children }: { children: ReactNode }) {
  return <section className="panel grid gap-4 p-5 sm:p-7">{children}</section>;
}

export function Preco({ valor, moeda, riscado }: { valor: number; moeda: string; riscado?: number | null }) {
  return (
    <p className="flex flex-wrap items-baseline gap-3">
      <span className="text-3xl font-bold">{formatarPreco(valor, moeda)}</span>
      {riscado ? <span className="text-lg text-[var(--ms-muted)] line-through">{formatarPreco(riscado, moeda)}</span> : null}
    </p>
  );
}

export function Aviso({ tom = "info", children }: { tom?: "info" | "erro" | "ok"; children: ReactNode }) {
  const cor = tom === "erro" ? "border-red-300 bg-red-50 text-red-800" : tom === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-[var(--ms-border)] bg-[var(--ms-surface-soft)] text-[var(--ms-foreground)]";
  return <p className={`rounded-lg border px-4 py-3 text-sm ${cor}`}>{children}</p>;
}

export function Rodape() {
  return <p className="text-center text-xs text-[var(--ms-muted)]">Pagamento processado pela plataforma de pagamento. Dúvidas? Responda o e-mail da compra.</p>;
}

/** Data AAAA-MM-DD → "20 de outubro de 2026" (sem fuso: é a data prometida). */
export function dataPorExtenso(data: string | null) {
  if (!data) return "";
  const [ano, mes, dia] = data.split("-").map(Number);
  if (!ano || !mes || !dia) return data;
  return new Date(Date.UTC(ano, mes - 1, dia, 12)).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
