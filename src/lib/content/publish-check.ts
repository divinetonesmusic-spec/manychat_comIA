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

/** Entre as mídias recentes, a primeira que saiu com a mesma legenda depois do pedido de publicação. */
export function findMatchingMedia(feed: FeedMedia[], input: { caption: string; since: Date }): FeedMedia | null {
  const caption = normalizeCaption(input.caption);
  const since = input.since.getTime() - PUBLISH_MATCH_SLACK_MS;
  const matches = feed
    .filter((media) => normalizeCaption(media.caption) === caption)
    .map((media) => ({ media, at: parseMetaTimestamp(media.timestamp)?.getTime() ?? Number.NaN }))
    .filter((item) => !Number.isNaN(item.at) && item.at >= since)
    .sort((a, b) => a.at - b.at);
  return matches[0]?.media ?? null;
}
