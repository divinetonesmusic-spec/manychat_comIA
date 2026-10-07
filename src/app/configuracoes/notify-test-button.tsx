"use client";

import { useState } from "react";
import { BellRing, Check, Loader2 } from "lucide-react";

type Notice = { tone: "success" | "error"; text: string } | null;

/** Botão "Enviar aviso de teste": manda uma mensagem pelo Telegram e mostra o resultado em português. */
export function NotifyTestButton() {
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function sendTest() {
    setSending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/notify/test", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;
      if (response.ok && body?.ok) setNotice({ tone: "success", text: body.message || "Aviso enviado! Confira o Telegram." });
      else setNotice({ tone: "error", text: body?.error || "Não consegui enviar o aviso. Tente de novo." });
    } catch {
      setNotice({ tone: "error", text: "Sem conexão com o UaiFlow. Confira a internet e tente de novo." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-5 grid gap-3">
      <div>
        <button className="btn-secondary" type="button" disabled={sending} onClick={sendTest}>
          {sending ? <Loader2 className="animate-spin" size={16} /> : <BellRing size={16} />}
          {sending ? "Enviando..." : "Enviar aviso de teste"}
        </button>
      </div>
      {notice ? (
        <p
          role="status"
          className={notice.tone === "success"
            ? "status-pill status-pill-green w-fit gap-1"
            : "rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-200"}
        >
          {notice.tone === "success" ? <Check size={14} /> : null}
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
