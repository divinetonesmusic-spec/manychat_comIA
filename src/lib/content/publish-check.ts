/**
 * Conferência do feed: depois de um corte no meio da publicação, acha no Instagram o post que já saiu
 * (mesma legenda, publicado depois do pedido). Funções puras, sem banco nem rede.
 */
export type FeedMedia = {
  id: string;
  caption?: string | null;
  timestamp?: string | null;
  permalink?: string | null;
};

/** Folga para diferenças de relógio entre o servidor e a Meta. */
export const PUBLISH_MATCH_SLACK_MS = 10 * 60_000;

export function normalizeCaption(value: string | null | undefined) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

/** A Meta manda "2026-10-07T12:00:00+0000". */
export function parseMetaTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Entre as mídias recentes, a que saiu com a mesma legenda por causa deste pedido de publicação.
 * - Legenda vazia nunca casa (Stories não aparecem no feed e posts sem legenda são todos iguais).
 * - `excludeIds`: mídias que já pertencem a outro post do UaiFlow nunca são escolhidas.
 * - Prefere a primeira mídia do segundo do pedido em diante; a folga de 10 min antes do pedido (relógios
 *   diferentes) é só reserva, e nela fica a mais perto do pedido.
 */
export function findMatchingMedia(feed: FeedMedia[], input: { caption: string; since: Date; excludeIds?: Set<string> }): FeedMedia | null {
  const caption = normalizeCaption(input.caption);
  if (!caption) return null;
  const since = Math.floor(input.since.getTime() / 1000) * 1000; // a Meta corta os milissegundos
  const matches = feed
    .filter((media) => !input.excludeIds?.has(media.id) && normalizeCaption(media.caption) === caption)
    .map((media) => ({ media, at: parseMetaTimestamp(media.timestamp)?.getTime() ?? Number.NaN }))
    .filter((item) => !Number.isNaN(item.at) && item.at >= since - PUBLISH_MATCH_SLACK_MS);
  const after = matches.filter((item) => item.at >= since).sort((a, b) => a.at - b.at);
  if (after.length) return after[0].media;
  const before = matches.sort((a, b) => b.at - a.at);
  return before[0]?.media ?? null;
}
