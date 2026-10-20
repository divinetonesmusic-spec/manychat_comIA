/**
 * Destino do post (0011): para onde o post leva quem viu. Serve para planejar o calendário (quanto vai para venda,
 * quanto é só valor) e para o Molde saber o link de cada post. Não muda a publicação.
 */
export const DESTINOS = ["quiz", "pagina_venda", "isca_email", "palavra_chave_dm", "so_valor"] as const;
export type DestinoTipo = (typeof DESTINOS)[number];

export const DESTINO_NOME: Record<DestinoTipo, string> = {
  quiz: "Quiz",
  pagina_venda: "Página de venda",
  isca_email: "Isca de e-mail",
  palavra_chave_dm: "Palavra-chave na DM",
  so_valor: "Só valor (sem link)",
};

/** Destinos que pedem um link (os outros: palavra-chave usa o funil da DM; só valor não leva link). */
export const DESTINO_PEDE_LINK: Record<DestinoTipo, boolean> = {
  quiz: true,
  pagina_venda: true,
  isca_email: true,
  palavra_chave_dm: false,
  so_valor: false,
};

export const DESTINO_INVALIDO = `destino inválido: use ${DESTINOS.join(", ")} (ou null para tirar).`;
export const DESTINO_LINK_INVALIDO = "O link do destino precisa começar com https://";
export const DESTINO_SEM_LINK = "Este destino pede um link (quiz, página de venda ou isca de e-mail).";

export function isDestino(value: unknown): value is DestinoTipo {
  return typeof value === "string" && (DESTINOS as readonly string[]).includes(value);
}

/**
 * Lê `destinoTipo` + `destinoLink` (ou `destino: { tipo, link }`). undefined = não mexe; null = tira.
 * "so_valor" grava sem link.
 */
export function parseDestino(body: Record<string, unknown>): { tipo: DestinoTipo | null; link: string | null } | undefined | { erro: string } {
  const objeto = body.destino && typeof body.destino === "object" && !Array.isArray(body.destino) ? (body.destino as Record<string, unknown>) : null;
  const tipoRaw = objeto ? objeto.tipo : body.destino === null ? null : body.destinoTipo;
  const linkRaw = objeto ? objeto.link : body.destinoLink;
  if (tipoRaw === undefined && linkRaw === undefined) return undefined;
  if (tipoRaw === null || tipoRaw === "") return { tipo: null, link: null };
  if (!isDestino(tipoRaw)) return { erro: DESTINO_INVALIDO };
  const link = typeof linkRaw === "string" ? linkRaw.trim().slice(0, 1000) : "";
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) return { erro: DESTINO_LINK_INVALIDO };
  if (DESTINO_PEDE_LINK[tipoRaw] && !link) return { erro: DESTINO_SEM_LINK };
  return { tipo: tipoRaw, link: tipoRaw === "so_valor" ? null : link || null };
}
