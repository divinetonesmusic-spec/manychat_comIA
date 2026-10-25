/**
 * A contagem de visitas das páginas públicas (Umami Cloud, código aberto, hospedado por eles; Molde v134, F-SERV).
 * Liga só com UMAMI_WEBSITE_ID no ambiente (o id do site no Umami Cloud). UMAMI_SRC troca o endereço do script (padrão:
 * https://cloud.umami.is/script.js). Sem a variável (ou com um valor estranho), nada vai para a página. Só endereço https.
 */
export const UMAMI_SRC_PADRAO = "https://cloud.umami.is/script.js";

export function umamiConfig(env: Record<string, string | undefined> = process.env): { src: string; websiteId: string } | null {
  const websiteId = (env.UMAMI_WEBSITE_ID || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(websiteId)) return null;
  const src = (env.UMAMI_SRC || "").trim() || UMAMI_SRC_PADRAO;
  try {
    if (new URL(src).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { src, websiteId };
}
