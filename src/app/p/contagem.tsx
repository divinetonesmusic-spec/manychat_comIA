"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Contagem até o prazo REAL gravado no banco (funil_sessoes.oferta_expira_em). Não reinicia: recarregar a página
 * mostra o mesmo prazo. Quando chega a zero, a página é recarregada e o servidor mostra o preço que vale depois do prazo.
 */
export function Contagem({ expiraEm }: { expiraEm: string }) {
  const router = useRouter();
  const fim = new Date(expiraEm).getTime();
  const [agora, setAgora] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setAgora(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const restante = agora === null ? null : Math.max(0, Math.floor((fim - agora) / 1000));
  useEffect(() => {
    if (restante === 0) router.refresh();
  }, [restante, router]);

  if (restante === null) return null;
  const h = Math.floor(restante / 3600);
  const m = Math.floor((restante % 3600) / 60);
  const s = restante % 60;
  const texto = `${h > 0 ? `${h}h ` : ""}${String(m).padStart(2, "0")}min ${String(s).padStart(2, "0")}s`;
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="timer" aria-live="off">
      O desconto vale por mais {texto} (prazo fixo: termina às {new Date(fim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}).
    </p>
  );
}
