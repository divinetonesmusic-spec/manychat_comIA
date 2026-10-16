import "./helpers/env.mjs";
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { NextRequest } from "next/server";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { BASE_URL, request, routeParams } from "./helpers/http.mjs";

/**
 * Fase 10 · U10: cópia de segurança do Molde no R2 (fora do Claude). Sem banco: o R2 falso (com estado) é a lista.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const rota = await import("@/app/api/molde/backup/route");
const partesRota = await import("@/app/api/molde/backup/partes/route");
const umaRota = await import("@/app/api/molde/backup/[id]/route");
const lib = await import("@/lib/molde/backup");

after(() => meta.restore());

/** Pedido com corpo em bytes (gzip), que o helper de JSON não faz. */
function bruto(path: string, body: Buffer, method = "PUT", headers: Record<string, string> = MOLDE) {
  return new NextRequest(new URL(path, BASE_URL), { method, body: new Uint8Array(body), headers: { "content-type": "application/gzip", ...headers } });
}

const COPIA = { versao: 1, colecoes: { moldes: [{ id: "m1", nome: "Birdie" }], partes: [], pedidos: [{ id: "p1", texto: "ação é ótimo" }] } };

async function guardar(projeto: string | null, json: unknown) {
  const path = projeto ? `/api/molde/backup?projeto=${projeto}` : "/api/molde/backup";
  return rota.PUT(request(path, { method: "PUT", json, headers: MOLDE }));
}

async function lerInteira(id: string) {
  const primeira = await (await umaRota.GET(request(`/api/molde/backup/${id}`, { headers: MOLDE }), routeParams({ id }))).json();
  const pedacos = [Buffer.from(primeira.data.gz64, "base64")];
  for (let parte = 1; parte < primeira.data.partes; parte += 1) {
    const res = await umaRota.GET(request(`/api/molde/backup/${id}?parte=${parte}`, { headers: MOLDE }), routeParams({ id }));
    assert.equal(res.status, 200);
    const corpo = await res.json();
    assert.equal(corpo.data.parte, parte);
    pedacos.push(Buffer.from(corpo.data.gz64, "base64"));
  }
  return JSON.parse(gunzipSync(Buffer.concat(pedacos)).toString("utf8"));
}

/** Objetos de cópia postos direto no R2 falso, com a data na chave. */
function semear(projeto: string, quando: Date) {
  const key = lib.keyOf(projeto, lib.stampOf(quando), randomBytes(10).toString("hex"));
  meta.r2.set(key, { body: gzipSync(Buffer.from("{}")), lastModified: quando, contentType: "application/gzip" });
  return key;
}

beforeEach(() => meta.reset());

describe("porta e configuração", () => {
  test("sem token: 401 com código; servidor sem MOLDE_API_TOKEN: 503 fechado", async () => {
    const semToken = await rota.GET(request("/api/molde/backup"));
    assert.equal(semToken.status, 401);
    assert.equal((await semToken.json()).codigo, "token_invalido");
    const salvo = process.env.MOLDE_API_TOKEN;
    delete process.env.MOLDE_API_TOKEN;
    try {
      const fechado = await rota.PUT(request("/api/molde/backup", { method: "PUT", json: COPIA, headers: MOLDE }));
      assert.equal(fechado.status, 503);
      assert.equal((await fechado.json()).codigo, "fechado");
    } finally {
      process.env.MOLDE_API_TOKEN = salvo;
    }
  });

  test("sem R2 configurado: 503 sem_r2 com a frase", async () => {
    const salvo = process.env.R2_BUCKET;
    delete process.env.R2_BUCKET;
    try {
      const res = await guardar("birdie-lanier", COPIA);
      assert.equal(res.status, 503);
      const corpo = await res.json();
      assert.equal(corpo.codigo, "sem_r2");
      assert.match(corpo.error, /R2/);
    } finally {
      process.env.R2_BUCKET = salvo;
    }
  });

  test("R2 fora do ar: 502 r2_falhou (frase, sem detalhe interno)", async () => {
    meta.r2Fails = 500;
    const res = await guardar("birdie-lanier", COPIA);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).codigo, "r2_falhou");
    const lista = await rota.GET(request("/api/molde/backup", { headers: MOLDE }));
    assert.equal(lista.status, 502);
  });
});

