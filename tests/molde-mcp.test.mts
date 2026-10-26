import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/**
 * v135 · F-MCP parte 2: o Molde como servidor MCP remoto (/api/mcp, JSON-RPC pelo Streamable HTTP simples).
 * initialize, tools/list, tools/call (ver_fila, ver_item, pedir → confirmar em 2 chamadas, decidir, status_do_mes),
 * o token (cabeçalho ou ?chave=), as notificações (202) e os erros JSON-RPC. Banco de teste com a 0019; Telegram falso.
 */
const meta = installFakeMeta();
const TOKEN = "token-falso-do-mcp-0123456789abcdef";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const ORQ = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };

type Resultado = { content: Array<{ type: string; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

describe("v135 · o MCP do Molde (/api/mcp)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let mcpRoute: typeof import("@/app/api/mcp/route");
  let filaRoute: typeof import("@/app/api/molde/fila/route");
  let acaoRoute: typeof import("@/app/api/molde/fila/[id]/[acao]/route");
  let proxy: typeof import("@/proxy");
  let n = 0;

  before(async () => {
    db = await createTestDatabase();
    mcpRoute = await import("@/app/api/mcp/route");
    filaRoute = await import("@/app/api/molde/fila/route");
    acaoRoute = await import("@/app/api/molde/fila/[id]/[acao]/route");
    proxy = await import("@/proxy");
  });

  beforeEach(async () => {
    meta.reset();
    process.env.MOLDE_MCP_TOKEN = TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "123:falso";
    process.env.TELEGRAM_CHAT_ID = "42";
    process.env.TELEGRAM_WEBHOOK_SECRET = "segredo-falso-do-webhook-do-telegram-0123";
    process.env.MOLDE_TETO_USD = "1";
    await db.sql("delete from public.molde_fila");
    await db.sql("delete from public.molde_avatares");
  });

  after(async () => {
    for (const k of ["MOLDE_MCP_TOKEN", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_WEBHOOK_SECRET", "MOLDE_TETO_USD"]) delete process.env[k];
    meta.restore();
    await db?.close();
  });

  const post = (json: unknown, headers: Record<string, string> = AUTH, caminho = "/api/mcp") =>
    mcpRoute.POST(request(caminho, { method: "POST", json, headers: { accept: "application/json, text/event-stream", ...headers } }));
  async function rpc(method: string, params?: Record<string, unknown>) {
    n += 1;
    const r = await post({ jsonrpc: "2.0", id: n, method, ...(params ? { params } : {}) });
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.id, n);
    return corpo as { result?: Record<string, unknown>; error?: { code: number; message: string } };
  }
  const chamar = async (name: string, args: Record<string, unknown> = {}) => (await rpc("tools/call", { name, arguments: args })).result as unknown as Resultado;
  const textoDe = (r: Resultado) => r.content.map((c) => c.text).join("\n");
  const avatares = (lista: Array<{ projeto: string; nome: string; conta: string }>) =>
    filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { avatares: lista, precos: { foto: 0.25, reel: 1.2 } } }));

  test("o token: sem ele 401; sem a variável 503; no cabeçalho ou no endereço (?chave=) entra; o /api/mcp passa pelo proxy sem login", async () => {
    assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, {})).status, 401);
    assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer errado" })).status, 401);
    assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, {}, `/api/mcp?chave=${TOKEN}`)).status, 200);
    process.env.MOLDE_MCP_TOKEN = "curto";
    assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status, 503);
    process.env.MOLDE_MCP_TOKEN = TOKEN;
    // o token do Molde (da página) não abre o MCP
    assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `Bearer ${process.env.MOLDE_API_TOKEN}` })).status, 401);
    const passou = await proxy.proxy(request("/api/mcp", { method: "POST", json: {} }));
    assert.equal(passou.headers.get("x-middleware-next"), "1");
    assert.equal((await mcpRoute.GET(request("/api/mcp", { headers: AUTH }))).status, 405);
  });

  test("initialize: a versão do protocolo, as capacidades e as instruções; notificação = 202 sem corpo; ping", async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "1" } });
    assert.equal(r.result?.protocolVersion, "2025-06-18");
    assert.deepEqual(r.result?.capabilities, { tools: { listChanged: false } });
    assert.equal((r.result?.serverInfo as { name: string }).name, "uaiflow-molde");
    assert.match(String(r.result?.instructions), /só chame «confirmar»/);
    const desconhecida = await rpc("initialize", { protocolVersion: "1999-01-01" });
    assert.equal(desconhecida.result?.protocolVersion, "2025-11-25");
    const notif = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(notif.status, 202);
    assert.equal(await notif.text(), "");
    assert.deepEqual((await rpc("ping")).result, {});
  });

  test("erros JSON-RPC: JSON quebrado (-32700), pedido inválido (-32600), método (-32601), ferramenta (-32602); lote", async () => {
    const quebrado = await mcpRoute.POST(new (await import("next/server")).NextRequest("https://uaiflow.teste/api/mcp", { method: "POST", body: "{nao é json", headers: { ...AUTH, "content-type": "application/json" } }));
    assert.equal(quebrado.status, 400);
    assert.equal((await quebrado.json()).error.code, -32700);
    assert.equal((await (await post({ id: 1, method: "ping" })).json()).error.code, -32600);
    assert.equal((await rpc("resources/list")).error?.code, -32601);
    assert.equal((await rpc("tools/call", { name: "apagar_tudo" })).error?.code, -32602);
    const lote = await (await post([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: "b", method: "tools/list" }])).json();
    assert.deepEqual(lote.map((x: { id: string }) => x.id), ["a", "b"]);
  });

  test("tools/list: as 6 ferramentas com descrição em português e esquema; as de ler são só leitura", async () => {
    const tools = (await rpc("tools/list")).result?.tools as Array<{ name: string; description: string; inputSchema: { type: string; required?: string[] }; annotations?: { readOnlyHint?: boolean } }>;
    assert.deepEqual(tools.map((t) => t.name), ["ver_fila", "ver_item", "pedir", "confirmar", "decidir", "status_do_mes"]);
    assert.ok(tools.every((t) => t.inputSchema.type === "object" && /[ãçéêóõí]|fila|pedido/.test(t.description)));
    assert.match(tools.find((t) => t.name === "pedir")!.description, /NÃO GASTA NADA/);
    assert.deepEqual(tools.find((t) => t.name === "confirmar")!.inputSchema.required, ["id"]);
    assert.equal(tools.find((t) => t.name === "ver_fila")!.annotations?.readOnlyHint, true);
    assert.equal(tools.find((t) => t.name === "pedir")!.annotations?.readOnlyHint, false);
  });

  test("pedir NUNCA gasta numa chamada: devolve o custo e o id; só confirmar (2ª chamada) põe na fila; confirmar de novo não pede outra vez", async () => {
    await avatares([{ projeto: "birdie", nome: "Birdie", conta: "birdie.lanier" }, { projeto: "dell", nome: "Dell", conta: "" }]);
    // com 2 avatares, sem dizer qual: erro com a lista, nada criado
    const sem = await chamar("pedir", { comando: "fotos", texto: "na praia", n: 2 });
    assert.equal(sem.isError, true);
    assert.match(textoDe(sem), /Birdie \(@birdie\.lanier\), Dell/);
    assert.equal((await db.sql("select count(*)::int as n from public.molde_fila"))[0].n, 0);

    const r = await chamar("pedir", { comando: "fotos", texto: "tomando café na varanda", n: 3, avatar: "@birdie.lanier" });
    assert.equal(r.isError, undefined);
    const id = r.structuredContent?.id as string;
    assert.equal(r.structuredContent?.custoUsd, 0.75);
    assert.match(textoDe(r), /3 fotos para Birdie \(@birdie\.lanier\)/);
    assert.match(textoDe(r), /≈ US\$ 0,75/);
    assert.match(textoDe(r), new RegExp(`Nada gasta até a ferramenta «confirmar» ser chamada com o id ${id}`));
    assert.match(textoDe(r), /Gasto em .*: US\$ 0,00 de US\$ 1,00/);
    const rasc = (await db.sql("select estado, projeto, confirmado_em from public.molde_fila where id = $1", [id]))[0];
    assert.equal(rasc.estado, "rascunho", "1 chamada = rascunho, nada na fila");
    assert.equal(rasc.projeto, "birdie");
    assert.equal(rasc.confirmado_em, null);
    // o rascunho não aparece para a página
    const pagina = await (await filaRoute.GET(request("/api/molde/fila?origem=telegram&estado=na_fila&semPedido=1", { headers: MOLDE }))).json();
    assert.equal(pagina.data.length, 0);

    const c = await chamar("confirmar", { id });
    assert.equal(c.isError, undefined);
    assert.match(textoDe(c), /Confirmado: 3 fotos: tomando café na varanda \(US\$ 0,75\) está na fila/);
    const l = (await db.sql("select estado, confirmado_via, nota from public.molde_fila where id = $1", [id]))[0];
    assert.equal(l.estado, "na_fila");
    assert.equal(l.confirmado_via, "mcp");
    assert.match(String(l.nota), /Pedido pelo Claude/);
    assert.match(String(meta.telegram.at(-1)?.body.text), /pedido pelo Claude e confirmado/);
    // a página pega como pega os do Telegram
    const pendentes = await (await filaRoute.GET(request("/api/molde/fila?origem=telegram&estado=na_fila&semPedido=1", { headers: MOLDE }))).json();
    assert.deepEqual(pendentes.data.map((x: { id: string }) => x.id), [id]);
    const de_novo = await chamar("confirmar", { id });
    assert.equal(de_novo.structuredContent?.repetido, true);
    assert.equal((await db.sql("select count(*)::int as n from public.molde_fila"))[0].n, 1);
    // o 3º pedido passa do limite do mês (US$ 1): o pedir avisa
    const caro = await chamar("pedir", { comando: "fotos", texto: "no parque", n: 2, avatar: "Dell" });
    assert.match(textoDe(caro), /passa do limite do mês \(sobra US\$ 0,25\)/);
  });

  test("confirmar: id errado, vencido ou cancelado é recusado; reel com 1 avatar vai direto ao custo (US$ 0,00)", async () => {
    await avatares([{ projeto: "birdie", nome: "Birdie", conta: "" }]);
    assert.equal((await chamar("confirmar", { id: "nao-e-id" })).isError, true);
    assert.equal((await chamar("confirmar", { id: "2b6c0d6e-8a51-4c41-9a39-7c1d1c1b0f10" })).isError, true);
    const r = await chamar("pedir", { comando: "reel", texto: "3 erros de quem reza com pressa" });
    assert.equal(r.structuredContent?.custoUsd, 0);
    assert.match(textoDe(r), /Reel novo para Birdie/);
    const id = r.structuredContent?.id as string;
    await db.sql("update public.molde_fila set expira_em = now() - interval '1 minute' where id = $1", [id]);
    const vencido = await chamar("confirmar", { id });
    assert.equal(vencido.isError, true);
    assert.match(textoDe(vencido), /passou do prazo/);
    assert.equal((await db.sql("select estado from public.molde_fila where id = $1", [id]))[0].estado, "rascunho");
    assert.equal((await chamar("pedir", { comando: "video", texto: "x" })).isError, true);
  });

  test("ver_fila, ver_item e decidir: a mesma regra do Telegram (Publicar mesmo assim; refazer pede motivo; já decidido)", async () => {
    await avatares([{ projeto: "birdie", nome: "Birdie", conta: "" }]);
    const criado = await (await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: ORQ, json: { projeto: "birdie", estacao: "molde-roteirista", tipo: "legenda", titulo: "Legenda da oração" } }))).json();
    let item = criado.item;
    const acao = async (nome: string, json: Record<string, unknown>) =>
      (await (await acaoRoute.POST(request(`/api/molde/fila/${item.id}/${nome}`, { method: "POST", json: { versao: item.versao, ...json }, headers: ORQ }), routeParams({ id: item.id, acao: nome }))).json()).item;
    item = await acao("pegar", { quem: "orquestrador" });
    item = await acao("aprovacao", { motivo: "revisor", achados: [{ lugar: "legenda", trecho: "cura", porque: "promessa de saúde", troca: "acalma" }] });

    const fila = await chamar("ver_fila", { avatar: "birdie", estado: "esperando-dono" });
    assert.match(textoDe(fila), /\[esperando-dono\] Birdie: Legenda da oração \(legenda\) · espera: corrigir, refazer, publicar, cancelar/);
    assert.equal((fila.structuredContent?.itens as unknown[]).length, 1);
    assert.equal((await chamar("ver_fila", { estado: "pronto" })).structuredContent?.itens instanceof Array, true);
    assert.equal((await chamar("ver_fila", { estado: "voando" })).isError, true);
    const visto = await chamar("ver_item", { id: item.id });
    assert.match(textoDe(visto), /Achado 1: legenda · «cura» · promessa de saúde · troca: «acalma»/);

    const semMotivo = await chamar("decidir", { id: item.id, decisao: "refazer" });
    assert.equal(semMotivo.isError, true);
    assert.match(textoDe(semMotivo), /diga o que mudar/);
    const naoVale = await chamar("decidir", { id: item.id, decisao: "gravar" });
    assert.match(textoDe(naoVale), /As opções dele: corrigir, refazer, publicar, cancelar/);
    const ok = await chamar("decidir", { id: item.id, decisao: "publicar" });
    assert.equal(ok.isError, undefined);
    assert.match(textoDe(ok), /Publicar mesmo assim \(escolha do dono\) às .* \(pelo Claude\)/);
    assert.equal((ok.structuredContent?.item as { estado: string }).estado, "aprovado");
    // a mensagem do Telegram passa a mostrar a decisão (sem botões)
    assert.match(String(meta.telegramApi.filter((c) => c.method === "editMessageText").at(-1)?.body.text), /pelo Claude/);
    const dup = await chamar("decidir", { id: item.id, decisao: "cancelar" });
    assert.match(textoDe(dup), /Já foi decidido/);
  });

  test("status_do_mes: gasto x limite e a fila por avatar (a mesma linha do /status do Telegram)", async () => {
    await filaRoute.POST(request("/api/molde/fila", { method: "POST", headers: MOLDE, json: { itens: [{ ref: "pedido:p1", tipo: "fotos", estado: "pronto", projeto: "birdie", avatar: "Birdie", custoEstimadoUsd: 1.5 }] } }));
    const r = await chamar("status_do_mes");
    const g = r.structuredContent?.gasto as { gastoUsd: number; limiteUsd: number; passou: boolean };
    assert.equal(g.gastoUsd, 1.5);
    assert.equal(g.limiteUsd, 1);
    assert.equal(g.passou, true);
    assert.match(textoDe(r), /US\$ 1,50 de US\$ 1,00 \(passou do limite\)/);
    assert.match(textoDe(r), /Birdie: 1 pronto/);
  });
});
