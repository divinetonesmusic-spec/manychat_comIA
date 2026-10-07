// Carregado no servidor do teste de HTML (NODE_OPTIONS=--require): só deixa o fetch falar com o próprio computador.
const realFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error(`Rede real bloqueada no teste de HTML: ${url.hostname}`);
  }
  return realFetch(input, init);
};