describe("guardar, listar e devolver", () => {
  test("JSON puro (PUT): guarda comprimido numa chave impossível de adivinhar e devolve igual", async () => {
    const res = await guardar("birdie-lanier", COPIA);
    assert.equal(res.status, 201);
    const { data, apagadas } = await res.json();
    assert.equal(apagadas, 0);
    assert.equal(data.projeto, "birdie-lanier");
    assert.match(data.id, /^birdie-lanier--\d{8}-\d{6}-\d{3}-[a-f0-9]{20}$/);
    assert.ok(Math.abs(Date.parse(data.criadoEm) - Date.now()) < 5000);
    assert.equal(data.partes, 1);

    const [key] = [...meta.r2.keys()];
    assert.match(key, /^uaiflow\/molde-backups\/birdie-lanier\/\d{8}-\d{6}-\d{3}-[a-f0-9]{20}\.json\.gz$/);
    const guardado = meta.r2.get(key)!;
    assert.equal(guardado.contentType, "application/gzip");
    assert.equal(data.tamanho, guardado.body.length);
    assert.deepEqual(JSON.parse(gunzipSync(guardado.body).toString("utf8")), COPIA);

    assert.deepEqual(await lerInteira(data.id), COPIA);
  });

  test("pela ponte do robô (POST com { projeto, gz64 }) e gzip direto (PUT ?projeto=)", async () => {
    const gz = gzipSync(Buffer.from(JSON.stringify(COPIA)));
    const viaPonte = await rota.POST(request("/api/molde/backup", { json: { projeto: "lua-azul", gz64: gz.toString("base64") }, headers: MOLDE }));
    assert.equal(viaPonte.status, 201);
    const a = (await viaPonte.json()).data;
    assert.equal(a.projeto, "lua-azul");
    assert.deepEqual(await lerInteira(a.id), COPIA);

    const direto = await rota.PUT(bruto("/api/molde/backup?projeto=lua-azul", gz));
    assert.equal(direto.status, 201);
    const b = (await direto.json()).data;
    assert.equal(b.tamanho, gz.length, "o gzip enviado é guardado como veio");
    assert.deepEqual(await lerInteira(b.id), COPIA);

    const tudo = await guardar(null, COPIA);
    assert.equal((await tudo.json()).data.projeto, "tudo", "sem projeto = «tudo»");
  });

  test("lista: mais novas primeiro, com data e tamanho; por projeto ou de todos; ignora o que não é cópia", async () => {
    const antiga = semear("birdie-lanier", new Date(Date.now() - 3 * 86_400_000));
    semear("lua-azul", new Date(Date.now() - 86_400_000));
    meta.r2.set("uaiflow/molde-backups/_envios/lua-azul-abcdefabcdefabcdef/00-de-02", { body: Buffer.from("x"), lastModified: new Date(), contentType: "" });
    meta.r2.set("uaiflow/molde/2026-10/video.mp4", { body: Buffer.from("x"), lastModified: new Date(), contentType: "" });
    const nova = (await (await guardar("birdie-lanier", COPIA)).json()).data;

    const projeto = await (await rota.GET(request("/api/molde/backup?projeto=birdie-lanier", { headers: MOLDE }))).json();
    assert.equal(projeto.total, 2);
    assert.deepEqual(projeto.data.map((item: { id: string }) => item.id), [nova.id, lib.keyFromId(nova.id) && antiga.replace(/^uaiflow\/molde-backups\/birdie-lanier\/(.*)\.json\.gz$/, "birdie-lanier--$1")]);
    for (const item of projeto.data) assert.deepEqual(Object.keys(item).sort(), ["criadoEm", "id", "partes", "projeto", "tamanho"]);

    const todos = await (await rota.GET(request("/api/molde/backup", { headers: MOLDE }))).json();
    assert.equal(todos.total, 3);
    assert.deepEqual(todos.data.map((item: { projeto: string }) => item.projeto), ["birdie-lanier", "lua-azul", "birdie-lanier"]);
  });

  test("link de 15 minutos para baixar o .json.gz; id desconhecido ou inválido: 404", async () => {
    const { data } = await (await guardar("birdie-lanier", COPIA)).json();
    const res = await umaRota.GET(request(`/api/molde/backup/${data.id}?formato=link`, { headers: MOLDE }), routeParams({ id: data.id }));
    assert.equal(res.status, 200);
    const link = (await res.json()).data;
    assert.equal(link.id, data.id);
    const url = new URL(link.link);
    assert.equal(url.hostname, "contafalsa.r2.cloudflarestorage.com");
    assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
    assert.ok(url.pathname.endsWith(".json.gz"));

    const outro = "birdie-lanier--20260101-000000-000-0123456789abcdef0123";
    for (const id of [outro, "../../segredo", "birdie-lanier"]) {
      const r = await umaRota.GET(request(`/api/molde/backup/x`, { headers: MOLDE }), routeParams({ id }));
      assert.equal(r.status, 404, id);
      assert.equal((await r.json()).codigo, "nao_encontrada");
    }
    const linkSumido = await umaRota.GET(request(`/api/molde/backup/x?formato=link`, { headers: MOLDE }), routeParams({ id: outro }));
    assert.equal(linkSumido.status, 404);
    const parteErrada = await umaRota.GET(request(`/api/molde/backup/x?parte=1`, { headers: MOLDE }), routeParams({ id: data.id }));
    assert.equal(parteErrada.status, 400);
  });
});

