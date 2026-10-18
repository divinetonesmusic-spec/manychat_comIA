import { networkCallback, THREADS_OAUTH } from "@/lib/redes/oauth-routes";

export const runtime = "nodejs";

/** Volta da conexão com o Threads: exige a sessão e o state igual ao do cookie (10 min); o cookie sai em qualquer resultado. */
export const GET = networkCallback(THREADS_OAUTH);
