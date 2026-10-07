/**
 * Nomes simples (em português) para valores internos que aparecem nas telas.
 * Os valores guardados no banco e enviados pelas rotas continuam os mesmos; só o texto mostrado muda.
 */

/** Onde a automação vale: "comments", "story" ou "dm". */
export function triggerLabel(trigger: string) {
  const labels: Record<string, string> = { comments: "Comentário", story: "Resposta a story", dm: "Mensagem no direct" };
  return labels[trigger] || trigger;
}

/** Como a palavra-chave é comparada: "contains", "exact" ou "any". */
export function matchLabel(matchType: string) {
  const labels: Record<string, string> = { contains: "contém a palavra", exact: "palavra exata", any: "qualquer mensagem" };
  return labels[matchType] || matchType;
}

/** Tipo de mídia que o Instagram devolve na lista de posts. */
export function mediaTypeLabel(type: string | null | undefined) {
  const labels: Record<string, string> = { VIDEO: "Vídeo ou Reel", IMAGE: "Foto", CAROUSEL_ALBUM: "Carrossel" };
  return (type && labels[type]) || "Mídia";
}