describe("recusas (frase + código)", () => {
  test("projeto inválido, corpo vazio, JSON quebrado, lista em vez de objeto, gzip estragado", async () => {
    const casos: [Promise<Response>, number, string][] = [
      [guardar("Birdie Lanier", COPIA), 400, "invalido"],
      [guardar("../x", COPIA), 400, "invalido"],
      [rota.PUT(bruto("/api/molde/backup", Buffer.alloc(0))), 400, "invalido"],
      [rota.PUT(bruto("/api/molde/backup", Buffer.from("{ quebrado"))), 400, "invalido"],
      [guardar("a", [1, 2, 3]), 400, "invalido"],
      [rota.PUT(bruto("/api/molde/backup", Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]))), 400, "invalido"],
      [rota.POST(request("/api/molde/backup", { json: { gz64: "não é base64!" }, headers: MOLDE })), 400, "invalido"],
      [rota.PUT(bruto("/api/molde/backup", gzipSync(Buffer.from("[1]")))), 400, "invalido"],
    ];
    for (const [promessa, status, codigo] of casos) {
      const res = await promessa;
      assert.equal(res.status, status);
      const corpo = await res.json();
      assert.equal(corpo.codigo, codigo);
      assert.ok(corpo.error.length > 10);
    }
    assert.equal(meta.r2.size, 0, "nada foi guardado");
  });

  test("pedido acima de 5,5 MB: 413 (mande em partes); gzip que abre em mais de 25 MB: 413", async () => {
    const grande = Buffer.from(JSON.stringify({ x: randomBytes(4_500_000).toString("base64") }));
    assert.ok(grande.length > lib.MAX_PEDIDO);
    const res = await rota.PUT(bruto("/api/molde/backup", grande));
    assert.equal(res.status, 413);
    const corpo = await res.json();
    assert.equal(corpo.codigo, "grande_demais");
    assert.match(corpo.error, /partes/);

    const bomba = gzipSync(Buffer.from(`{"x":"${"a".repeat(26 * 1024 * 1024)}"}`));
    assert.ok(bomba.length < 1024 * 1024);
    const r = await rota.PUT(bruto("/api/molde/backup", bomba));
    assert.equal(r.status, 413);
    assert.equal((await r.json()).codigo, "grande_demais");
    assert.equal(meta.r2.size, 0);
  });
});

