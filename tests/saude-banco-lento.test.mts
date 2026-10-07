import "./helpers/env.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

/**
 * Rodada 1: banco que aceita a conexão e nunca responde (o pior caso). As duas consultas do /api/health
 * rodam juntas, sob um prazo só de 4 s; antes eram duas em sequência, com até 5 s cada.
 * Não precisa de Postgres: um servidor TCP mudo faz o papel do banco travado.
 */
const sockets = new Set<net.Socket>();
const servidor = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
const porta = (servidor.address() as net.AddressInfo).port;
process.env.DATABASE_URL = `postgresql://ninguem@127.0.0.1:${porta}/banco_travado`;

describe("saúde com o banco travado", () => {
  after(() => {
    for (const socket of sockets) socket.destroy();
    servidor.close();
  });

  test("/api/health responde 503 em até ~4 s (prazo único para as duas consultas)", async () => {
    const { GET } = await import("@/app/api/health/route");
    const inicio = Date.now();
    const response = await GET();
    const duracao = Date.now() - inicio;
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.match(body.motivo, /banco de dados .*não respondeu/);
    assert.ok(duracao < 4500, `levou ${duracao} ms`);
    assert.ok(duracao >= 3500, `respondeu cedo demais (${duracao} ms): o prazo é de 4 s`);
  });
});
