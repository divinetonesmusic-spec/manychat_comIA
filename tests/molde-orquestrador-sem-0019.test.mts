import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/**
 * Supabase com a 0016 mas sem a 0019: a página e o Telegram da v134 continuam iguais; as rotas do orquestrador dizem
 * «Falta colar a atualização 0019» (503, codigo falta_0019) e o MCP também.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const MCP = { authorization: "Bearer token-falso-do-mcp-0123456789abcdef" };
const FRASE = "Falta colar a atualização 0019 no Supabase (veja docs/ATUALIZACAO_0019.md).";

describe("v135 · o orquestrador sem a migração 0019", { skip: semBanco }, () => {
  let db: TestDatabase;
  let filaRoute: typeof import("@/app/api/molde/fila/route");
  let itemRoute: typeof import("@/app/api/molde/fila/[id]/route");
  let acaoRoute: typeof import("@/app/api/molde/fila/[id]/[acao]/route");
  let mcpRoute: typeof import("@/app/api/mcp/route");

  before(async () => {
    db = await createTestDatabase({ ate: "0018" });
    filaRoute = await import("@/app/api/molde/fila/route");
    itemRoute = await import("@/app/api/molde/fila/[id]/route");
    acaoRoute = await import("@/app/api/molde/fila/[id]/[acao]/route");
    mcpRoute = await import("@/app/api/mcp/route");
  });

  beforeEach(() => {
    meta.reset();
    process.env.MOLDE_MCP_TOKEN = "token-falso-do-mcp-0123456789abcdef";
  });

  after(async () => {
    delete process.env.MOLDE_MCP_TOKEN;
    meta.restore();
    await db?.close();
  });

  test("o banco de teste está mesmo sem as colunas novas", async () => {
    assert.equal((await db.sql("select 1 from information_schema.columns where table_name = 'molde_fila' and column_name = 'versao'")).length, 0);
  });

  test("a página da v134 continua: espelho, lista, decidir e pendentes", async () => {
    const r = await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { itens: [{ ref: "pedido:p1", tipo: "fotos", estado: "para_aprovar", projeto: "birdie", previa: { texto: "3 fotos" } }] } }));
    assert.equal(r.status, 200);
    const id = (await r.json()).data[0].id;
    const lista = await (await filaRoute.GET(request("/api/molde/fila?estado=para_aprovar", { headers: MOLDE }))).json();
    assert.equal(lista.data[0].estado, "para_aprovar");
    assert.equal(lista.data[0].estadoOrquestrador, "esperando-dono");
    const d = await acaoRoute.POST(request(`/api/molde/fila/${id}/decidir`, { method: "POST", headers: MOLDE, json: { decisao: "aprovar" } }), routeParams({ id, acao: "decidir" }));
    assert.equal(d.status, 200);
    const pend = await (await filaRoute.GET(request("/api/molde/fila?decisoes=pendentes", { headers: MOLDE }))).json();
    assert.equal(pend.data.length, 1);
    const item = await (await itemRoute.GET(request(`/api/molde/fila/${id}`, { headers: MOLDE }), routeParams({ id }))).json();
    assert.equal(item.item.estado, "aprovado");
  });

  test("as rotas do orquestrador: 503 falta_0019", async () => {
    const criar = await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { projeto: "birdie", estacao: "molde-roteirista", tipo: "legenda" } }));
    assert.equal(criar.status, 503);
    assert.deepEqual((await criar.json()).erro, { codigo: "falta_0019", mensagem: FRASE });
    const lista = await filaRoute.GET(request("/api/molde/fila?estado=novo", { headers: MOLDE }));
    assert.equal(lista.status, 503);
    assert.equal((await lista.json()).erro.codigo, "falta_0019");
    const r = await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { itens: [{ ref: "pedido:p2", tipo: "fotos", estado: "na_fila" }] } }));
    const id = (await r.json()).data[0].id;
    const pegar = await acaoRoute.POST(request(`/api/molde/fila/${id}/pegar`, { method: "POST", headers: MOLDE, json: { versao: 1 } }), routeParams({ id, acao: "pegar" }));
    assert.equal(pegar.status, 503);
    assert.equal((await pegar.json()).erro.codigo, "falta_0019");
  });

  test("o MCP: ver_fila diz o que falta", async () => {
    const r = await mcpRoute.POST(request("/api/mcp", { method: "POST", headers: MCP, json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ver_fila", arguments: {} } } }));
    const corpo = await r.json();
    assert.equal(corpo.result.isError, true);
    assert.equal(corpo.result.content[0].text, FRASE);
  });
});
