/**
 * A origem do post no checkout (contrato v131 do Molde): um código curto «mo» + até 7 letras/números (rec131Codigo na página).
 * O link que conta cliques leva a pessoa ao checkout com esse código num parâmetro que a plataforma devolve no aviso de venda
 * (src/sck na Hotmart, custom na Digistore24, tid no ClickBank, utm_content nas outras...). Aqui se acha o código no aviso.
 */

/** Só o código: «mo» + 1 a 7 letras/números (minúsculos). */
export const ORIGEM_RE = /^mo[a-z0-9]{1,7}$/;

/**
 * O código dentro de um valor que voltou da plataforma. Aceita o código sozinho ou com o sufixo de onde veio o clique
 * (ex.: sck=mo1x2y3z-story, que o redirecionamento junta). Qualquer outra coisa → null ("molde-do-avatar" não é código).
 */
export function codigoOrigem(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().toLowerCase();
  const match = text.match(/^(mo[a-z0-9]{1,7})(?:[-_](?:bio|dm|comentario|story|outro))?$/);
  return match ? match[1] : null;
}

/** O primeiro código bom de uma lista de candidatos (na ordem do contrato de cada plataforma). Listas são abertas. */
export function acharOrigem(values: unknown[]): string | null {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = acharOrigem(value);
      if (found) return found;
      continue;
    }
    const code = codigoOrigem(value);
    if (code) return code;
  }
  return null;
}

/** Nomes de campo que carregam a origem em alguma plataforma (comparados sem maiúsculas, "-" e "_"). */
const CAMPOS_DE_ORIGEM = new Set(["src", "sck", "xcod", "utmcontent", "content", "custom", "tid", "trackingcodes", "trackingcode", "moldeorigem", "clientreferenceid", "trk", "tracker"]);

function campoNormalizado(key: string) {
  // "url_params[utm_content]" → "utmcontent"; "checkout[custom][molde_origem]" → "moldeorigem"
  const last = key.match(/\[([^\]]*)\]$/)?.[1] ?? key;
  return last.toLowerCase().replace(/[-_\s]/g, "");
}

/**
 * Reserva: procura o código em qualquer campo de rastreio do aviso (até 6 níveis), quando o caminho conhecido não trouxe.
 * Serve para as plataformas cujo formato ainda precisa ser conferido com um aviso real: o código «mo…» é bem específico,
 * então achar ele num campo de rastreio é seguro. Só olha campos com nome de rastreio (nunca e-mail, nome etc.).
 */
export function origemProfunda(body: unknown, depth = 0): string | null {
  if (!body || typeof body !== "object" || depth > 6) return null;
  if (Array.isArray(body)) {
    for (const item of body.slice(0, 50)) {
      const found = origemProfunda(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const entries = Object.entries(body as Record<string, unknown>).slice(0, 300);
  for (const [key, value] of entries) {
    if (!CAMPOS_DE_ORIGEM.has(campoNormalizado(key))) continue;
    const found = Array.isArray(value) ? acharOrigem(value) : codigoOrigem(value);
    if (found) return found;
  }
  for (const [, value] of entries) {
    if (value && typeof value === "object") {
      const found = origemProfunda(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}
