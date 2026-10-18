import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Outras redes (0010): o mesmo Reel na Página do Facebook, no Threads e no YouTube Shorts. Montagem dos pedidos,
 * conexões (state no cookie), publicação por passos no relógio, uma rede com erro não segura as outras, e o campo
 * `redes` da API do Molde.
 */
process.env.YOUTUBE_CHUNK_MB = "0.25"; // pedaços de 256 KiB: o vídeo falso (600 KiB) vai em 3 pedaços
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const redesLib = await import("@/lib/redes/redes");
const fb = await import("@/lib/redes/facebook-reels");
const threads = await import("@/lib/redes/threads");
const youtube = await import("@/lib/redes/youtube");
const publisher = await import("@/lib/redes/publisher");
const pkg = await import("@/lib/content/package");
const netState = await import("@/lib/oauth/network-state");
const moldePosts = await import("@/app/api/molde/posts/route");
const moldePost = await import("@/app/api/molde/posts/[id]/route");
const moldeAccounts = await import("@/app/api/molde/accounts/route");
const thLogin = await import("@/app/api/oauth/threads/login/route");
const thCallback = await import("@/app/api/oauth/threads/callback/route");
const ytLogin = await import("@/app/api/oauth/youtube/login/route");
const ytCallback = await import("@/app/api/oauth/youtube/callback/route");
const tokenRefresh = await import("@/lib/instagram/token-refresh");
const auth = await import("@/lib/auth");
const ADMIN = { [auth.getAdminCookieName()]: (await auth.createAdminSessionValue()) as string };
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const VIDEO = "https://midia.teste.invalid/uaiflow/reel.mp4";
const TOKENS = /TH-TESTE|YT-TESTE|ya29\.|FB-TESTE|IGAA-TESTE/;

after(async () => {
  meta.restore();
  await db?.close();
});

function location(response: Response) {
  const value = response.headers.get("location");
  assert.ok(value, `sem redirecionamento (status ${response.status})`);
  return new URL(value);
}

function stateCookie(response: Response, name: string) {
  const raw = response.headers.get("set-cookie") ?? "";
  const match = raw.match(new RegExp(`${name}=([^;]*)`));
  assert.ok(match?.[1], "a rota de login grava o cookie do state");
  assert.match(raw, /HttpOnly/i);
  return match[1];
}

