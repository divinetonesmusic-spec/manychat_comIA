import { getInstagramAccountById } from "@/lib/db/repositories";
import { facebookAccessToken, getFacebookConnection, hasFacebookConnectionsTable, MIGRATION_0009_MISSING } from "@/lib/db/facebook-connections";
import { searchIgAudio, type AudioType, type RawIgAudio } from "@/lib/facebook/client";
import { isUuid } from "@/lib/facebook/connect";

/** Frase quando a conta ainda não tem a conexão pelo Facebook (sem ela a Meta não deixa pôr música). */
export const MUSIC_NEEDS_FACEBOOK = "Para pôr música do Instagram, conecte esta conta também pelo Facebook em Perfis.";
/** Frase quando a conexão pelo Facebook venceu (token da pessoa vencido e sem token da Página). */
export const MUSIC_FACEBOOK_EXPIRED = "A conexão pelo Facebook desta conta venceu. Conecte de novo pelo Facebook em Perfis.";

/** Uma música da biblioteca do Instagram, como o UaiFlow devolve à tela e ao Molde. */
export type AudioResult = {
  id: string;
  titulo: string;
  artista: string | null;
  /** Duração em milissegundos (null quando a Meta não manda). */
  duracaoMs: number | null;
  /** Duração em "m:ss" (vazio quando a Meta não manda). */
  duracao: string;
  /** "music" ou "original_sound". */
  tipo: AudioType;
  capaUrl: string | null;
  /** Prévia temporária (vence em ~1,5 dia). Pode faltar. */
  previaUrl: string | null;
  /** Link de prévia no Instagram. Pode faltar. */
  linkPrevia: string | null;
  /** Só em "original_sound": o @ de quem gravou. */
  usuario: string | null;
};

export class AudioSearchError extends Error {
  constructor(message: string, public status: number, public codigo: string) {
    super(message);
  }
}

/** Busca músicas (ou sons originais) da biblioteca do Instagram para a conta. Sem `q`: as em alta. */
export async function searchAudioForAccount(input: { accountId: string | null | undefined; q?: string | null; tipo?: string | null }) {
  const tipo: AudioType = input.tipo === "original_sound" ? "original_sound" : "music";
  if (input.tipo && input.tipo !== "music" && input.tipo !== "original_sound") {
    throw new AudioSearchError("tipo inválido: use music ou original_sound.", 400, "tipo_invalido");
  }
  const q = (input.q ?? "").trim().slice(0, 100);
  if (!input.accountId) throw new AudioSearchError("Falta a conta (conta=<id da conta do Instagram>).", 400, "sem_conta");
  if (!(await hasFacebookConnectionsTable())) throw new AudioSearchError(MIGRATION_0009_MISSING, 503, "falta_0009");
  const account = isUuid(input.accountId) ? await getInstagramAccountById(input.accountId) : null;
  if (!account) throw new AudioSearchError("Conta do Instagram não encontrada.", 404, "conta_nao_encontrada");
  const connection = await getFacebookConnection(account.id);
  if (!connection) throw new AudioSearchError(MUSIC_NEEDS_FACEBOOK, 409, "sem_facebook");
  const accessToken = facebookAccessToken(connection);
  if (!accessToken) throw new AudioSearchError(MUSIC_FACEBOOK_EXPIRED, 409, "facebook_vencido");

  const result = await searchIgAudio({ instagramUserId: connection.instagram_user_id, accessToken, audioType: tipo, searchQuery: q || null });
  const musicas = (result.audio ?? []).map((item) => toAudioResult(item, tipo)).filter((item): item is AudioResult => Boolean(item));
  return { conta: account.id, username: account.instagram_username, q, tipo, emAlta: !q, musicas };
}

export function toAudioResult(item: RawIgAudio, fallbackType: AudioType): AudioResult | null {
  const id = item.audio_id === undefined || item.audio_id === null ? "" : String(item.audio_id);
  if (!id) return null;
  const duracaoMs = typeof item.duration_in_ms === "number" && Number.isFinite(item.duration_in_ms) ? item.duration_in_ms : null;
  return {
    id,
    titulo: (item.title ?? "").trim() || "Sem título",
    artista: item.display_artist?.trim() || null,
    duracaoMs,
    duracao: formatDuration(duracaoMs),
    tipo: item.audio_type === "original_sound" ? "original_sound" : item.audio_type === "music" ? "music" : fallbackType,
    capaUrl: item.cover_artwork_thumbnail_uri || item.cover_artwork_thumbnail_url || null,
    previaUrl: item.download_url || null,
    linkPrevia: item.on_platform_audio_preview_link || null,
    usuario: item.ig_username || null,
  };
}

export function formatDuration(ms: number | null) {
  if (ms === null || ms < 0) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Erro da Meta na busca, sem nenhum pedaço de token. */
export function safeAudioError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Erro desconhecido.");
  return message.replace(/access_token=[^&\s]+/gi, "access_token=***").replace(/^Instagram Graph v\d+\.\d+:\s*/i, "Meta: ").slice(0, 300);
}