describe("quantas ficam: as 30 últimas + 1 por mês por 12 meses", () => {
  test("regra pura (toKeep)", () => {
    const agora = new Date("2026-10-16T12:00:00Z");
    const itens = [] as { id: string; projeto: string; criadoEm: string; tamanho: number; partes: number }[];
    const mais = (iso: string, n: number) => itens.push({ id: `p--${lib.stampOf(new Date(iso))}-${String(n).padStart(20, "0")}`, projeto: "p", criadoEm: new Date(iso).toISOString(), tamanho: 1, partes: 1 });
    for (let dia = 0; dia < 40; dia += 1) mais(new Date(agora.getTime() - dia * 86_400_000).toISOString(), dia);
    mais("2026-03-05T00:00:00Z", 100);
    mais("2026-03-25T00:00:00Z", 101);
    mais("2025-11-30T00:00:00Z", 102); // 11 meses atrás: fica
    mais("2025-10-31T00:00:00Z", 103); // 12 meses atrás: sai
    const fica = lib.toKeep(itens, agora);
    const ordenados = [...itens].sort((a, b) => b.id.localeCompare(a.id));
    for (const item of ordenados.slice(0, 30)) assert.ok(fica.has(item.id));
    const porData = (iso: string) => itens.find((item) => item.criadoEm === new Date(iso).toISOString())!.id;
    assert.ok(fica.has(porData("2026-03-25T00:00:00Z")), "a mais nova de março fica");
    assert.ok(!fica.has(porData("2026-03-05T00:00:00Z")), "a outra de março sai");
    assert.ok(fica.has(porData("2025-11-30T00:00:00Z")));
    assert.ok(!fica.has(porData("2025-10-31T00:00:00Z")));
    // setembro (dias 16 a 39 atrás, fora das 30): só a mais nova de setembro fica
    const setembro = ordenados.filter((item) => item.criadoEm.startsWith("2026-09"));
    assert.equal(setembro.filter((item) => fica.has(item.id)).length, setembro.filter((item, i) => ordenados.indexOf(item) < 30 || i === 0).length);
  });

  test("ao guardar, apaga do R2 as que sobram (só do mesmo projeto) e as partes de envio esquecidas", async () => {
    const agora = Date.now();
    for (let dia = 1; dia <= 35; dia += 1) semear("birdie-lanier", new Date(agora - dia * 86_400_000));
    const hoje = new Date();
    const antigas: string[] = [];
    for (let mes = 2; mes <= 14; mes += 1) {
      antigas.push(semear("birdie-lanier", new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - mes, 10, 12))));
      antigas.push(semear("birdie-lanier", new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - mes, 20, 12))));
    }
    const outroProjeto = semear("lua-azul", new Date(Date.UTC(2020, 0, 1)));
    const parteVelha = "uaiflow/molde-backups/_envios/birdie-lanier-velhovelhovelho1/00-de-02";
    const parteNova = "uaiflow/molde-backups/_envios/birdie-lanier-novonovonovonovo/00-de-02";
    meta.r2.set(parteVelha, { body: Buffer.from("x"), lastModified: new Date(agora - 2 * 86_400_000), contentType: "" });
    meta.r2.set(parteNova, { body: Buffer.from("x"), lastModified: new Date(agora - 3_600_000), contentType: "" });

    const res = await guardar("birdie-lanier", COPIA);
    assert.equal(res.status, 201);
    const { apagadas } = await res.json();

    const ficaram = await (await rota.GET(request("/api/molde/backup?projeto=birdie-lanier", { headers: MOLDE }))).json();
    assert.equal(apagadas, 1 + 35 + 26 - ficaram.total);
    assert.ok(ficaram.total <= 30 + 12);
    const meses = new Map<string, number>();
    for (const item of ficaram.data.slice(30)) meses.set(item.criadoEm.slice(0, 7), (meses.get(item.criadoEm.slice(0, 7)) ?? 0) + 1);
    for (const n of meses.values()) assert.equal(n, 1, "além das 30, no máximo 1 por mês");
    const limite = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 11, 1)).toISOString();
    assert.ok(ficaram.data.every((item: { criadoEm: string }) => item.criadoEm >= limite), "nada de mais de 12 meses");
    for (let mes = 2; mes <= 11; mes += 1) {
      const chave = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - mes, 1)).toISOString().slice(0, 7);
      assert.ok(ficaram.data.some((item: { criadoEm: string }) => item.criadoEm.startsWith(chave)), `fica uma de ${chave}`);
    }
    assert.ok(!meta.r2.has(antigas[0]), "a de 2 meses atrás do dia 10 sai");
    assert.ok(meta.r2.has(antigas[1]), "a do dia 20 fica");
    assert.ok(meta.r2.has(outroProjeto), "outro projeto não é tocado");
    assert.ok(!meta.r2.has(parteVelha));
    assert.ok(meta.r2.has(parteNova));
  });
});