describe("montagem dos pedidos (sem banco)", () => {
  test("Reel da Página: start, upload pelo link e finish com descrição", () => {
    assert.deepEqual(fb.buildFbReelStartBody(), { upload_phase: "start" });
    assert.deepEqual(fb.buildFbReelUploadHeaders("PAGE", VIDEO), { Authorization: "OAuth PAGE", file_url: VIDEO });
    assert.deepEqual(fb.buildFbReelFinishBody({ videoId: "v1", description: "  Legenda #tag  ", title: "" }), { upload_phase: "finish", video_id: "v1", video_state: "PUBLISHED", description: "Legenda #tag" });
    assert.ok(!("description" in fb.buildFbReelFinishBody({ videoId: "v1", description: "" })));
    assert.equal(fb.readFbReelStatus({ processing_phase: { status: "error", errors: [{ message: "ruim" }] } }).state, "error");
    assert.equal(fb.readFbReelStatus({ uploading_phase: { status: "complete" } }).state, "uploaded");
    assert.equal(fb.readFbReelStatus({ publishing_phase: { status: "complete" } }).state, "published");
    assert.equal(fb.readFbReelStatus(undefined).state, "waiting");
  });

  test("Threads: container de vídeo com texto cortado em 500 (emoji conta pelos bytes)", () => {
    assert.deepEqual(threads.buildThreadsVideoContainerParams({ videoUrl: VIDEO, text: "Oi" }), { media_type: "VIDEO", video_url: VIDEO, text: "Oi" });
    assert.ok(!("text" in threads.buildThreadsVideoContainerParams({ videoUrl: VIDEO, text: "  " })));
    const longo = threads.threadsText("a".repeat(600));
    assert.equal(Array.from(longo).length, 500);
    assert.ok(longo.endsWith("…"));
    const emojis = threads.threadsText("😀".repeat(200)); // 4 bytes cada
    assert.ok(Array.from(emojis).length <= 125);
    assert.equal(threads.threadsText("x".repeat(500)), "x".repeat(500));
    const url = threads.threadsAuthorizeUrl({ appId: "1", redirectUri: "https://uaiflow.teste/api/oauth/threads/callback", state: "s" });
    assert.equal(url.searchParams.get("scope"), "threads_basic,threads_content_publish");
    assert.equal(url.searchParams.get("response_type"), "code");
  });

  test("YouTube: título até 100, sem < >, #Shorts na descrição, feito para crianças = não, privacidade escolhida", () => {
    assert.equal(youtube.youtubeTitle({ title: "", caption: "Primeira <linha>\nsegunda" }), "Primeira linha");
    assert.equal(Array.from(youtube.youtubeTitle({ caption: "x".repeat(300) })).length, 100);
    assert.equal(youtube.youtubeTitle({ youtubeTitulo: "Título YT", title: "Título post" }), "Título YT");
    assert.equal(youtube.youtubeTitle({}), "Short");
    assert.equal(youtube.youtubeDescription("Legenda"), "Legenda\n\n#Shorts");
    assert.equal(youtube.youtubeDescription("Já tem #shorts"), "Já tem #shorts");
    assert.ok(Buffer.byteLength(youtube.youtubeDescription("é".repeat(4000)), "utf8") <= 5000);
    assert.deepEqual(youtube.buildYoutubeVideoResource({ title: "T", description: "D", privacy: "unlisted" }), {
      snippet: { title: "T", description: "D", categoryId: "22" },
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    });
    assert.equal(youtube.youtubeChunkBytes() % youtube.YOUTUBE_CHUNK_UNIT, 0);
    const url = youtube.youtubeAuthorizeUrl({ clientId: "c", redirectUri: "https://uaiflow.teste/api/oauth/youtube/callback", state: "s" });
    assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/youtube.upload");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
  });

  test("campo redes: lista válida (Instagram sempre na frente), desconhecida recusada, só Reel", () => {
    assert.deepEqual(redesLib.parseRedes(["threads", "youtube", "threads"]), { redes: ["instagram", "threads", "youtube"], instagramIncluido: true });
    assert.deepEqual(redesLib.parseRedes(["instagram", "facebook"]), { redes: ["instagram", "facebook"], instagramIncluido: false });
    assert.equal(redesLib.parseRedes(undefined), undefined);
    for (const ruim of ["threads", ["tiktok"], [1], {}, null]) assert.equal(redesLib.parseRedes(ruim), "invalid", JSON.stringify(ruim));
    const base = { publishType: "reel_video", mediaUrl: VIDEO };
    const ok = pkg.parsePostPackage({ ...base, redes: ["youtube"], youtubePrivacidade: "private" });
    assert.ok(ok.ok);
    assert.deepEqual(ok.value.redes, ["instagram", "youtube"]);
    assert.equal(ok.value.youtubePrivacidade, "private");
    assert.deepEqual(ok.avisos, [pkg.REDES_INSTAGRAM_INCLUIDO]);
    assert.deepEqual(pkg.parsePostPackage({ ...base, redes: ["tiktok"] }), { ok: false, error: redesLib.REDES_INVALIDAS });
    assert.deepEqual(pkg.parsePostPackage({ publishType: "feed_image", mediaUrl: VIDEO, redes: ["threads"] }), { ok: false, error: redesLib.REDES_SO_REEL });
    assert.ok(pkg.parsePostPackage({ publishType: "feed_image", mediaUrl: VIDEO, redes: ["instagram"] }).ok);
    assert.deepEqual(pkg.parsePostPackage({ ...base, youtubePrivacidade: "secreto" }), { ok: false, error: pkg.YOUTUBE_PRIVACIDADE_INVALIDA });
  });

  test("erro de rede sem pedaço de token", () => {
    const message = publisher.safeRedeError("threads", new Error("Instagram Graph v25.0: falhou access_token=TH-TESTE-SEGREDO-123 token THAAbbbbbbbbbbbbbbbbbbbbbbbbb"));
    assert.doesNotMatch(message, /TH-TESTE-SEGREDO|THAAbbbb/);
    assert.match(message, /^Threads: falhou/);
  });
});

