/**
 * Redes para onde um post vai. O Instagram é sempre a principal (sai como sempre); as outras vão depois, cada uma com
 * o seu resultado (public.content_post_redes, migração 0010). Uma rede que falha não segura nem desfaz as outras.
 */
export const REDES = ["instagram", "facebook", "threads", "youtube"] as const;
export type Rede = (typeof REDES)[number];
/** As redes além do Instagram (cada uma com uma linha em content_post_redes). */
export type RedeExtra = Exclude<Rede, "instagram">;
export const REDES_EXTRAS: RedeExtra[] = ["facebook", "threads", "youtube"];

export const REDE_NOME: Record<Rede, string> = {
  instagram: "Instagram",
  facebook: "Facebook (Página)",
  threads: "Threads",
  youtube: "YouTube Shorts",
};

export const YOUTUBE_PRIVACIDADES = ["public", "unlisted", "private"] as const;
export type YoutubePrivacidade = (typeof YOUTUBE_PRIVACIDADES)[number];

export type RedeStatus = "pending" | "processing" | "published" | "failed";

/** Resultado de uma rede extra, como as telas e o Molde veem (sem nada interno). */
export type RedeResultado = {
  rede: RedeExtra;
  status: RedeStatus;
  externalId: string | null;
  permalink: string | null;
  erro: string | null;
  publishedAt: string | null;
  tentativas: number;
};

export function isRede(value: unknown): value is Rede {
  return typeof value === "string" && (REDES as readonly string[]).includes(value);
}

export function isRedeExtra(value: unknown): value is RedeExtra {
  return typeof value === "string" && (REDES_EXTRAS as string[]).includes(value);
}

export const REDES_INVALIDAS = "redes inválidas: mande uma lista com instagram, facebook, threads e/ou youtube.";
export const REDES_SO_REEL = "Facebook, Threads e YouTube só valem para Reel (vídeo).";

/**
 * Lê o campo `redes`: undefined = ausente (não mexe); lista válida = as redes, sem repetir e sempre com o Instagram
 * na frente (ele é a principal); qualquer outra coisa = "invalid".
 */
export function parseRedes(value: unknown): { redes: Rede[]; instagramIncluido: boolean } | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10) return "invalid";
  const list: Rede[] = [];
  for (const item of value) {
    const name = typeof item === "string" ? item.trim().toLowerCase() : item;
    if (!isRede(name)) return "invalid";
    if (!list.includes(name)) list.push(name);
  }
  const instagramIncluido = !list.includes("instagram");
  return { redes: ["instagram", ...list.filter((rede) => rede !== "instagram")], instagramIncluido };
}

/** Só as redes extras de uma lista (na ordem fixa: facebook, threads, youtube). */
export function redesExtras(redes: readonly string[] | null | undefined): RedeExtra[] {
  const set = new Set(redes ?? []);
  return REDES_EXTRAS.filter((rede) => set.has(rede));
}

export function isYoutubePrivacidade(value: unknown): value is YoutubePrivacidade {
  return typeof value === "string" && (YOUTUBE_PRIVACIDADES as readonly string[]).includes(value);
}
