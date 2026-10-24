/** Pequenas regras das páginas públicas do funil do Molde (0013). */

/** O cookie que libera o download da entrega depois do e-mail (o código da pessoa na Lista própria), só para /e/<slug>. */
export function cookieEntrega(slug: string) {
  return `uf_e_${slug.replace(/-/g, "_")}`;
}
export const COOKIE_ENTREGA_DIAS = 30;
/** Quanto vale o link do PDF (o navegador baixa na hora) e o da versão interativa (fica aberta lendo). */
export const LINK_PDF_SEG = 10 * 60;
export const LINK_HTML_SEG = 6 * 60 * 60;
