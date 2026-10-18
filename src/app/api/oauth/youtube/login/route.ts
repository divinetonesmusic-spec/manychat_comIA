import { networkLogin, YOUTUBE_OAUTH } from "@/lib/redes/oauth-routes";

export const runtime = "nodejs";

/** Começa a conexão de UMA conta do Instagram com o YouTube. Só com a sessão do UaiFlow; state em cookie httpOnly. */
export const GET = networkLogin(YOUTUBE_OAUTH);
