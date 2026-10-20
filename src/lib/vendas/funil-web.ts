/** Pequenas regras das páginas públicas do funil (cookie da sessão e id da compra no link de retorno). */

/** Cookie com o id da sessão da oferta deste produto (30 dias, só para /p/<slug>). */
export function cookieSessao(slug: string) {
  return `uf_oferta_${slug.replace(/-/g, "_")}`;
}

export const COOKIE_SESSAO_DIAS = 30;

/**
 * Id da compra no link de retorno da plataforma. Configure o link de "depois do pagamento" com ele para que a mesma
 * compra sempre volte para a mesma sessão (e o mesmo prazo):
 * Stripe: ?compra={CHECKOUT_SESSION_ID}. Outras plataformas: o parâmetro que elas mandarem (compra, session_id,
 * order_id, sale_id, payment_id, transaction_id).
 */
const PARAMETROS_COMPRA = ["compra", "session_id", "checkout_session_id", "order_id", "sale_id", "payment_id", "transaction_id", "refId"];

export function compraRefDoLink(params: URLSearchParams) {
  for (const nome of PARAMETROS_COMPRA) {
    const valor = params.get(nome)?.trim();
    // {CHECKOUT_SESSION_ID} sem trocar (link aberto à mão) não conta
    if (valor && /^[A-Za-z0-9_.:-]{3,200}$/.test(valor)) return valor;
  }
  return null;
}
