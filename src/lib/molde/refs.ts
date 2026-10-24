/**
 * Os `refs` de uma rota do Molde (?refs=a,b): a página manda cada ref com encodeURIComponent e junta com vírgula. Aqui o
 * texto cru da URL é cortado nas vírgulas ANTES de decodificar, para um ref com vírgula (%2C) não virar dois.
 * No máximo `max` refs (padrão 200), cada um com até 200 letras, sem repetir.
 */
export function refsDaUrl(url: URL, max = 200): string[] {
  const match = url.search.slice(1).split("&").find((part) => part.split("=")[0] === "refs");
  if (!match) return [];
  const raw = match.slice(match.indexOf("=") + 1);
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    let ref = piece;
    try {
      ref = decodeURIComponent(piece.replace(/\+/g, " "));
    } catch {
      // "%" solto: fica como veio
    }
    ref = ref.trim().slice(0, 200);
    if (ref && !out.includes(ref)) out.push(ref);
    if (out.length >= max) break;
  }
  return out;
}