describe("rotas e proxy (sem banco)", () => {
  beforeEach(() => meta.reset());

  test("Molde: redes desconhecidas ou fora de lista → 400 (antes de gravar)", async () => {
    for (const redes of [["tiktok"], "threads", [{}]]) {
      const response = await moldePosts.POST(request("/api/molde/posts", { headers: MOLDE, json: { publishType: "reel_video", mediaUrl: VIDEO, externalRef: "x", redes } }));
      assert.equal(response.status, 400, JSON.stringify(redes));
      assert.deepEqual(await response.json(), { error: redesLib.REDES_INVALIDAS });
    }
    const story = await moldePosts.POST(request("/api/molde/posts", { headers: MOLDE, json: { publishType: "story_video", mediaUrl: VIDEO, externalRef: "x", redes: ["youtube"] } }));
    assert.equal(story.status, 400);
    const semToken = await moldePosts.POST(request("/api/molde/posts", { json: { publishType: "reel_video", mediaUrl: VIDEO, redes: ["threads"] } }));
    assert.equal(semToken.status, 401);
  });

  test("conexão do Threads e do YouTube sem sessão → /login; volta com state errado não troca o código", async () => {
    for (const route of [thLogin, ytLogin]) assert.equal(location(await route.GET(request("/api/oauth/threads/login?conta=x"))).pathname, "/login");
    for (const [route, config, param] of [[thCallback, netState.THREADS_STATE, "threads_error"], [ytCallback, netState.YOUTUBE_STATE, "youtube_error"]] as const) {
      const sem = location(await route.GET(request("/api/oauth/x/callback?code=abc&state=xyz")));
      assert.equal(sem.pathname, "/login");
      const state = netState.createNetworkState("00000000-0000-0000-0000-000000000000", "/perfis");
      const response = await route.GET(request("/api/oauth/x/callback?code=abc&state=outro", { cookies: { ...ADMIN, [config.cookie]: netState.encodeNetworkState(state) } }));
      const destino = location(response);
      assert.equal(destino.pathname, "/perfis");
      assert.match(destino.searchParams.get(param) ?? "", /venceu ou não é válido/);
      assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${config.cookie}=;`));
    }
    assert.equal(meta.calls.length, 0, "nada foi trocado com o Threads nem com o Google");
  });

  test("state: igual e no prazo passa; vencido, diferente ou sem cookie, não", () => {
    const state = netState.createNetworkState("conta-1", "/perfis?accountId=conta-1");
    const withCookie = (value: string) => request("/api/oauth/threads/callback", { cookies: { [netState.THREADS_STATE.cookie]: value } });
    assert.equal(netState.verifyNetworkState(netState.THREADS_STATE, withCookie(netState.encodeNetworkState(state)), `${state.state}#_`)?.accountId, "conta-1", "o Threads pode devolver #_ no fim");
    assert.equal(netState.verifyNetworkState(netState.THREADS_STATE, withCookie(netState.encodeNetworkState(state)), "outro"), null);
    assert.equal(netState.verifyNetworkState(netState.YOUTUBE_STATE, withCookie(netState.encodeNetworkState(state)), state.state), null, "cookie do Threads não vale para o YouTube");
    const vencido = netState.createNetworkState("conta-1", "/perfis", Date.now() - 11 * 60_000);
    assert.equal(netState.verifyNetworkState(netState.THREADS_STATE, withCookie(netState.encodeNetworkState(vencido)), vencido.state), null);
  });

  test("o proxy protege as rotas novas de conexão e deixa os webhooks de venda públicos", async () => {
    const { proxy } = await import("@/proxy");
    for (const path of ["/api/oauth/threads/login?conta=x", "/api/oauth/threads/callback", "/api/oauth/youtube/login", "/api/oauth/youtube/callback"]) {
      const response = await proxy(request(path));
      assert.equal(response.status, 401, path);
    }
    for (const path of ["/api/webhooks/stripe", "/api/webhooks/whop", "/api/webhooks/gumroad", "/api/webhooks/payhip", "/api/webhooks/cakto"]) {
      const response = await proxy(request(path, { method: "POST" }));
      assert.equal(response.headers.get("x-middleware-next"), "1", path);
    }
  });
});

describe("com banco: conectar, publicar nas redes e isolar erros", { skip: semBanco }, () => {
  let accountId: string;

  before(async () => {
    accountId = await seedAccount(db!, { isDefault: true });
  });

  beforeEach(async () => {
    meta.reset();
    await db!.sql("delete from public.content_posts");
    await db!.sql("delete from public.instagram_facebook_connections");
    await db!.sql("delete from public.threads_connections");
    await db!.sql("delete from public.youtube_connections");
  });

  async function connectAll(options: { fbScopes?: string[] | null } = {}) {
    await db!.sql(
      `insert into public.instagram_facebook_connections (account_id, instagram_user_id, page_id, page_name, user_access_token, user_token_expires_at, page_access_token, granted_scopes)
       values ($1, '17840000000000010', 'page-1', 'Página', 'FB-TESTE-USUARIO', now() + interval '50 days', 'FB-TESTE-PAGINA', $2)`,
      [accountId, options.fbScopes === undefined ? ["pages_show_list", "pages_read_engagement", "pages_manage_posts"] : options.fbScopes],
    );
    await db!.sql(
      `insert into public.threads_connections (account_id, threads_user_id, threads_username, access_token, token_expires_at, last_token_refresh_at)
       values ($1, '7001', 'threads_teste', 'TH-TESTE-TOKEN', now() + interval '50 days', now() - interval '2 days')`,
      [accountId],
    );
    await db!.sql(
      `insert into public.youtube_connections (account_id, refresh_token, access_token, access_token_expires_at)
       values ($1, 'YT-TESTE-REFRESH', null, null)`,
      [accountId],
    );
  }

  async function postWithRedes(fields: Record<string, unknown> = {}, redes = ["instagram", "facebook", "threads", "youtube"]) {
    const id = await insertPost(db!, accountId, { status: "published", published_at: new Date(), permalink: "https://www.instagram.com/reel/x/", redes, media_url: VIDEO, ...fields });
    for (const rede of redes.filter((item) => item !== "instagram")) await db!.sql("insert into public.content_post_redes (post_id, rede) values ($1, $2)", [id, rede]);
    return id;
  }

  async function rows(id: string) {
    return db!.sql<{ rede: string; status: string; external_id: string | null; permalink: string | null; last_error: string | null; attempts: number }>(
      "select rede, status, external_id, permalink, last_error, attempts from public.content_post_redes where post_id = $1 order by rede", [id],
    );
  }

  /** Roda o relógio das redes até nada mais andar (cada volta "vence" a espera, como os minutos do cron). */
  async function runUntilDone(id: string, voltas = 12) {
    for (let index = 0; index < voltas; index += 1) {
      await db!.sql("update public.content_post_redes set next_attempt_at = now() - interval '1 second', lock_until = null where post_id = $1", [id]);
      await publisher.runRedesCycle(Date.now() + 20_000);
      const current = await rows(id);
      if (current.every((row) => row.status === "published" || row.status === "failed")) return current;
    }
    return rows(id);
  }

  test("a 0010 cria as tabelas com RLS, a coluna redes (padrão só Instagram) e a privacidade do YouTube", async () => {
    const tabelas = await db!.sql<{ relname: string; rls: boolean }>(
      "select relname, relrowsecurity as rls from pg_class where relname in ('content_post_redes','threads_connections','youtube_connections','vendas') order by relname",
    );
    assert.deepEqual(tabelas.map((tabela) => [tabela.relname, tabela.rls]), [["content_post_redes", true], ["threads_connections", true], ["vendas", true], ["youtube_connections", true]]);
    const id = await insertPost(db!, accountId);
    const post = await readPost(db!, id);
    assert.deepEqual(post.redes, ["instagram"]);
    assert.equal(post.youtube_privacidade, "public");
    await assert.rejects(db!.sql("update public.content_posts set youtube_privacidade = 'secreto' where id = $1", [id]), /check/i);
  });

  test("publica nas três redes depois do Instagram: Página (start → link → finish), Threads e YouTube em pedaços", async () => {
    await connectAll();
    const id = await postWithRedes({ title: "Meu Reel", caption: "Legenda <boa>\nlinha 2", youtube_privacidade: "unlisted" });
    const result = await runUntilDone(id);
    assert.deepEqual(result.map((row) => [row.rede, row.status]), [["facebook", "published"], ["threads", "published"], ["youtube", "published"]], JSON.stringify(result));

    const fbRow = result.find((row) => row.rede === "facebook")!;
    assert.match(fbRow.external_id ?? "", /^fbvideo-/);
    assert.equal(fbRow.permalink, `https://www.facebook.com/reel/${fbRow.external_id}`);
    const upload = meta.calls.find((call) => call.host === "rupload.facebook.com");
    assert.equal(upload?.headers.get("file_url"), VIDEO);
    assert.equal(upload?.headers.get("authorization"), "OAuth FB-TESTE-PAGINA");
    const finish = meta.calls.find((call) => call.path.endsWith("/video_reels") && call.body.upload_phase === "finish");
    assert.equal(finish?.body.video_state, "PUBLISHED");
    assert.equal(finish?.body.description, "Legenda <boa>\nlinha 2");

    const thRow = result.find((row) => row.rede === "threads")!;
    assert.match(thRow.external_id ?? "", /^thmedia-/);
    assert.match(thRow.permalink ?? "", /threads\.net/);
    const container = meta.calls.find((call) => call.host === "graph.threads.net" && call.path.endsWith("/threads"));
    assert.equal(container?.search.get("media_type"), "VIDEO");
    assert.equal(container?.search.get("video_url"), VIDEO);

    const ytRow = result.find((row) => row.rede === "youtube")!;
    assert.match(ytRow.external_id ?? "", /^yt-video-/);
    assert.equal(ytRow.permalink, `https://www.youtube.com/shorts/${ytRow.external_id}`);
    const session = [...meta.youtubeSessions.values()][0];
    assert.equal(session.received, meta.mediaSize);
    assert.deepEqual(session.resource, { snippet: { title: "Meu Reel", description: "Legenda boa\nlinha 2\n\n#Shorts", categoryId: "22" }, status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false } });
    const pedacos = meta.calls.filter((call) => call.host === "www.googleapis.com" && call.method === "PUT").map((call) => call.headers.get("content-range"));
    assert.deepEqual(pedacos, ["bytes 0-262143/614400", "bytes 262144-524287/614400", "bytes 524288-614399/614400"]);
    const [yt] = await db!.sql<{ access_token: string; channel_id: string }>("select access_token, channel_id from public.youtube_connections");
    assert.match(yt.access_token, /^ya29\.TESTE-/, "renovou o token curto pelo refresh token");
    assert.equal(yt.channel_id, "UC-teste");

    const post = await readPost(db!, id);
    assert.equal(post.status, "published", "o Instagram não muda");
  });

  test("uma rede com erro não segura as outras; 3 tentativas e vira 'failed'; «Tentar de novo» volta só ela", async () => {
    await connectAll();
    meta.threadsCreateError = "(#100) The video could not be fetched";
    const id = await postWithRedes();
    let result = await runUntilDone(id);
    assert.deepEqual(result.map((row) => [row.rede, row.status]), [["facebook", "published"], ["threads", "failed"], ["youtube", "published"]]);
    const th = result.find((row) => row.rede === "threads")!;
    assert.equal(th.attempts, 3);
    assert.match(th.last_error ?? "", /^Threads: \(#100\) The video could not be fetched/);
    assert.equal((await readPost(db!, id)).status, "published");

    meta.threadsCreateError = null;
    const outra = await moldePost.PATCH(request(`/api/molde/posts/${id}`, { method: "PATCH", headers: MOLDE, json: { action: "retry_rede", rede: "youtube" } }), routeParams({ id }));
    assert.equal(outra.status, 404, "post que não veio do Molde");
    await db!.sql("update public.content_posts set source = 'molde', external_ref = 'r1' where id = $1", [id]);
    const naoFalhou = await moldePost.PATCH(request(`/api/molde/posts/${id}`, { method: "PATCH", headers: MOLDE, json: { action: "retry_rede", rede: "youtube" } }), routeParams({ id }));
    assert.equal(naoFalhou.status, 409);
    const retry = await moldePost.PATCH(request(`/api/molde/posts/${id}`, { method: "PATCH", headers: MOLDE, json: { action: "retry_rede", rede: "threads" } }), routeParams({ id }));
    assert.equal(retry.status, 200);
    const body = (await retry.json()) as { data: { redesStatus: Record<string, { status: string }> } };
    assert.equal(body.data.redesStatus.threads.status, "pending");
    assert.equal(body.data.redesStatus.facebook.status, "published");
    result = await runUntilDone(id);
    assert.equal(result.find((row) => row.rede === "threads")!.status, "published");
    assert.equal(meta.calls.filter((call) => call.path.endsWith("/video_reels") && call.body.upload_phase === "finish").length, 1, "o Facebook não publicou de novo");
  });

  test("sem conexão (ou conexão pelo Facebook só da música): a rede falha na hora com a frase, as outras saem", async () => {
    await connectAll({ fbScopes: null });
    await db!.sql("delete from public.threads_connections");
    const id = await postWithRedes();
    const result = await runUntilDone(id);
    assert.equal(result.find((row) => row.rede === "facebook")!.status, "failed");
    assert.match(result.find((row) => row.rede === "facebook")!.last_error ?? "", /conecte \(ou reconecte\) esta conta pelo Facebook/);
    assert.equal(result.find((row) => row.rede === "threads")!.attempts, 1, "falta de conexão não fica tentando");
    assert.equal(result.find((row) => row.rede === "youtube")!.status, "published");
  });

  test("Instagram com erro não segura as outras; agendado, rascunho ou cancelado ainda não começa", async () => {
    await connectAll();
    const falhou = await postWithRedes({ status: "failed", published_at: null, permalink: null }, ["instagram", "threads"]);
    assert.equal((await runUntilDone(falhou))[0].status, "published");
    meta.reset();
    const agendado = await postWithRedes({ status: "scheduled", published_at: null, scheduled_at: new Date(Date.now() + 3600_000) }, ["instagram", "threads"]);
    await publisher.runRedesCycle(Date.now() + 20_000);
    assert.equal((await rows(agendado))[0].status, "pending");
    assert.equal(meta.calls.length, 0);
  });

  test("YouTube: pedaço que falha (503) pergunta à sessão e continua de onde parou; sessão vencida recomeça; vídeo grande demais falha", async () => {
    await connectAll();
    await db!.sql("delete from public.threads_connections");
    meta.youtubeChunkFails = 1;
    const id = await postWithRedes({}, ["instagram", "youtube"]);
    const result = await runUntilDone(id);
    assert.equal(result[0].status, "published", JSON.stringify(result));
    assert.equal(result[0].attempts, 1);
    assert.ok(meta.calls.some((call) => call.method === "PUT" && /^bytes \*\//.test(call.headers.get("content-range") ?? "")), "conferiu a sessão antes de seguir");

    meta.reset();
    meta.mediaSize = youtube.YOUTUBE_MAX_BYTES + 1;
    const grande = await postWithRedes({}, ["instagram", "youtube"]);
    const [row] = await runUntilDone(grande);
    assert.equal(row.status, "failed");
    assert.match(row.last_error ?? "", /passa de 512 MB/);

    meta.reset();
    meta.googleRefreshFails = true;
    await db!.sql("update public.youtube_connections set access_token = null, access_token_expires_at = null");
    const vencido = await postWithRedes({}, ["instagram", "youtube"]);
    const [semToken] = await runUntilDone(vencido);
    assert.equal(semToken.status, "failed");
    assert.match(semToken.last_error ?? "", /Reconecte o YouTube em Perfis/);
  });

  test("Molde: POST com redes salva, devolve redes + redesStatus e avisa o que não está conectado", async () => {
    await db!.sql(
      `insert into public.threads_connections (account_id, threads_user_id, access_token, token_expires_at) values ($1, '7001', 'TH-TESTE-TOKEN', now() + interval '50 days')`,
      [accountId],
    );
    const response = await moldePosts.POST(request("/api/molde/posts", {
      headers: MOLDE,
      json: { accountId, publishType: "reel_video", mediaUrl: VIDEO, externalRef: "molde-redes-1", scheduledAt: new Date(Date.now() + 3600_000).toISOString(), redes: ["threads", "youtube"], youtubePrivacidade: "private" },
    }));
    assert.equal(response.status, 201);
    const body = (await response.json()) as { data: Record<string, unknown>; warning?: string };
    assert.deepEqual(body.data.redes, ["instagram", "threads", "youtube"]);
    assert.equal(body.data.youtubePrivacidade, "private");
    assert.deepEqual(Object.keys(body.data.redesStatus as object), ["instagram", "threads", "youtube"]);
    assert.equal((body.data.redesStatus as Record<string, { status: string }>).threads.status, "pending");
    assert.match(body.warning ?? "", /O Instagram é sempre a rede principal/);
    assert.match(body.warning ?? "", /Não conectado nesta conta: YouTube Shorts\./);
    assert.doesNotMatch(body.warning ?? "", /Threads/);
    assert.equal(body.data.warning, body.warning);
    assert.doesNotMatch(JSON.stringify(body), TOKENS);
    const id = body.data.id as string;
    assert.deepEqual((await rows(id)).map((row) => [row.rede, row.status]), [["threads", "pending"], ["youtube", "pending"]]);

    // PATCH tira o YouTube (pendente sai) e o GET mostra o resultado
    const patch = await moldePost.PATCH(request(`/api/molde/posts/${id}`, { method: "PATCH", headers: MOLDE, json: { redes: ["instagram", "threads"] } }), routeParams({ id }));
    assert.equal(patch.status, 200);
    assert.deepEqual((await rows(id)).map((row) => row.rede), ["threads"]);
    const ruim = await moldePost.PATCH(request(`/api/molde/posts/${id}`, { method: "PATCH", headers: MOLDE, json: { redes: ["orkut"] } }), routeParams({ id }));
    assert.equal(ruim.status, 400);
    const lista = (await (await moldePosts.GET(request("/api/molde/posts?refs=molde-redes-1", { headers: MOLDE }))).json()) as { data: Array<Record<string, unknown>> };
    assert.deepEqual(lista.data[0].redes, ["instagram", "threads"]);

    // post sem o campo: só Instagram, sem aviso de redes
    const simples = await moldePosts.POST(request("/api/molde/posts", { headers: MOLDE, json: { accountId, publishType: "reel_video", mediaUrl: VIDEO, externalRef: "molde-redes-2" } }));
    const simplesBody = (await simples.json()) as { data: Record<string, unknown>; warning?: string };
    assert.deepEqual(simplesBody.data.redes, ["instagram"]);
    assert.deepEqual(Object.keys(simplesBody.data.redesStatus as object), ["instagram"]);
    assert.equal(simplesBody.warning, undefined);
  });

  test("GET /api/molde/accounts diz quais redes cada conta tem (sem token)", async () => {
    await connectAll({ fbScopes: ["pages_show_list"] });
    const response = await moldeAccounts.GET(request("/api/molde/accounts", { headers: MOLDE }));
    const body = (await response.json()) as { data: Array<{ redes: Record<string, { conectado: boolean; motivo?: string; nome?: string | null }> }>; redesConfiguradas: Record<string, boolean> };
    const redes = body.data[0].redes;
    assert.equal(redes.instagram.conectado, true);
    assert.equal(redes.facebook.conectado, false);
    assert.match(redes.facebook.motivo ?? "", /pages_manage_posts/);
    assert.deepEqual([redes.threads.conectado, redes.threads.nome], [true, "threads_teste"]);
    assert.equal(redes.youtube.conectado, true);
    assert.deepEqual(body.redesConfiguradas, { facebook: true, threads: true, youtube: true });
    assert.doesNotMatch(JSON.stringify(body), TOKENS);
    const semToken = await moldeAccounts.GET(request("/api/molde/accounts"));
    assert.equal(semToken.status, 401);
  });

  test("conectar o Threads e o YouTube: state certo grava a conexão da conta (token longo / refresh token)", async () => {
    const inicio = await thLogin.GET(request(`/api/oauth/threads/login?conta=${accountId}&next=%2Fperfis`, { cookies: ADMIN }));
    const dialogo = location(inicio);
    assert.equal(dialogo.host, "threads.net");
    assert.equal(dialogo.searchParams.get("redirect_uri"), "https://uaiflow.teste/api/oauth/threads/callback");
    const volta = location(await thCallback.GET(request(`/api/oauth/threads/callback?code=c1&state=${encodeURIComponent(dialogo.searchParams.get("state") as string)}#_`, { cookies: { ...ADMIN, [netState.THREADS_STATE.cookie]: stateCookie(inicio, netState.THREADS_STATE.cookie) } })));
    assert.equal(volta.searchParams.get("threads_connected"), "1", volta.toString());
    const [th] = await db!.sql<{ threads_user_id: string; threads_username: string; access_token: string }>("select * from public.threads_connections");
    assert.deepEqual([th.threads_user_id, th.threads_username], ["7001", "threads_teste"]);
    assert.match(th.access_token, /^TH-TESTE-LONGO-/);

    const ytInicio = await ytLogin.GET(request(`/api/oauth/youtube/login?conta=${accountId}`, { cookies: ADMIN }));
    const ytDialogo = location(ytInicio);
    assert.equal(ytDialogo.host, "accounts.google.com");
    const ytVolta = location(await ytCallback.GET(request(`/api/oauth/youtube/callback?code=g1&state=${encodeURIComponent(ytDialogo.searchParams.get("state") as string)}`, { cookies: { ...ADMIN, [netState.YOUTUBE_STATE.cookie]: stateCookie(ytInicio, netState.YOUTUBE_STATE.cookie) } })));
    assert.equal(ytVolta.searchParams.get("youtube_connected"), "1", ytVolta.toString());
    assert.doesNotMatch(ytVolta.toString(), TOKENS);
    const [yt] = await db!.sql<{ refresh_token: string }>("select refresh_token from public.youtube_connections");
    assert.equal(yt.refresh_token, "YT-TESTE-REFRESH");
  });

  test("sem as variáveis do Threads: o botão avisa e nada é trocado", async () => {
    const saved = process.env.THREADS_APP_ID;
    delete process.env.THREADS_APP_ID;
    try {
      const destino = location(await thLogin.GET(request(`/api/oauth/threads/login?conta=${accountId}`, { cookies: ADMIN })));
      assert.match(destino.searchParams.get("threads_error") ?? "", /Falta configurar THREADS_APP_ID/);
    } finally {
      process.env.THREADS_APP_ID = saved;
    }
  });

  test("relógio de tokens renova o Threads (pula o renovado há menos de 24 h); falha de uma não para as outras", async () => {
    await connectAll();
    const results = await tokenRefresh.refreshAllThreadsTokens();
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    const [th] = await db!.sql<{ access_token: string }>("select access_token from public.threads_connections");
    assert.match(th.access_token, /^TH-TESTE-RENOVADO-/);
    const again = await tokenRefresh.refreshAllThreadsTokens();
    assert.equal(again[0].ok && again[0].skipped, true);
    await db!.sql("update public.threads_connections set last_token_refresh_at = now() - interval '2 days', token_expires_at = now() + interval '30 days'");
    meta.threadsRefreshFails.add(th.access_token);
    const falha = await tokenRefresh.refreshAllThreadsTokens();
    assert.equal(falha[0].ok, false);
    assert.doesNotMatch(JSON.stringify(falha), TOKENS);
  });
});
