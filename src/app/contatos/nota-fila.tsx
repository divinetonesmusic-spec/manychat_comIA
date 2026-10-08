/**
 * Nota do último envio do contato. Só vermelha quando o envio deu erro; a nota de uma mensagem que está
 * esperando (ex.: "Limite de 200 mensagens por hora deste perfil: sai às 14:05.") é só informação, em cor neutra.
 */
export function queueNoteClass(status: string | null | undefined) {
  return status === "failed" ? "text-red-500" : "text-[var(--ms-muted)]";
}

export function QueueNote({ status, text }: { status: string | null | undefined; text: string | null | undefined }) {
  if (!text) return null;
  return <p className={`mt-2 text-xs ${queueNoteClass(status)}`}>{text}</p>;
}
