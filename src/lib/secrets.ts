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
