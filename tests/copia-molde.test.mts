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

const COPIA = { formato: "molde-copia-1", projeto: "birdie-lanier", criadoEm: "2026-10-16T13:00:00.000Z", colecoes: { moldes: [{ id: "m1", dados: { nome: "Birdie" } }], partes: [], pedidos: [{ id: "p1", dados: { texto: "ação é ótimo" } }] } };

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

    const outra = { ...COPIA, nome: "direto" }; // o mesmo conteúdo reenviado seria a mesma cópia (veja o teste de reenvio)
    const gzDireto = gzipSync(Buffer.from(JSON.stringify(outra)));
    const direto = await rota.PUT(bruto("/api/molde/backup?projeto=lua-azul", gzDireto));
    assert.equal(direto.status, 201);
    const b = (await direto.json()).data;
    assert.equal(b.tamanho, gzDireto.length, "o gzip enviado é guardado como veio");
    assert.deepEqual(await lerInteira(b.id), outra);

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

  test("a limpeza (pruneBackups, do relógio) apaga as que sobram, em todos os projetos, e as partes de envio esquecidas; guardar não apaga nada", async () => {
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

    const antesDeGuardar = meta.r2.size;
    const res = await guardar("birdie-lanier", COPIA);
    assert.equal(res.status, 201);
    assert.equal((await res.json()).apagadas, 0, "guardar não apaga nada (a poda é do relógio)");
    assert.ok(antigas.every((k) => meta.r2.has(k)), "nenhuma cópia antiga foi apagada pela rota");
    assert.ok(meta.r2.size > antesDeGuardar, "só acrescentou");
    assert.ok(meta.r2.has(parteVelha), "a parte velha ainda está lá");

    const poda = await lib.pruneBackups({ timeLeft: () => 20_000 });
    const apagadas = poda.apagadas;
    assert.equal(poda.orfaos, 1, "a parte esquecida há 2 dias");

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
    const json = Buffer.from(JSON.stringify({ formato: "molde-copia-1", colecoes: { biblioteca: [{ id: "b1", dados: { imagem: randomBytes(6_000_000).toString("base64") } }] } }));
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
    assert.deepEqual([...meta.r2.keys()].filter((k) => k.includes("_envios") && !k.endsWith(".pronto")), []);
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
    const ok = { projeto: "p", envio: "abcdefabcdefabcdef", parte: 0, total: 1, gz64: gzipSync(Buffer.from(JSON.stringify(COPIA))).toString("base64") };
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

describe("Revisão F10 · I1 · balde privado para as cópias (R2_BACKUP_BUCKET)", () => {
  const credenciais = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;
  function com(env: Record<string, string | undefined>) {
    const salvo = Object.fromEntries(Object.keys(env).map((nome) => [nome, process.env[nome]]));
    for (const [nome, valor] of Object.entries(env)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
    return () => {
      for (const [nome, valor] of Object.entries(salvo)) {
        if (valor === undefined) delete process.env[nome];
        else process.env[nome] = valor;
      }
    };
  }

  test("sem R2_BACKUP_BUCKET: usa o balde das mídias, como antes", async () => {
    const volta = com({ R2_BACKUP_BUCKET: undefined });
    try {
      const res = await guardar("birdie-lanier", COPIA);
      assert.equal(res.status, 201);
      assert.deepEqual([...meta.r2Buckets], ["baldefalso"]);
    } finally {
      volta();
    }
  });

  test("com R2_BACKUP_BUCKET: guardar, listar, ler, link e apagar vão só para o balde privado, mesmo sem R2_PUBLIC_BASE_URL", async () => {
    const volta = com({ R2_BACKUP_BUCKET: "baldeprivado", R2_PUBLIC_BASE_URL: undefined });
    try {
      const res = await guardar("birdie-lanier", COPIA);
      assert.equal(res.status, 201);
      const { data } = await res.json();
      const lista = await (await rota.GET(request("/api/molde/backup?projeto=birdie-lanier", { headers: MOLDE }))).json();
      assert.equal(lista.total, 1);
      assert.deepEqual(await lerInteira(data.id), COPIA);
      const link = (await (await umaRota.GET(request(`/api/molde/backup/${data.id}?formato=link`, { headers: MOLDE }), routeParams({ id: data.id }))).json()).data.link;
      assert.ok(new URL(link).pathname.startsWith("/baldeprivado/"), "o link assinado é do balde privado");
      assert.deepEqual([...meta.r2Buckets], ["baldeprivado"], "nada tocou o balde das mídias");
    } finally {
      volta();
    }
  });

  test("com R2_BACKUP_BUCKET mas sem as credenciais: 503 sem_r2", async () => {
    for (const nome of credenciais) {
      const volta = com({ R2_BACKUP_BUCKET: "baldeprivado", [nome]: undefined });
      try {
        const res = await guardar("birdie-lanier", COPIA);
        assert.equal(res.status, 503, nome);
        assert.equal((await res.json()).codigo, "sem_r2");
      } finally {
        volta();
      }
    }
  });

  test("balde das mídias continua sem tocar nas cópias de outro balde (as mídias não usam R2_BACKUP_BUCKET)", async () => {
    const volta = com({ R2_BACKUP_BUCKET: "baldeprivado" });
    try {
      const alvo = await import("@/lib/content/r2");
      assert.equal(alvo.getR2Config()!.bucket, "baldefalso");
      assert.equal(alvo.getR2BackupConfig()!.bucket, "baldeprivado");
    } finally {
      volta();
    }
  });
});

describe("Revisão F10 · I1 · campos de segredo não vão para a cópia", () => {
  const COM_SEGREDOS = {
    formato: "molde-copia-1",
    token: "tok-raiz",
    colecoes: {
      moldes: [{ id: "m1", dados: { nome: "Birdie", apiKey: "AIza-falsa", configuracao: { senha: "123", Password: "x", segredo: { a: 1 }, client_secret: "s", ok: "fica" } } }],
      audio: [{ id: "a1", dados: { tokens: 1234, usouToken: true, authorization: "Bearer abc", token_extra: null, texto: "oi", lista: [{ accessToken: "t", n: 2 }] } }],
    },
  };

  test("remove token, apiKey, password, senha, secret, authorization em qualquer nível; guarda números, booleanos e null com esse nome", async () => {
    const res = await guardar("birdie-lanier", COM_SEGREDOS);
    assert.equal(res.status, 201);
    const corpo = await res.json();
    assert.equal(corpo.removidos, 8);
    const guardada = await lerInteira(corpo.data.id);
    assert.equal(guardada.token, undefined);
    assert.equal(guardada.colecoes.moldes[0].dados.apiKey, undefined);
    assert.deepEqual(guardada.colecoes.moldes[0].dados.configuracao, { ok: "fica" });
    assert.deepEqual(guardada.colecoes.audio[0].dados, { tokens: 1234, usouToken: true, token_extra: null, texto: "oi", lista: [{ n: 2 }] });
    assert.equal(JSON.stringify(guardada).includes("AIza-falsa"), false);
  });

  test("vale também para gzip direto, gz64 e partes", async () => {
    const gz = gzipSync(Buffer.from(JSON.stringify(COM_SEGREDOS)));
    for (const res of [
      await rota.PUT(bruto("/api/molde/backup?projeto=lua-azul", gz)),
      await rota.POST(request("/api/molde/backup", { json: { projeto: "lua-verde", gz64: gz.toString("base64") }, headers: MOLDE })),
      await partesRota.POST(request("/api/molde/backup/partes", { json: { projeto: "lua-roxa", envio: "a1b2c3d4e5f6a7b8c9d0", parte: 0, total: 1, gz64: gz.toString("base64") }, headers: MOLDE })),
    ]) {
      assert.equal(res.status, 201);
      const corpo = await res.json();
      assert.equal(corpo.removidos, 8);
      assert.equal(JSON.stringify(await lerInteira(corpo.data.id)).includes("tok-raiz"), false);
    }
  });

  test("sem nada de segredo: guarda o gzip como veio e removidos = 0", async () => {
    const gz = gzipSync(Buffer.from(JSON.stringify(COPIA)));
    const res = await rota.PUT(bruto("/api/molde/backup?projeto=lua-azul", gz));
    const corpo = await res.json();
    assert.equal(corpo.removidos, 0);
    assert.equal(corpo.data.tamanho, gz.length);
  });

  test("objetos aninhados demais: 400 invalido (sem estourar a pilha)", async () => {
    const fundo = `${'{"a":'.repeat(5000)}1${"}".repeat(5000)}`;
    const res = await rota.PUT(bruto("/api/molde/backup", Buffer.from(fundo), "PUT", { ...MOLDE, "content-type": "application/json" }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).codigo, "invalido");
  });
});

describe("Revisão F10 · I3 · só entra cópia no formato da página e com conteúdo", () => {
  const sem = (tirar: string) => {
    const copia = JSON.parse(JSON.stringify(COPIA)) as Record<string, unknown>;
    delete copia[tirar];
    return copia;
  };

  test("recusa: sem formato, formato errado, colecoes ausente/vazio/lista, coleção que não é lista, sem nenhum documento", async () => {
    const casos: unknown[] = [
      sem("formato"),
      { ...COPIA, formato: "molde-copia-2" },
      sem("colecoes"),
      { ...COPIA, colecoes: {} },
      { ...COPIA, colecoes: [] },
      { ...COPIA, colecoes: { moldes: {} } },
      { ...COPIA, colecoes: { moldes: [], partes: [] } },
      { versao: 1, colecoes: { moldes: [{ id: "x" }] } },
      {},
    ];
    for (const caso of casos) {
      const res = await guardar("birdie-lanier", caso);
      assert.equal(res.status, 400, JSON.stringify(caso));
      const corpo = await res.json();
      assert.equal(corpo.codigo, "invalido");
      assert.ok(corpo.error.length > 20);
    }
    // o mesmo vale para gzip direto, gz64 e partes
    const vazio = gzipSync(Buffer.from(JSON.stringify({ formato: "molde-copia-1", colecoes: {} })));
    assert.equal((await rota.PUT(bruto("/api/molde/backup?projeto=a", vazio))).status, 400);
    assert.equal((await rota.POST(request("/api/molde/backup", { json: { projeto: "a", gz64: vazio.toString("base64") }, headers: MOLDE }))).status, 400);
    const parte = await partesRota.POST(request("/api/molde/backup/partes", { json: { projeto: "a", envio: "a1b2c3d4e5f6a7b8c9d0", parte: 0, total: 1, gz64: vazio.toString("base64") }, headers: MOLDE }));
    assert.equal(parte.status, 400);
    assert.equal(meta.r2.size, [...meta.r2.keys()].filter((k) => k.includes("_envios")).length, "nenhuma cópia foi guardada (só, no máximo, a parte temporária)");
  });

  test("aceita o que a página realmente manda (um projeto com várias coleções) e uma cópia de «tudo» com uma coleção só", async () => {
    const daPagina = {
      formato: "molde-copia-1",
      projeto: "birdie-lanier",
      nome: "Birdie Lanier",
      criadoEm: "2026-10-16T13:00:00.000Z",
      colecoes: {
        moldes: [{ id: "birdie-lanier", dados: { rev: 3, titulo: "Birdie" } }],
        partes: [{ id: "birdie-lanier~p1", dados: { texto: "a" } }],
        pedidos: [],
        audio: [{ id: "birdie-lanier", dados: { narracoes: [] } }],
      },
    };
    assert.equal((await guardar("birdie-lanier", daPagina)).status, 201);
    assert.equal((await guardar(null, { formato: "molde-copia-1", colecoes: { moldes: [{ id: "a", dados: {} }] } })).status, 201);
  });
});

describe("Revisão F10 · I3 · a poda nunca troca cópias boas por uma ruim", () => {
  const item = (iso: string, tamanho: number, n: number) => ({
    id: `p--${lib.stampOf(new Date(iso))}-${String(n).padStart(20, "0")}`,
    projeto: "p",
    criadoEm: new Date(iso).toISOString(),
    tamanho,
    partes: 1,
  });

  test("a maior cópia de cada mês nunca sai, mesmo fora das 30 mais novas", () => {
    const agora = new Date("2026-10-16T12:00:00Z");
    const itens = [] as ReturnType<typeof item>[];
    for (let dia = 0; dia < 40; dia += 1) itens.push(item(new Date(agora.getTime() - dia * 86_400_000).toISOString(), 1000, dia));
    const maiorSetembro = item("2026-09-02T00:00:00Z", 5000, 200); // setembro: fora das 30 e não é a mais nova do mês
    const novaSetembro = item("2026-09-05T00:00:00Z", 900, 201);
    const maiorMarco = item("2026-03-05T00:00:00Z", 8000, 202);
    const novaMarco = item("2026-03-25T00:00:00Z", 100, 203); // truncada, mas é a mais nova do mês: também fica
    itens.push(maiorSetembro, novaSetembro, maiorMarco, novaMarco);
    const fica = lib.toKeep(itens, agora);
    assert.ok(fica.has(maiorSetembro.id));
    assert.ok(fica.has(maiorMarco.id));
    assert.ok(fica.has(novaMarco.id));
    const plano = lib.planPrune(itens, agora);
    assert.ok(!plano.apagar.some((x) => [maiorSetembro.id, maiorMarco.id, novaMarco.id].includes(x.id)));
    assert.ok(plano.apagar.length > 0);
  });

  test("nova com menos de 10% da anterior: nada é apagado; com 10% ou mais, a poda segue", () => {
    const agora = new Date("2026-10-16T12:00:00Z");
    const base = [] as ReturnType<typeof item>[];
    for (let dia = 1; dia <= 35; dia += 1) base.push(item(new Date(agora.getTime() - dia * 86_400_000).toISOString(), 10_000, dia));
    const pequena = item(agora.toISOString(), 999, 900);
    assert.deepEqual(lib.planPrune([pequena, ...base], agora), { apagar: [], motivo: "nova_pequena" });
    const normal = item(agora.toISOString(), 1000, 901);
    const plano = lib.planPrune([normal, ...base], agora);
    assert.equal(plano.motivo, undefined);
    assert.ok(plano.apagar.length >= 1);
    assert.deepEqual(lib.planPrune([pequena], agora), { apagar: [] }, "sem anterior, nada a comparar");
  });

  test("ao guardar uma cópia minúscula depois de uma grande, o R2 não perde nenhuma cópia antiga", async () => {
    const agora = Date.now();
    const grande = gzipSync(Buffer.from(JSON.stringify({ x: randomBytes(20_000).toString("base64") })));
    const chaves: string[] = [];
    for (let dia = 1; dia <= 35; dia += 1) {
      const quando = new Date(agora - dia * 86_400_000);
      const key = lib.keyOf("birdie-lanier", lib.stampOf(quando), randomBytes(10).toString("hex"));
      meta.r2.set(key, { body: grande, lastModified: quando, contentType: "application/gzip" });
      chaves.push(key);
    }
    const res = await guardar("birdie-lanier", { formato: "molde-copia-1", colecoes: { moldes: [{ id: "a", dados: {} }] } });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).apagadas, 0);
    assert.ok(chaves.every((key) => meta.r2.has(key)), "todas as antigas continuam lá");
  });
});

describe("Revisão F10 · I2 · orçamento de tempo e reenvio idempotente", () => {
  const copias = () => [...meta.r2.keys()].filter((k) => /\/molde-backups\/[a-z0-9-]+\/\d{8}-/.test(k));

  test("o mesmo conteúdo reenviado não duplica: 2º PUT devolve 200 repetida com o mesmo id; só há uma cópia", async () => {
    const um = await guardar("birdie-lanier", COPIA);
    assert.equal(um.status, 201);
    const a = await um.json();
    assert.equal(a.repetida, undefined);
    const dois = await guardar("birdie-lanier", COPIA);
    assert.equal(dois.status, 200);
    const b = await dois.json();
    assert.equal(b.repetida, true);
    assert.equal(b.data.id, a.data.id);
    assert.equal(copias().length, 1);
    // pela ponte (gz64) e por gzip direto, é o mesmo conteúdo: 1 cópia por forma de envio, depois repete
    const gz = gzipSync(Buffer.from(JSON.stringify({ ...COPIA, nome: "outro" })));
    const p1 = await rota.POST(request("/api/molde/backup", { json: { projeto: "birdie-lanier", gz64: gz.toString("base64") }, headers: MOLDE }));
    const p2 = await rota.POST(request("/api/molde/backup", { json: { projeto: "birdie-lanier", gz64: gz.toString("base64") }, headers: MOLDE }));
    assert.deepEqual([p1.status, p2.status], [201, 200]);
    assert.equal(copias().length, 2);
  });

  test("conteúdo diferente, outro projeto, marcador velho (> 1 h) ou cópia já apagada: cria outra normalmente", async () => {
    const a = (await (await guardar("birdie-lanier", COPIA)).json()).data;
    assert.equal((await guardar("lua-azul", COPIA)).status, 201, "outro projeto");
    assert.equal((await guardar("birdie-lanier", { ...COPIA, nome: "mudou" })).status, 201, "conteúdo diferente");
    // marcador com mais de 1 h
    const marcador = [...meta.r2.keys()].find((k) => k.includes("_hashes/birdie-lanier-") && JSON.parse(meta.r2.get(k)!.body.toString()).id === a.id)!;
    meta.r2.set(marcador, { ...meta.r2.get(marcador)!, body: Buffer.from(JSON.stringify({ id: a.id, em: Date.now() - 2 * 3_600_000 })) });
    const velho = await guardar("birdie-lanier", COPIA);
    assert.equal(velho.status, 201);
    assert.notEqual((await velho.json()).data.id, a.id);
    // cópia apagada (ex.: pela poda): o marcador não aponta para o nada
    const b = (await (await guardar("birdie-lanier", COPIA)).json());
    assert.equal(b.repetida, true);
    meta.r2.delete(lib.keyFromId(b.data.id)!);
    const c = await guardar("birdie-lanier", COPIA);
    assert.equal(c.status, 201);
    assert.notEqual((await c.json()).data.id, b.data.id);
  });

  test("em partes: reenviar a última parte depois de pronto devolve a mesma cópia (200); reenviar o envio inteiro com outro código também não duplica", async () => {
    const json = Buffer.from(JSON.stringify({ formato: "molde-copia-1", colecoes: { biblioteca: [{ id: "b1", dados: { imagem: randomBytes(6_000_000).toString("base64") } }] } }));
    const gz = gzipSync(json);
    const lista = Array.from({ length: Math.ceil(gz.length / (2 * 1024 * 1024)) }, (_, i) => gz.subarray(i * 2 * 1024 * 1024, (i + 1) * 2 * 1024 * 1024));
    const mandar = (envio: string, i: number) => partesRota.POST(request("/api/molde/backup/partes", { json: { projeto: "birdie-lanier", envio, parte: i, total: lista.length, gz64: lista[i].toString("base64") }, headers: MOLDE }));
    const envio = "k3j9x0a8f7d6s5a4q2w1";
    let primeira: { data: { id: string } } | null = null;
    for (let i = 0; i < lista.length; i += 1) {
      const res = await mandar(envio, i);
      if (i === lista.length - 1) {
        assert.equal(res.status, 201);
        primeira = await res.json();
      }
    }
    const denovo = await mandar(envio, lista.length - 1);
    assert.equal(denovo.status, 200);
    const corpo = await denovo.json();
    assert.equal(corpo.repetida, true);
    assert.equal(corpo.data.id, primeira!.data.id);
    // outro código de envio com o mesmo conteúdo (a página recomeçou do zero)
    let ultima: Response | null = null;
    for (let i = 0; i < lista.length; i += 1) ultima = await mandar("zzzzzzzzzzzzzzzzzzzz", i);
    assert.equal(ultima!.status, 200);
    assert.equal((await ultima!.json()).data.id, primeira!.data.id);
    assert.equal(copias().length, 1);
    assert.deepEqual([...meta.r2.keys()].filter((k) => k.includes("_envios") && !k.endsWith(".pronto")), [], "as partes temporárias sumiram");
  });

  test("guardar não faz listagem de poda: R2 fora do ar na limpeza não atrapalha, e a rota não lista a pasta do projeto", async () => {
    for (let dia = 1; dia <= 35; dia += 1) semear("birdie-lanier", new Date(Date.now() - dia * 86_400_000));
    meta.calls.length = 0;
    const res = await guardar("birdie-lanier", COPIA);
    assert.equal(res.status, 201);
    const listagens = meta.calls.filter((c) => c.search.get("list-type") === "2");
    assert.equal(listagens.length, 0, "PUT de cópia nova não lista nada (sem poda, sem listagem)");
  });

  // AbortSignal.timeout não segura o processo vivo; num teste sem banco, nada mais segura: um intervalo faz isso.
  const manterVivo = () => { const t = setInterval(() => undefined, 50); return () => clearInterval(t); };

  test("R2 que não responde: o PUT desiste dentro do orçamento (502 r2_falhou) e sem tempo sobrando responde 503 sem_tempo", async () => {
    const soltar = manterVivo();
    meta.hang = /baldefalso/;
    const inicio = Date.now();
    await assert.rejects(lib.saveBackup("birdie-lanier", gzipSync(Buffer.from(JSON.stringify(COPIA))), new Date(), Date.now() + 1500), (erro: unknown) => (erro as { codigo?: string }).codigo === "r2_falhou");
    assert.ok(Date.now() - inicio < 2500, `levou ${Date.now() - inicio} ms`);
    await assert.rejects(lib.saveBackup("birdie-lanier", gzipSync(Buffer.from(JSON.stringify(COPIA))), new Date(), Date.now() + 200), (erro: unknown) => (erro as { codigo?: string; status?: number }).codigo === "sem_tempo" && (erro as { status: number }).status === 503);
    await assert.rejects(lib.listBackups(null, Date.now() + 1500), (erro: unknown) => (erro as { codigo?: string }).codigo === "r2_falhou");
    meta.hang = null;
    soltar();
  });

  test("listagem tem teto (3000 itens) e a limpeza respeita o tempo: sem tempo, não toca no R2", async () => {
    for (let n = 0; n < 3100; n += 1) meta.r2.set(lib.keyOf("muitas", lib.stampOf(new Date(Date.UTC(2026, 0, 1, 0, 0, 0, n))), "0123456789abcdef0123"), { body: Buffer.from("x"), lastModified: new Date(), contentType: "" });
    const lista = await lib.listBackups("muitas");
    assert.equal(lista.length, 3000);
    meta.calls.length = 0;
    const sem = await lib.pruneBackups({ timeLeft: () => 1000 });
    assert.deepEqual(sem, { apagadas: 0, orfaos: 0, poupados: [] });
    assert.equal(meta.calls.length, 0);
  });

  test("pruneBackups com R2 travado devolve dentro do prazo", async () => {
    const soltar = manterVivo();
    for (let dia = 1; dia <= 35; dia += 1) semear("birdie-lanier", new Date(Date.now() - dia * 86_400_000));
    meta.hang = /baldefalso/;
    const fim = Date.now() + 4000;
    const inicio = Date.now();
    const poda = await lib.pruneBackups({ timeLeft: () => fim - Date.now() });
    assert.ok(Date.now() - inicio < 4500, `levou ${Date.now() - inicio} ms`);
    assert.equal(poda.apagadas, 0);
    meta.hang = null;
    soltar();
  });
});
