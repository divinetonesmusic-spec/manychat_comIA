import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara um segredo recebido com o esperado sem deixar pista pelo tempo de resposta (timingSafeEqual).
 * Os dois passam antes por um hash, para terem sempre o mesmo tamanho. Vazio nunca confere.
 */
export function safeEqualSecret(provided: string | null | undefined, expected: string | null | undefined) {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Tira de um texto (erro, log, mensagem para a tela) qualquer pedaço que pareça token ou segredo: parâmetros
 * access_token/client_secret/fb_exchange_token/code de endereços, "Bearer ...", e tokens da Meta (IG..., EAA..., TH...),
 * do Google (ya29...) e do Telegram (bot<id>:<chave>). Usado antes de mandar erro para o navegador, o log ou o Telegram.
 */
export function redactSecrets(text: string, max = 300) {
  return String(text ?? "")
    .replace(/(access_token|fb_exchange_token|client_secret|refresh_token|code)=[^&\s"']+/gi, "$1=***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***")
    .replace(/\bIG[A-Za-z0-9_-]{20,}/g, "***")
    .replace(/\bEAA[A-Za-z0-9_-]{20,}/g, "***")
    .replace(/\bTH[A-Za-z0-9_-]{20,}/g, "***")
    .replace(/\bya29\.[A-Za-z0-9._-]{10,}/g, "***")
    .replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, "bot***")
    .slice(0, max);
}
