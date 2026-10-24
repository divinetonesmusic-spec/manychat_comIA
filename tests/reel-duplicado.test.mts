import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * U-SEG-03 (v133): o mesmo item do Molde nunca vira dois Reels. Trava no banco (chave única perfil + externalRef em
 * public.content_refs_publicadas, migração 0015) e conferência no relógio antes de criar o container e antes do media_publish.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const VIDEO = "https://midia.teste.invalid/uaiflow/reel.mp4";

describe("Reel duplicado (com a 0015)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let accountId: string;
  let scheduler: typeof import("@/lib/content/scheduler");
  let service: typeof import("@/lib/content/service");
  let moldeRoute: typeof import("@/app/api/molde/posts/route");
  let refs: typeof import("@/lib/db/refs-publicadas");

  before(async () => {
    db = await createTestDatabase();
    scheduler = await import("@/lib/content/scheduler");
    service = await import("@/lib/content/service");
    moldeRoute = await import("@/app/api/molde/posts/route");
    refs = await import("@/lib/db/refs-publicadas");
  });

  beforeEach(async () => {
    meta.reset();
    await db.sql("delete from public.content_refs_publicadas");
    await db.sql("delete from public.content_posts");
    await db.sql("delete from public.automations");
    await db.sql("delete from public.instagram_accounts");
    accountId = await seedAccount(db);
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  const enviar = (externalRef: string, extra: Record<string, unknown> = {}) =>
    moldeRoute.POST(request("/api/molde/posts", { headers: MOLDE, json: { externalRef, publishType: "reel", mediaUrl: VIDEO, caption: "Reel do Molde", publishNow: true, accountId, ...extra } }));

  async function rodarRelogio(vezes = 3) {
    for (let i = 0; i < vezes; i += 1) await scheduler.runContentCycle(8000);
  }

  test("caminho normal: publica 1 vez e registra a referência como publicada (com o id do Instagram)", async () => {
    const response = await enviar("reel-a");
    assert.equal(response.status, 201);
    await rodarRelogio();
    assert.equal(meta.count("/media_publish"), 1);
    const [registro] = await db.sql<{ estado: string; media_id: string | null; post_id: string }>("select estado, media_id, post_id from public.content_refs_publicadas where external_ref = 'reel-a'");
    assert.equal(registro.estado, "publicado");
    assert.ok(registro.media_id);
  });

  test("post publicado APAGADO do UaiFlow e o Molde manda o mesmo item de novo: 409, nada de 2º Reel", async () => {
    const primeiro = await (await enviar("reel-b")).json();
    await rodarRelogio();
    assert.equal(meta.count("/media_publish"), 1);
    await service.removePost(primeiro.data.id);

    const de_novo = await enviar("reel-b");
    assert.equal(de_novo.status, 409);
    assert.match((await de_novo.json()).error, /já foi publicado/);
    await rodarRelogio();
    assert.equal(meta.count("/media_publish"), 1, "continua 1");
    assert.equal((await db.sql("select 1 from public.content_posts")).length, 0, "nem cria o post");
  });

  test("relógio (antes do container): post com a referência de OUTRO post já publicado vai para 'Com erro', sem chamar a Meta", async () => {
    const outro = await insertPost(db, accountId, { status: "published", source: "molde", external_ref: "reel-c-antigo", published_media_id: "m-1" });
    await db.sql("insert into public.content_refs_publicadas (account_id, external_ref, post_id, estado, media_id) values ($1, 'reel-c', $2, 'publicado', 'm-1')", [accountId, outro]);
    const id = await insertPost(db, accountId, { source: "molde", external_ref: "reel-c" });

    await rodarRelogio();
    const post = await readPost(db, id);
    assert.equal(post.status, "failed");
    assert.match(String(post.last_error), /já foi publicado neste perfil por outro post/);
    assert.equal(meta.count("/media", "POST"), 0, "não criou container");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("relógio (antes do media_publish): a trava do banco segura mesmo com o container pronto", async () => {
    const id = await insertPost(db, accountId, { status: "publishing", source: "molde", external_ref: "reel-d", container_id: "container-d", publishing_started_at: new Date() });
    meta.containerStatus.set("container-d", "FINISHED");
    // outro post (já apagado) mandou esta referência para a Meta: o registro ficou
    await db.sql("insert into public.content_refs_publicadas (account_id, external_ref, post_id, estado) values ($1, 'reel-d', gen_random_uuid(), 'pedido')", [accountId]);

    await rodarRelogio(1);
    const post = await readPost(db, id);
    assert.equal(post.status, "failed");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("a reserva é atômica: o mesmo post pode reservar de novo; outro post não", async () => {
    const a = await insertPost(db, accountId, { source: "molde", external_ref: "reel-e" });
    const b = await insertPost(db, accountId, { source: "manual", external_ref: "reel-e" });
    const postA = { id: a, account_id: accountId, external_ref: "reel-e" };
    const postB = { id: b, account_id: accountId, external_ref: "reel-e" };
    const resultados = await Promise.all([refs.reservarRefParaPublicar(postA), refs.reservarRefParaPublicar(postB)]);
    assert.equal(resultados.filter((r) => r.ok).length, 1, "só um dos dois ganha a referência");
    const vencedor = resultados[0].ok ? postA : postB;
    assert.deepEqual(await refs.reservarRefParaPublicar(vencedor), { ok: true });
    assert.deepEqual(await refs.reservarRefParaPublicar({ id: a, account_id: accountId, external_ref: null }), { ok: true }, "post sem referência do Molde: sem trava");
  });

  test("dois envios do mesmo item ao mesmo tempo: um post só, sem erro 500, e 1 publicação", async () => {
    const respostas = await Promise.all([enviar("reel-f"), enviar("reel-f"), enviar("reel-f")]);
    for (const resposta of respostas) assert.ok(resposta.status < 500, `status ${resposta.status}: ${await resposta.clone().text()}`);
    assert.equal((await db.sql("select 1 from public.content_posts where external_ref = 'reel-f'")).length, 1);
    await rodarRelogio();
    assert.equal(meta.count("/media_publish"), 1);
  });

  test("a mesma referência em OUTRO perfil é outro post (pode publicar nos dois)", async () => {
    const segundo = await seedAccount(db, { username: "segundo", userId: "9002", isDefault: false });
    await enviar("reel-g");
    await enviar("reel-g", { accountId: segundo });
    await rodarRelogio();
    assert.equal(meta.count("/media_publish"), 2);
  });
});

describe("migração 0015", { skip: semBanco }, () => {
  let db: TestDatabase;
  const sql0015 = readFileSync("supabase/migrations/0015_seguranca.sql", "utf8");

  before(async () => {
    db = await createTestDatabase({ ate: "0014" });
  });
  after(async () => db?.close());

  test("traz para o registro os posts do Molde que já saíram (ou já foram pedidos) e pode ser colada de novo", async () => {
    const conta = await seedAccount(db);
    await insertPost(db, conta, { status: "published", source: "molde", external_ref: "antigo-1", published_media_id: "m-9", permalink: "https://www.instagram.com/reel/x/" });
    await insertPost(db, conta, { status: "failed", source: "molde", external_ref: "antigo-2", publish_requested_at: new Date() });
    await insertPost(db, conta, { status: "scheduled", source: "molde", external_ref: "nunca-saiu" });
    await db.sql(sql0015);
    await db.sql(sql0015);
    const linhas = await db.sql<{ external_ref: string; estado: string; media_id: string | null }>("select external_ref, estado, media_id from public.content_refs_publicadas order by external_ref");
    assert.deepEqual(linhas, [
      { external_ref: "antigo-1", estado: "publicado", media_id: "m-9" },
      { external_ref: "antigo-2", estado: "pedido", media_id: null },
    ]);
    const [rls] = await db.sql<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.content_refs_publicadas'::regclass");
    assert.equal(rls.relrowsecurity, true);
  });

  test("no Supabase (papéis anon e authenticated), tira deles a leitura das tabelas do UaiFlow", async () => {
    for (const papel of ["anon", "authenticated"]) {
      await db.sql(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${papel}') then create role ${papel} nologin; end if; end $$;`);
    }
    await db.sql("grant select on public.instagram_accounts to anon, authenticated");
    await db.sql("create table if not exists public.schema_migrations (version text primary key)");
    await db.sql(sql0015);
    const [privilegio] = await db.sql<{ anon: boolean; auth: boolean }>(
      "select has_table_privilege('anon', 'public.instagram_accounts', 'select') as anon, has_table_privilege('authenticated', 'public.instagram_accounts', 'select') as auth",
    );
    assert.deepEqual(privilegio, { anon: false, auth: false });
    const [rls] = await db.sql<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.schema_migrations'::regclass");
    assert.equal(rls.relrowsecurity, true);
  });
});
