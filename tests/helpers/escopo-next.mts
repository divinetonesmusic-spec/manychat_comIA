import { AsyncLocalStorage } from "node:async_hooks";

/**
 * O webhook usa `after()` do Next (esvaziar a fila depois de responder), que só funciona dentro de um pedido do servidor.
 * Fora do servidor este escopo de mentira basta: as tarefas do `after()` ficam guardadas em `depois` e NÃO rodam
 * (o teste chama o drain quando quer).
 *
 * Importe este arquivo ANTES de "next/server": o Next decide na hora de carregar se o AsyncLocalStorage existe.
 */
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;

export const depois: (() => unknown)[] = [];

export async function comAfter<T>(trabalho: () => Promise<T>): Promise<T> {
  const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external");
  const escopo = { afterContext: { after: (tarefa: () => unknown) => void depois.push(tarefa) } } as unknown as Parameters<typeof workAsyncStorage.run>[0];
  return workAsyncStorage.run(escopo, trabalho);
}
