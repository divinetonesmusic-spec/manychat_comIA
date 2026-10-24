import { after } from "next/server";
import { findLinkBySlug, isMissingTables, recordClick, type ClickOrigin } from "@/lib/db/tracked-links";

/** Quanto o clique pode atrasar o redirecionamento, no máximo. */
export const CLICK_WAIT_MS = 300;

/**
 * Links já vistos por este processo (código → link). Só serve de reserva quando o banco falha na hora de buscar o código:
 * o link que já foi impresso na bio continua levando à loja. A busca normal sempre vai ao banco; nunca se adivinha um destino.
 */
const CACHE_MAX = 5000;
type Link = { id: string; destino: string; origem?: string | null };
const seen = new Map<string, Link>();

function remember(slug: string, link: Link) {
  seen.delete(slug);
  seen.set(slug, link);
  if (seen.size > CACHE_MAX) seen.delete(seen.keys().next().value as string); // sai o mais antigo
}

export type LinkLookup =
  | { kind: "found"; link: Link; fromCache: boolean }
  | { kind: "not-found" } // não existe (ou a 0006 ainda não foi colada)
  | { kind: "unavailable" }; // o banco falhou e este código nunca foi visto: não dá para saber o destino

export async function resolveLink(slug: string): Promise<LinkLookup> {
  try {
    const link = await findLinkBySlug(slug);
    if (!link) return { kind: "not-found" };
    remember(slug, link);
    return { kind: "found", link, fromCache: false };
  } catch (error) {
    if (isMissingTables(error)) return { kind: "not-found" }; // sem a 0006: como se o link não existisse
    console.error("[links] não consegui ler o link:", error instanceof Error ? error.message : error);
    const known = seen.get(slug);
    return known ? { kind: "found", link: known, fromCache: true } : { kind: "unavailable" };
  }
}

/**
 * Grava o clique esperando no máximo CLICK_WAIT_MS. Se o tempo vencer, a gravação continua DEPOIS da resposta, entregue ao
 * `after` do Next (no Netlify a função não é congelada antes de terminar). Se o banco falhar, só vai para o log.
 * `schedule` só é trocado nos testes.
 */
export async function countClick(linkId: string, origin: ClickOrigin, schedule: (work: () => Promise<void>) => void = defaultSchedule) {
  const saving = recordClick(linkId, origin).catch((error) => {
    console.error("[links] não consegui gravar o clique:", error instanceof Error ? error.message : error);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    saving.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), CLICK_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (timedOut) schedule(() => saving);
}

function defaultSchedule(work: () => Promise<void>) {
  try {
    after(work);
  } catch {
    // Fora de uma requisição do Next (por exemplo, nos testes): a gravação segue em segundo plano do mesmo jeito.
  }
}

/**
 * Opcional do contrato v131: no parâmetro secundário da plataforma (sck, na Hotmart e na Kiwify), junta ao código da origem
 * de onde veio o clique (sck=mo1x2y3z → sck=mo1x2y3z-story), para a venda dizer se veio da bio, da DM, do comentário ou do
 * story. Só mexe quando o sck é exatamente o código da origem; o resto do endereço fica igual.
 */
export function destinoComClique(destino: string, origem: string | null | undefined, de: string) {
  if (!origem || de === "outro") return destino;
  try {
    const url = new URL(destino);
    if (url.searchParams.get("sck") !== origem) return destino;
    url.searchParams.set("sck", `${origem}-${de}`);
    return url.toString();
  } catch {
    return destino;
  }
}
