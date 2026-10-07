"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, ImageIcon, Loader2, Mic, Paperclip, PauseCircle, Play, Send, Smile } from "lucide-react";
import type { ContactSummary } from "@/lib/db/repositories";

type Props = {
  contact: ContactSummary;
  currentPath: string;
};

const MAX_MESSAGE_LENGTH = 1000;

export function ManualMessageComposer({ contact, currentPath }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedText = text.trim();
  const canSend = Boolean(trimmedText) && !sending;

  async function sendMessage() {
    if (!trimmedText || sending) return;

    setSending(true);
    setError(null);

    try {
      const response = await fetch(`/api/contacts/${contact.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmedText }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Não consegui enviar a mensagem.");
      }

      setText("");
      router.refresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Não consegui enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-[var(--ms-border)] bg-[var(--ms-surface)] p-4">
      <div className="rounded-lg border border-[var(--ms-border)] bg-[var(--ms-surface-soft)] p-2 focus-within:ring-2 focus-within:ring-[var(--ms-ring)]">
        <textarea
          className="min-h-12 max-h-32 w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none"
          disabled={sending}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void sendMessage();
            }
          }}
          placeholder="Digite uma resposta..."
          value={text}
        />
        {error ? (
          <p className="flex items-center gap-2 px-3 pb-2 text-xs font-semibold text-red-500">
            <AlertCircle size={14} />
            {error}
          </p>
        ) : null}
        <div className="grid gap-2 border-t border-[var(--ms-border)]/70 px-1 pt-2">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <button className="icon-button border-0 bg-transparent" disabled type="button" aria-label="Emoji" title="Emoji"><Smile size={18} /></button>
              <button className="icon-button border-0 bg-transparent" disabled type="button" aria-label="Anexar" title="Anexar"><Paperclip size={18} /></button>
              <button className="icon-button border-0 bg-transparent" disabled type="button" aria-label="Imagem" title="Imagem"><ImageIcon size={18} /></button>
              <button className="icon-button border-0 bg-transparent" disabled type="button" aria-label="Áudio" title="Áudio"><Mic size={18} /></button>
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-[var(--ms-muted)]">{text.length}/{MAX_MESSAGE_LENGTH}</span>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <form action={`/api/contacts/${contact.id}/pause`} className="min-w-0" method="post">
              <input name="next" type="hidden" value={currentPath} />
              <input name="reason" type="hidden" value="Atendimento humano" />
              <input name="paused" type="hidden" value={contact.human_paused_at ? "false" : "true"} />
              <button className="btn-secondary h-10 w-full min-w-0 justify-center px-3 text-sm" type="submit">
                {contact.human_paused_at ? <Play className="shrink-0" size={16} /> : <PauseCircle className="shrink-0" size={16} />}
                <span className="truncate">{contact.human_paused_at ? "Retomar automático" : "Pausar automático"}</span>
              </button>
            </form>
            <button className="btn-primary h-10 w-full min-w-0 justify-center px-3 text-sm" disabled={!canSend} onClick={() => void sendMessage()} type="button">
              {sending ? <Loader2 className="shrink-0 animate-spin" size={16} /> : <Send className="shrink-0" size={16} />}
              <span className="truncate">Enviar</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}