describe("envio em partes (/api/molde/backup/partes)", () => {
  /** Cópia que não comprime (≈ 6 MB em gzip): não cabe num pedido só. */
  function copiaGrande() {
    const json = Buffer.from(JSON.stringify({ colecoes: { biblioteca: [{ id: "b1", imagem: randomBytes(6_000_000).toString("base64") }] } }));
    return { json, gz: gzipSync(json) };
  }
  const pedacos = (gz: Buffer) => Array.from({ length: Math.ceil(gz.length / (2 * 1024 * 1024)) }, (_, i) => gz.subarray(i * 2 * 1024 * 1024, (i + 1) * 2 * 1024 * 1024));
  const parte = (corpo: Record<string, unknown>) => partesRota.POST(request("/api/molde/backup/partes", { json: corpo, headers: MOLDE }));

  test("3 partes em ordem: 202, 202, 201; a cópia volta inteira em pedaços de 2 MB e as partes temporárias somem", async () => {
    const { json, gz } = copiaGrande();
    assert.ok(gz.length > lib.MAX_PEDIDO);
    const lista = pedacos(gz);
    assert.ok(lista.length >= 3);
    const envio = "a1b2c3d4e5f6a7b8c9d0";
    let final: { data: { id: string; partes: number; tamanho: number } } | null = null;
    for (let i = 0; i < lista.length; i += 1) {
      const res = await parte({ projeto: "birdie-lanier", envio, parte: i, total: lista.length, gz64: lista[i].toString("base64") });
      if (i < lista.length - 1) {
        assert.equal(res.status, 202);
        assert.deepEqual((await res.json()).data, { envio, parte: i, total: lista.length, pronto: false });
      } else {
        assert.equal(res.status, 201);
        final = await res.json();
      }
    }
    assert.equal(final!.data.tamanho, gz.length);
    assert.equal(final!.data.partes, Math.ceil(gz.length / (2 * 1024 * 1024)));
    assert.deepEqual([...meta.r2.keys()].filter((k) => k.includes("_envios")), []);
    assert.deepEqual(await lerInteira(final!.data.id), JSON.parse(json.toString("utf8")));
  });

  test("faltando parte: 409 faltam_partes com a lista; mandando a que falta e a última de novo, guarda", async () => {
    const { gz } = copiaGrande();
    const lista = pedacos(gz);
    const envio = "ffffeeeeddddccccbbbb";
    const ultima = lista.length - 1;
    const corpo = (i: number) => ({ projeto: "birdie-lanier", envio, parte: i, total: lista.length, gz64: lista[i].toString("base64") });
    assert.equal((await parte(corpo(0))).status, 202);
    const faltou = await parte(corpo(ultima));
    assert.equal(faltou.status, 409);
    const erro = await faltou.json();
    assert.equal(erro.codigo, "faltam_partes");
    assert.deepEqual(erro.faltam, Array.from({ length: ultima - 1 }, (_, i) => i + 1));
    for (let i = 1; i < ultima; i += 1) assert.equal((await parte(corpo(i))).status, 202);
    assert.equal((await parte(corpo(ultima))).status, 201);
  });

  test("recusas: envio, total e parte inválidos; parte acima de 3 MB; partes que não formam gzip", async () => {
    const ok = { projeto: "p", envio: "abcdefabcdefabcdef", parte: 0, total: 1, gz64: gzipSync(Buffer.from("{}")).toString("base64") };
    for (const errado of [{ envio: "curto" }, { envio: "MAIUSCULAS0123456789" }, { total: 0 }, { total: 13 }, { parte: 1 }, { parte: -1 }, { gz64: "" }, { projeto: "A B" }]) {
      const res = await parte({ ...ok, ...errado });
      assert.equal(res.status, 400, JSON.stringify(errado));
      assert.equal((await res.json()).codigo, "invalido");
    }
    const grande = await parte({ ...ok, gz64: randomBytes(3 * 1024 * 1024 + 1).toString("base64") });
    assert.equal(grande.status, 413);
    const lixo = await parte({ ...ok, gz64: Buffer.from("isto não é gzip").toString("base64") });
    assert.equal(lixo.status, 400);
    assert.equal((await parte(ok)).status, 201, "uma parte só também serve");
  });
});

describe("a ponte do robô (uaiflow {op:'chamar'}) alcança as rotas", () => {
  // Cópia da trava do robô (mcpb/flow/server/index.mjs, 0.9.2+): só /api/molde/* (menos upload), métodos GET/POST/PATCH/DELETE.
  const ROTA_MOLDE = /^\/api\/molde\/(?!upload(\/|$|\?))[a-z0-9][a-z0-9\/_-]*(\?[A-Za-z0-9=&%._,-]*)?$/;
  test("as rotas documentadas passam na trava", () => {
    for (const r of [
      "/api/molde/backup",
      "/api/molde/backup?projeto=birdie-lanier",
      "/api/molde/backup/partes",
      "/api/molde/backup/birdie-lanier--20261016-130500-123-0123456789abcdef0123",
      "/api/molde/backup/birdie-lanier--20261016-130500-123-0123456789abcdef0123?parte=2",
      "/api/molde/backup/birdie-lanier--20261016-130500-123-0123456789abcdef0123?formato=link",
    ]) assert.ok(ROTA_MOLDE.test(r), r);
  });
});
