import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Limite de publicações: a Meta aceita 100 posts por perfil em 24 h; o UaiFlow segura em 95.
 * Passou disso, o post continua agendado para o horário em que a vaga abre, com uma nota. Nunca "Com erro".
 */
const meta = installFakeMeta();
const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const nota = (data: Date) => `Limite de 100 publicações em 24 h do Instagram: sai às ${hora.format(data)}.`;

describe("limite de 95 publicações em 24 h por perfil", { skip: semBanco }, () => {
  let db: TestDatabase;
  let accountId: string;
  let scheduler: typeof import("@/lib/content/scheduler");
  let planner: typeof import("@/lib/db/content-planner");
  let contentRoute: typeof import("@/app/api/content/route");

  before(async () => {
    db = await createTestDatabase();
    scheduler = await import("@/lib/content/scheduler");
    planner = await import("@/lib/db/content-planner");
    contentRoute = await import("@/app/api/content/route");
  });

  beforeEach(async () => {
    meta.reset();
    await db.sql("delete from public.content_posts");
    await db.sql("delete from public.automations");
    await db.sql("delete from public.instagram_accounts");
    accountId = await seedAccount(db);
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  /** `quantos` posts publicados do perfil; o mais antigo saiu há `horasAtras` h e os outros 1 min depois um do outro. */
  async function publicados(conta: string, quantos: number, horasAtras: number, prefixo = "p") {
    await db.sql(
      `insert into public.content_posts (account_id, publish_type, caption, media_url, status, published_at, published_media_id, insights_at)
       select $1, 'reel_video', $4 || g, 'https://midia.teste.invalid/uaiflow/velho.mp4', 'published',
              now() - make_interval(hours => $2::int) + make_interval(mins => g::int), $4 || 'media-' || g, now()
       from generate_series(1, $3::int) g`,
      [conta, horasAtras, quantos, prefixo],
    );
  }

  async function maisAntigoMais24h(conta: string) {
    const [linha] = await db.sql<{ vaga: Date }>(
      "select min(published_at) + interval '24 hours 1 minute' as vaga from public.content_posts where account_id = $1 and status = 'published' and published_at > now() - interval '24 hours'",
      [conta],
    );
    return linha.vaga;
  }

  const chamadasMeta = () => meta.calls.filter((chamada) => chamada.host.endsWith("instagram.com") || chamada.host.endsWith("facebook.com"));

  test("publishedLast24h conta os publicados da janela e os em publicação, e ignora os de fora e os de outro perfil", async () => {
    const outra = await seedAccount(db, { username: "conta_b", userId: "17840000000000020", token: "IGAA-TESTE-CONTA-B", isDefault: false });
    await publicados(accountId, 7, 20);
    await publicados(accountId, 3, 30, "fora");
    await publicados(outra, 4, 10, "outra");
    await insertPost(db, accountId, { status: "publishing", container_id: "container-x" });
    const proprio = await insertPost(db, accountId, { status: "publishing" });
    assert.equal(await planner.publishedLast24h(accountId), 9);
    assert.equal(await planner.publishedLast24h(accountId, proprio), 8, "o próprio post não entra na conta");
    assert.equal(await planner.publishedLast24h(outra), 4);
  });

  test("95 publicados na janela: o próximo fica agendado com o horário e a nota, e a Meta nem é chamada", async () => {
    await publicados(accountId, 95, 20);
    const id = await insertPost(db, accountId);
    const vaga = await maisAntigoMais24h(accountId);
    const resultado = await scheduler.runContentCycle(8000);

    const post = await readPost(db, id);
    assert.equal(post.status, "scheduled");
    assert.ok(Math.abs(new Date(post.scheduled_at as string).getTime() - vaga.getTime()) < 2000, `scheduled_at ${String(post.scheduled_at)} ≠ ${vaga.toISOString()}`);
    assert.equal(post.last_error, nota(vaga));
    assert.equal(post.attempts, 0, "adiar não gasta tentativa");
    assert.equal(post.container_id, null);
    assert.equal(chamadasMeta().length, 0, "0 chamadas à Meta");
    assert.equal(resultado.failed, 0);
    assert.equal(resultado.started, 0, "adiado não conta como iniciado");
  });

  test("a nota usa o horário de São Paulo (HH:MM)", async () => {
    await publicados(accountId, 95, 20);
    const id = await insertPost(db, accountId);
    await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.match(String(post.last_error), /^Limite de 100 publicações em 24 h do Instagram: sai às \d{2}:\d{2}\.$/);
    assert.equal(post.last_error, nota(new Date(post.scheduled_at as string)));
  });

  test("com os mais velhos fora da janela, o post sai (só conta quem foi publicado nas últimas 24 h)", async () => {
    await publicados(accountId, 90, 20);
    await publicados(accountId, 10, 26, "fora");
    const id = await insertPost(db, accountId);
    for (let i = 0; i < 3; i += 1) await scheduler.runContentCycle(8000);
    const post = await readPost(db, id);
    assert.equal(post.status, "published", String(post.last_error));
    assert.equal(meta.count("/media_publish"), 1);
  });

  test("94 na janela: ainda cabe o 95º; só um de dois posts vencidos sai e o outro espera", async () => {
    await publicados(accountId, 94, 20);
    const a = await insertPost(db, accountId, { caption: "A" });
    const b = await insertPost(db, accountId, { caption: "B", scheduled_at: new Date(Date.now() - 30_000) });
    for (let i = 0; i < 4; i += 1) await scheduler.runContentCycle(8000);
    const posts = [await readPost(db, a), await readPost(db, b)];
    assert.deepEqual(posts.map((post) => post.status).sort(), ["published", "scheduled"]);
    assert.equal(meta.count("/media_publish"), 1);
    const esperando = posts.find((post) => post.status === "scheduled");
    assert.match(String(esperando?.last_error), /^Limite de 100 publicações/);
    assert.ok(new Date(esperando?.scheduled_at as string).getTime() > Date.now() + 3 * 3600_000);
  });

  test("os em publicação contam: 94 publicados + 1 publicando = 95, o novo espera e o que estava publicando termina", async () => {
    await publicados(accountId, 94, 20);
    const emAndamento = await insertPost(db, accountId, { caption: "Em andamento", status: "publishing", container_id: "container-andamento", publishing_started_at: new Date(Date.now() - 60_000), scheduled_at: new Date(Date.now() - 120_000) });
    const novo = await insertPost(db, accountId, { caption: "Novo" });
    for (let i = 0; i < 3; i += 1) await scheduler.runContentCycle(8000);
    assert.equal((await readPost(db, emAndamento)).status, "published");
    const espera = await readPost(db, novo);
    assert.equal(espera.status, "scheduled");
    assert.match(String(espera.last_error), /^Limite de 100 publicações/);
    assert.equal(meta.count("/media_publish"), 1);
  });

  test("carrossel conta 1: 93 publicados + um carrossel de 5 fotos = 94 e o novo sai; com 94 + carrossel = 95 e o novo espera", async () => {
    const itens = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ type: "image", url: `https://midia.teste.invalid/uaiflow/${i}.jpg`, status: "finished", container_id: `filho-${i}` })));
    await publicados(accountId, 93, 20);
    await insertPost(db, accountId, { publish_type: "carousel", status: "published", published_at: new Date(Date.now() - 10 * 3600_000), published_media_id: "media-carrossel", media_items: itens, first_comment: "", keyword: "" });
    const cabe = await insertPost(db, accountId, { caption: "Cabe" });
    await scheduler.runContentCycle(8000);
    await scheduler.runContentCycle(8000);
    assert.equal((await readPost(db, cabe)).status, "published");

    // agora são 95 na janela (93 + carrossel + o que acabou de sair): o próximo espera
    const espera = await insertPost(db, accountId, { caption: "Espera" });
    await scheduler.runContentCycle(8000);
    const post = await readPost(db, espera);
    assert.equal(post.status, "scheduled");
    assert.match(String(post.last_error), /^Limite de 100 publicações/);
  });

  test("3 ciclos seguidos com o perfil parado no limite: nunca 'Com erro', sem tentativa gasta e sem chamar a Meta", async () => {
    await publicados(accountId, 95, 20);
    const id = await insertPost(db, accountId);
    for (let rodada = 0; rodada < 3; rodada += 1) {
      const resultado = await scheduler.runContentCycle(8000);
      const post = await readPost(db, id);
      assert.equal(post.status, "scheduled", `rodada ${rodada + 1}`);
      assert.equal(post.attempts, 0);
      assert.equal(resultado.failed, 0);
      assert.equal(chamadasMeta().length, 0);
      await db.sql("update public.content_posts set scheduled_at = now() - interval '1 second' where id = $1", [id]); // chegou a hora de novo, e a vaga continua fechada
    }
    assert.equal(meta.telegram.length, 0, "nenhum aviso de 'Com erro'");
  });

  test("dois perfis são independentes: o cheio espera, o outro publica", async () => {
    const outra = await seedAccount(db, { username: "conta_b", userId: "17840000000000020", token: "IGAA-TESTE-CONTA-B", isDefault: false });
    await publicados(accountId, 95, 20);
    await publicados(outra, 3, 20, "b");
    const cheio = await insertPost(db, accountId, { caption: "Do perfil cheio" });
    const livre = await insertPost(db, outra, { caption: "Do outro perfil" });
    for (let i = 0; i < 3; i += 1) await scheduler.runContentCycle(8000);
    assert.equal((await readPost(db, cheio)).status, "scheduled");
    assert.equal((await readPost(db, livre)).status, "published");
    assert.equal(meta.count("/media_publish"), 1);
  });

  test("'Publicar agora' com o perfil no limite: não começa, fica agendado com a nota e a Meta não é chamada", async () => {
    await publicados(accountId, 95, 20);
    const vaga = await maisAntigoMais24h(accountId);
    const response = await contentRoute.POST(request("/api/content", {
      json: { accountId, publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/novo.mp4", caption: "Agora", publishNow: true },
    }));
    const body = await response.json();
    assert.equal(body.data.status, "scheduled");
    assert.equal(body.data.last_error, nota(vaga));
    assert.equal(chamadasMeta().length, 0);
    assert.notEqual(response.status, 502);
  });

  test("'Publicar agora' com vaga: segue como sempre", async () => {
    await publicados(accountId, 40, 20);
    const response = await contentRoute.POST(request("/api/content", {
      json: { accountId, publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/novo.mp4", caption: "Agora", publishNow: true },
    }));
    assert.equal((await response.json()).data.status, "publishing");
    assert.equal(meta.count("/media"), 1);
  });
});
