"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";

export function ContactPauseControls({ contactId, paused }: { contactId: string; paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function togglePause() {
    setBusy(true);
    try {
      const response = await fetch(`/api/contacts/${contactId}/pause`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paused ? { paused: false } : { paused: true, reason: "Atendimento humano" }),
      });

      if (!response.ok) throw new Error("Não consegui atualizar a pausa.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={paused ? "inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 text-sm font-bold text-emerald-700" : "inline-flex h-9 items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 text-sm font-bold text-orange-700"}
      disabled={busy}
      onClick={togglePause}
      type="button"
    >
      {busy ? <Loader2 className="animate-spin" size={15} /> : paused ? <Play size={15} /> : <Pause size={15} />}
      {paused ? "Voltar ao automático" : "Pausar automático"}
    </button>
  );
}