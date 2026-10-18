import { networkLogin, THREADS_OAUTH } from "@/lib/redes/oauth-routes";

export const runtime = "nodejs";

/** Começa a conexão de UMA conta do Instagram com o Threads. Só com a sessão do UaiFlow; state em cookie httpOnly. */
export const GET = networkLogin(THREADS_OAUTH);
