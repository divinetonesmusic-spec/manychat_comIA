import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Música do Instagram nos Reels (Audio API da Meta, só no "Instagram API with Facebook Login"):
 * conexão pelo Facebook (state no cookie), busca de música, campos do post, publicação pelo graph.facebook.com
 * e o caminho antigo intacto quando o post não tem música.
 */
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const client = await import("@/lib/instagram/client");
const pkg = await import("@/lib/content/package");
const fbState = await import("@/lib/facebook/oauth-state");
const audioLib = await import("@/lib/facebook/audio");
const fbLoginRoute = await import("@/app/api/oauth/facebook/login/route");
const fbCallbackRoute = await import("@/app/api/oauth/facebook/callback/route");
const audioRoute = await import("@/app/api/instagram/audio/route");
const moldeAudioRoute = await import("@/app/api/molde/audio/route");
const auth = await import("@/lib/auth");
const ADMIN = { [auth.getAdminCookieName()]: (await auth.createAdminSessionValue()) as string };
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const IG_USER = "17840000000000010"; // o id da conta do seedAccount
const FB_TOKEN = /FB-TESTE/;

after(async () => {
  meta.restore();
  await db?.close();
});

function location(response: Response) {
  const value = response.headers.get("location");
  assert.ok(value, `sem redirecionamento (status ${response.status})`);
  return new URL(value);
}

/** Cookie do state como o navegador mandaria de volta (o valor que a rota de login gravou). */
function stateCookieFrom(response: Response) {
  const raw = response.headers.get("set-cookie") ?? "";
  const match = raw.match(new RegExp(`${fbState.FACEBOOK_STATE_COOKIE}=([^;]*)`));
  assert.ok(match?.[1], "a rota de login grava o cookie do state");
  assert.match(raw, /HttpOnly/i, "cookie do state é httpOnly");
  return match[1];
}

describe("audio_configuration no container do Reel", () => {
  beforeEach(() => meta.reset());

  test("leva id e volumes ajustados (0 a 100) e vai para o graph.facebook.com", async () => {
    await client.createInstagramMediaContainer({
      instagramUserId: IG_USER,
      accessToken: "FB-TESTE-TOKEN",
      publishType: "reel_video",
      mediaUrl: "https://midia.teste.invalid/uaiflow/reel.mp4",
      caption: "x",
      audio: { audioId: "123456", audioVolume: 150, videoVolume: -7 },
      graphBaseUrl: "https://graph.facebook.com/v25.0",
    });
    const call = meta.calls.find((item) => item.path.endsWith("/media") && item.method === "POST");
    assert.ok(call);
    assert.equal(call.host, "graph.facebook.com");
    assert.equal(call.auth, "Bearer FB-TESTE-TOKEN");
    assert.deepEqual(JSON.parse(String(call.body.audio_configuration)), { audio_id: "123456", audio_volume: 100, video_volume: 0, should_loop_audio: false });
    assert.equal(call.body.media_type, "REELS");
  });

  test("sem volumes: padrão música 20 e voz 100; valor quebrado vira o padrão", () => {
    assert.deepEqual(client.buildAudioConfiguration({ audioId: "9" }), { audio_id: "9", audio_volume: 20, video_volume: 100, should_loop_audio: false });
    assert.deepEqual(client.buildAudioConfiguration({ audioId: "9", audioVolume: Number.NaN, videoVolume: 42.6 }).audio_volume, 20);
    assert.equal(client.buildAudioConfiguration({ audioId: "9", videoVolume: 42.6 }).video_volume, 43);
  });

  test("sem música: o corpo e o endereço de sempre (graph.instagram.com, sem audio_configuration)", async () => {
    await client.createInstagramMediaContainer({ instagramUserId: IG_USER, accessToken: "IGAA-TESTE", publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/reel.mp4", caption: "x" });
    const call = meta.calls.find((item) => item.path.endsWith("/media") && item.method === "POST");
    assert.ok(call);
    assert.equal(call.host, "graph.instagram.com");
    assert.ok(!("audio_configuration" in call.body));
  });

  test("música só no Reel: story com audio não leva audio_configuration", async () => {
    await client.createInstagramMediaContainer({ instagramUserId: IG_USER, accessToken: "IGAA-TESTE", publishType: "story_video", mediaUrl: "https://midia.teste.invalid/uaiflow/s.mp4", audio: { audioId: "1" } });
    const call = meta.calls.find((item) => item.path.endsWith("/media") && item.method === "POST");
    assert.ok(call && !("audio_configuration" in call.body));
  });
});

describe("campo musica do pacote (tela e Molde)", () => {
  const base = { publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/reel.mp4" };

  test("válido: volumes ajustados para 0–100 e padrões 20/100", () => {
    const parsed = pkg.parsePostPackage({ ...base, musica: { audioId: "555", titulo: "Lua · Artista", volumeMusica: 300, volumeVideo: -1 } });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.music, { audioId: "555", titulo: "Lua · Artista", volumeMusica: 100, volumeVideo: 0 });
    const padrao = pkg.parsePostPackage({ ...base, musica: { audioId: 555 } });
    assert.ok(padrao.ok);
    assert.deepEqual(padrao.value.music, { audioId: "555", titulo: null, volumeMusica: 20, volumeVideo: 100 });
  });

  test("null tira; ausente não mexe (na edição parcial some do pacote)", () => {
    const tira = pkg.parsePostPackage({ musica: null }, { partial: true });
    assert.ok(tira.ok);
    assert.equal(tira.value.music, null);
    const ausente = pkg.parsePostPackage({ caption: "x" }, { partial: true });
    assert.ok(ausente.ok);
    assert.ok(!("music" in ausente.value));
  });

  test("formato errado é recusado com frase em português", () => {
    for (const musica of ["123", [], {}, { audioId: "" }, { audioId: "a b" }, { audioId: "1", volumeMusica: "alto" }, { audioId: "1", volumeVideo: true }]) {
      const parsed = pkg.parsePostPackage({ ...base, musica });
      assert.equal(parsed.ok, false, JSON.stringify(musica));
      if (!parsed.ok) assert.equal(parsed.error, pkg.MUSIC_INVALID);
    }
  });

  test("só Reel: carrossel, foto ou story com música é recusado", () => {
    const parsed = pkg.parsePostPackage({ publishType: "story_video", mediaUrl: base.mediaUrl, musica: { audioId: "1" } });
    assert.deepEqual(parsed, { ok: false, error: "Música do Instagram só vale para Reel." });
    assert.ok(pkg.parsePostPackage({ publishType: "feed_video", mediaUrl: base.mediaUrl, musica: { audioId: "1" } }).ok, "vídeo no feed sai como Reel");
  });
});

describe("state do Login do Facebook (cookie httpOnly)", () => {
  function withCookie(value: string) {
    return request("/api/oauth/facebook/callback", { cookies: { [fbState.FACEBOOK_STATE_COOKIE]: value } });
  }
  function cookieValue(state: ReturnType<typeof fbState.createFacebookState>) {
    return Buffer.from(JSON.stringify({ s: state.state, a: state.accountId, n: state.next, e: state.expiresAt })).toString("base64url");
  }

  test("igual ao do cookie e no prazo: aceito, com a conta e o caminho de volta", () => {
    const state = fbState.createFacebookState("conta-1", "/perfis?accountId=conta-1");
    const ok = fbState.verifyFacebookState(withCookie(cookieValue(state)), state.state);
    assert.equal(ok?.accountId, "conta-1");
    assert.equal(ok?.next, "/perfis?accountId=conta-1");
  });

  test("diferente, sem cookie, vencido ou lixo: recusado", () => {
    const state = fbState.createFacebookState("conta-1", "/perfis");
    assert.equal(fbState.verifyFacebookState(withCookie(cookieValue(state)), `${state.state.slice(0, -2)}xx`), null);
    assert.equal(fbState.verifyFacebookState(withCookie(cookieValue(state)), null), null);
    assert.equal(fbState.verifyFacebookState(request("/api/oauth/facebook/callback"), state.state), null);
    const vencido = fbState.createFacebookState("conta-1", "/perfis", Date.now() - 11 * 60_000);
    assert.equal(fbState.verifyFacebookState(withCookie(cookieValue(vencido)), vencido.state), null);
    assert.equal(fbState.verifyFacebookState(withCookie("lixo"), "lixo"), null);
  });

  test("dois states seguidos são diferentes; caminho de fora vira /perfis", () => {
    assert.notEqual(fbState.createFacebookState("a", "/perfis").state, fbState.createFacebookState("a", "/perfis").state);
    assert.equal(fbState.createFacebookState("a", "//evil.example").next, "/perfis");
  });
});

describe("rotas protegidas (sem banco)", () => {
  beforeEach(() => meta.reset());

  test("busca de música da tela exige a sessão do UaiFlow", async () => {
    const response = await audioRoute.GET(request("/api/instagram/audio?conta=x&q=lua"));
    assert.equal(response.status, 401);
    assert.equal(meta.calls.length, 0);
  });

  test("busca de música do Molde exige o x-molde-token", async () => {
    const sem = await moldeAudioRoute.GET(request("/api/molde/audio?conta=x"));
    assert.equal(sem.status, 401);
    const errado = await moldeAudioRoute.GET(request("/api/molde/audio?conta=x", { headers: { "x-molde-token": "errado-errado-errado-errado" } }));
    assert.equal(errado.status, 401);
    assert.equal(meta.calls.length, 0);
  });

  test("login e volta do Facebook sem sessão → /login (nada troca com a Meta)", async () => {
    const login = location(await fbLoginRoute.GET(request("/api/oauth/facebook/login?conta=x")));
    assert.equal(login.pathname, "/login");
    const volta = location(await fbCallbackRoute.GET(request("/api/oauth/facebook/callback?code=abc&state=xyz")));
    assert.equal(volta.pathname, "/login");
    assert.equal(meta.calls.length, 0);
  });

  test("volta com sessão mas state errado (ou sem o cookie): recusa e não troca o código", async () => {
    const state = fbState.createFacebookState("00000000-0000-0000-0000-000000000000", "/perfis");
    const cookie = Buffer.from(JSON.stringify({ s: state.state, a: state.accountId, n: state.next, e: state.expiresAt })).toString("base64url");
    for (const cookies of [{ ...ADMIN, [fbState.FACEBOOK_STATE_COOKIE]: cookie }, ADMIN]) {
      const response = await fbCallbackRoute.GET(request("/api/oauth/facebook/callback?code=abc&state=outro-state", { cookies }));
      const destino = location(response);
      assert.equal(destino.pathname, "/perfis");
      assert.equal(destino.searchParams.get("facebook_error"), fbState.FACEBOOK_INVALID_STATE_MESSAGE);
      assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${fbState.FACEBOOK_STATE_COOKIE}=;`), "apaga o cookie do state");
    }
    assert.equal(meta.calls.length, 0, "o código nunca foi trocado");
  });

  test("o proxy não deixa as rotas novas públicas (só /api/molde, que tem o token próprio)", async () => {
    const { proxy } = await import("@/proxy");
    for (const path of ["/api/instagram/audio?conta=x", "/api/oauth/facebook/login?conta=x", "/api/oauth/facebook/callback?state=x"]) {
      const response = await proxy(request(path));
      assert.equal(response.status, 401, path);
    }
  });
});

describe("música do Instagram com banco", { skip: semBanco }, () => {
  let accountId: string;
  let otherId: string;
  let scheduler: typeof import("@/lib/content/scheduler");
  let moldeRoute: typeof import("@/app/api/molde/posts/route");
  let moldeIdRoute: typeof import("@/app/api/molde/posts/[id]/route");
  let contentRoute: typeof import("@/app/api/content/route");
  let tokenRoute: typeof import("@/app/api/token/refresh/route");

  before(async () => {
    scheduler = await import("@/lib/content/scheduler");
    moldeRoute = await import("@/app/api/molde/posts/route");
    moldeIdRoute = await import("@/app/api/molde/posts/[id]/route");
    contentRoute = await import("@/app/api/content/route");
    tokenRoute = await import("@/app/api/token/refresh/route");
  });

  beforeEach(async () => {
    meta.reset();
    await db!.sql("delete from public.content_posts");
    await db!.sql("delete from public.automations");
    await db!.sql("delete from public.instagram_accounts");
    otherId = await seedAccount(db!, { username: "principal", userId: "17840000000000099", token: "IGAA-TESTE-PRINCIPAL", isDefault: true });
    accountId = await seedAccount(db!, { isDefault: false });
  });

  async function connectFacebook(id = accountId, igUser = IG_USER) {
    await db!.sql(
      `insert into public.instagram_facebook_connections (account_id, instagram_user_id, page_id, page_name, user_access_token, user_token_expires_at, page_access_token, last_token_refresh_at)
       values ($1, $2, 'page-1', 'Página', 'FB-TESTE-USUARIO', now() + interval '50 days', 'FB-TESTE-PAGINA', now() - interval '2 days')`,
      [id, igUser],
    );
  }

  test("a 0009 cria a tabela da conexão (com RLS) e as colunas da música", async () => {
    const [tabela] = await db!.sql<{ rls: boolean }>("select relrowsecurity as rls from pg_class where relname = 'instagram_facebook_connections'");
    assert.equal(tabela.rls, true);
    const colunas = await db!.sql<{ column_name: string; column_default: string }>(
      "select column_name, column_default from information_schema.columns where table_name = 'content_posts' and column_name in ('musica_audio_id','musica_titulo','musica_volume','video_volume') order by column_name",
    );
    assert.deepEqual(colunas.map((coluna) => coluna.column_name), ["musica_audio_id", "musica_titulo", "musica_volume", "video_volume"]);
    const id = await insertPost(db!, accountId);
    await assert.rejects(db!.sql("update public.content_posts set musica_volume = 101 where id = $1", [id]), /check/i);
    await assert.rejects(db!.sql("update public.content_posts set video_volume = -1 where id = $1", [id]), /check/i);
    const [padrao] = await db!.sql<{ musica_audio_id: string | null; musica_volume: number; video_volume: number }>("select musica_audio_id, musica_volume, video_volume from public.content_posts where id = $1", [id]);
    assert.deepEqual(padrao, { musica_audio_id: null, musica_volume: 20, video_volume: 100 });
  });

  test("conectar pelo Facebook: state certo grava a Página da conta e NÃO troca a principal", async () => {
    meta.facebookPages = [
      { id: "page-outra", name: "Outra", access_token: "FB-TESTE-PAG-OUTRA", instagram_business_account: { id: "999" } },
      { id: "page-1", name: "Página da conta", access_token: "FB-TESTE-PAG-1", instagram_business_account: { id: IG_USER } },
    ];
    const inicio = await fbLoginRoute.GET(request(`/api/oauth/facebook/login?conta=${accountId}&next=%2Fconteudo`, { cookies: ADMIN }));
    const dialogo = location(inicio);
    assert.equal(dialogo.host, "www.facebook.com");
    assert.equal(dialogo.searchParams.get("client_id"), process.env.FACEBOOK_APP_ID);
    assert.equal(dialogo.searchParams.get("redirect_uri"), "https://uaiflow.teste/api/oauth/facebook/callback");
    assert.equal(dialogo.searchParams.get("scope"), "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts");
    const state = dialogo.searchParams.get("state") as string;
    const cookie = stateCookieFrom(inicio);

    const volta = await fbCallbackRoute.GET(request(`/api/oauth/facebook/callback?code=codigo-1&state=${encodeURIComponent(state)}`, { cookies: { ...ADMIN, [fbState.FACEBOOK_STATE_COOKIE]: cookie } }));
    const destino = location(volta);
    assert.equal(destino.pathname, "/conteudo");
    assert.equal(destino.searchParams.get("facebook_connected"), "1", destino.toString());
    assert.doesNotMatch(destino.toString(), FB_TOKEN);

    const [conexao] = await db!.sql<Record<string, unknown>>("select * from public.instagram_facebook_connections where account_id = $1", [accountId]);
    assert.equal(conexao.page_id, "page-1");
    assert.equal(conexao.instagram_user_id, IG_USER);
    assert.match(String(conexao.user_access_token), /^FB-TESTE-LONGO-/, "guarda o token de longa duração, não o curto");
    assert.equal(conexao.page_access_token, "FB-TESTE-PAG-1");
    const contas = await db!.sql<{ id: string; is_default: boolean }>("select id, is_default from public.instagram_accounts order by is_default desc");
    assert.deepEqual(contas.map((conta) => [conta.id, conta.is_default]), [[otherId, true], [accountId, false]]);
  });

  test("nenhuma Página ligada à conta: não grava e explica", async () => {
    meta.facebookPages = [{ id: "page-outra", access_token: "FB-TESTE-X", instagram_business_account: { id: "999" } }];
    const inicio = await fbLoginRoute.GET(request(`/api/oauth/facebook/login?conta=${accountId}`, { cookies: ADMIN }));
    const state = location(inicio).searchParams.get("state") as string;
    const volta = location(await fbCallbackRoute.GET(request(`/api/oauth/facebook/callback?code=c&state=${encodeURIComponent(state)}`, { cookies: { ...ADMIN, [fbState.FACEBOOK_STATE_COOKIE]: stateCookieFrom(inicio) } })));
    assert.match(volta.searchParams.get("facebook_error") ?? "", /Não achei uma Página do Facebook ligada a @conta_a/);
    assert.equal((await db!.sql("select 1 from public.instagram_facebook_connections")).length, 0);
  });

  test("busca de música: devolve id, título, artista e duração (sem token); sem a conexão, 409", async () => {
    const semConexao = await audioRoute.GET(request(`/api/instagram/audio?conta=${accountId}&q=lua`, { cookies: ADMIN }));
    assert.equal(semConexao.status, 409);
    assert.deepEqual(await semConexao.json(), { error: audioLib.MUSIC_NEEDS_FACEBOOK, codigo: "sem_facebook" });

    await connectFacebook();
    meta.igAudio = [
      { audio_id: "111", title: "Lua Cheia", display_artist: "Banda", duration_in_ms: 95_400, audio_type: "music", cover_artwork_thumbnail_uri: "https://cdn.teste.invalid/c.jpg", download_url: "https://cdn.teste.invalid/p.mp3" },
      { audio_id: 222, title: "Sem artista" },
      { title: "sem id (ignorado)" },
    ];
    const response = await audioRoute.GET(request(`/api/instagram/audio?conta=${accountId}&q=lua`, { cookies: ADMIN }));
    assert.equal(response.status, 200);
    const texto = await response.clone().text();
    assert.doesNotMatch(texto, FB_TOKEN);
    const { data } = await response.json();
    assert.equal(data.emAlta, false);
    assert.deepEqual(data.musicas[0], { id: "111", titulo: "Lua Cheia", artista: "Banda", duracaoMs: 95_400, duracao: "1:35", tipo: "music", capaUrl: "https://cdn.teste.invalid/c.jpg", previaUrl: "https://cdn.teste.invalid/p.mp3", linkPrevia: null, usuario: null });
    assert.equal(data.musicas[1].id, "222");
    assert.equal(data.musicas.length, 2);

    const call = meta.calls.find((item) => item.path === "/ig_audio");
    assert.ok(call);
    assert.equal(call.host, "graph.facebook.com");
    assert.equal(call.search.get("audio_type"), "music");
    assert.equal(call.search.get("user_id"), IG_USER);
    assert.equal(call.search.get("search_query"), "lua");
    assert.equal(call.auth, "Bearer FB-TESTE-USUARIO");

    const molde = await moldeAudioRoute.GET(request(`/api/molde/audio?conta=${accountId}`, { headers: MOLDE }));
    assert.equal(molde.status, 200);
    assert.equal((await molde.json()).data.emAlta, true, "sem q: em alta");
    assert.equal(meta.calls.filter((item) => item.path === "/ig_audio").at(-1)?.search.get("search_query"), null);
  });

  test("Molde: musica é validada, ajustada e guardada; null tira; GET mostra", async () => {
    await connectFacebook();
    const ruim = await moldeRoute.POST(request("/api/molde/posts", { json: { accountId, externalRef: "m-ruim", publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/r.mp4", musica: { titulo: "sem id" } }, headers: MOLDE }));
    assert.equal(ruim.status, 400);
    const carrossel = await moldeRoute.POST(request("/api/molde/posts", { json: { accountId, externalRef: "m-car", publishType: "carousel", mediaItems: [{ url: "https://midia.teste.invalid/1.jpg" }, { url: "https://midia.teste.invalid/2.jpg" }], musica: { audioId: "1" } }, headers: MOLDE }));
    assert.equal(carrossel.status, 400);

    const criado = await moldeRoute.POST(request("/api/molde/posts", { json: { accountId, externalRef: "m-1", publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/r.mp4", musica: { audioId: "777", titulo: "Lua · Banda", volumeMusica: 150.4, volumeVideo: -3 } }, headers: MOLDE }));
    assert.equal(criado.status, 201);
    const corpo = await criado.json();
    assert.deepEqual(corpo.data.musica, { audioId: "777", titulo: "Lua · Banda", volumeMusica: 100, volumeVideo: 0 });
    assert.equal(corpo.warning, undefined);
    const linha = await readPost(db!, corpo.data.id);
    assert.deepEqual([linha.musica_audio_id, linha.musica_titulo, linha.musica_volume, linha.video_volume], ["777", "Lua · Banda", 100, 0]);

    const lista = await moldeRoute.GET(request("/api/molde/posts?refs=m-1", { headers: MOLDE }));
    assert.deepEqual((await lista.json()).data[0].musica, corpo.data.musica);

    const troca = await moldeIdRoute.PATCH(request(`/api/molde/posts/${corpo.data.id}`, { method: "PATCH", json: { musica: { audioId: "888" } }, headers: MOLDE }), { params: Promise.resolve({ id: corpo.data.id }) });
    assert.deepEqual((await troca.json()).data.musica, { audioId: "888", titulo: null, volumeMusica: 20, volumeVideo: 100 });
    const tira = await moldeIdRoute.PATCH(request(`/api/molde/posts/${corpo.data.id}`, { method: "PATCH", json: { musica: null }, headers: MOLDE }), { params: Promise.resolve({ id: corpo.data.id }) });
    assert.equal((await tira.json()).data.musica, null);
    assert.equal((await readPost(db!, corpo.data.id)).musica_audio_id, null);
  });

  test("Molde: música num story (edição) é recusada; virar story tira a música", async () => {
    const id = await insertPost(db!, accountId, { status: "draft", scheduled_at: null, musica_audio_id: "1", source: "molde" });
    const recusa = await moldeIdRoute.PATCH(request(`/api/molde/posts/${id}`, { method: "PATCH", json: { publishType: "story_video", musica: { audioId: "2" } }, headers: MOLDE }), { params: Promise.resolve({ id }) });
    assert.equal(recusa.status, 400);
    const vira = await moldeIdRoute.PATCH(request(`/api/molde/posts/${id}`, { method: "PATCH", json: { publishType: "story_video", mediaUrl: "https://midia.teste.invalid/uaiflow/s.mp4" }, headers: MOLDE }), { params: Promise.resolve({ id }) });
    assert.equal(vira.status, 200, JSON.stringify(await vira.clone().json()));
    assert.equal((await readPost(db!, id)).musica_audio_id, null);
  });

  test("Reel com música: container no graph.facebook.com com audio_configuration; status e publicação pelo mesmo endereço e token", async () => {
    await connectFacebook();
    const id = await insertPost(db!, accountId, { musica_audio_id: "777", musica_titulo: "Lua", musica_volume: 15, video_volume: 100 });
    for (let round = 0; round < 3; round += 1) await scheduler.runContentCycle(8000);

    const post = await readPost(db!, id);
    assert.equal(post.status, "published", String(post.last_error));
    const criar = meta.calls.filter((item) => item.path.endsWith("/media") && item.method === "POST");
    assert.equal(criar.length, 1);
    assert.equal(criar[0].host, "graph.facebook.com");
    assert.equal(criar[0].path, `/${IG_USER}/media`);
    assert.equal(criar[0].auth, "Bearer FB-TESTE-USUARIO");
    assert.deepEqual(JSON.parse(String(criar[0].body.audio_configuration)), { audio_id: "777", audio_volume: 15, video_volume: 100, should_loop_audio: false });

    const status = meta.calls.filter((item) => item.method === "GET" && item.search.get("fields")?.includes("status_code"));
    assert.ok(status.length >= 1);
    for (const call of status) assert.deepEqual([call.host, call.auth], ["graph.facebook.com", "Bearer FB-TESTE-USUARIO"]);
    const publicar = meta.calls.filter((item) => item.path.endsWith("/media_publish"));
    assert.equal(publicar.length, 1);
    assert.deepEqual([publicar[0].host, publicar[0].auth], ["graph.facebook.com", "Bearer FB-TESTE-USUARIO"]);
    assert.ok(post.first_comment_id, "o 1º comentário continua saindo (pelo caminho de sempre)");
  });

  test("Reel com música e o token da pessoa vencido: usa o token da Página", async () => {
    await connectFacebook();
    await db!.sql("update public.instagram_facebook_connections set user_token_expires_at = now() - interval '1 day'");
    const id = await insertPost(db!, accountId, { musica_audio_id: "777" });
    await scheduler.runContentCycle(8000);
    const criar = meta.calls.find((item) => item.path.endsWith("/media") && item.method === "POST");
    assert.equal(criar?.auth, "Bearer FB-TESTE-PAGINA");
    assert.ok(["publishing", "published"].includes(String((await readPost(db!, id)).status)));
    assert.ok(meta.calls.filter((item) => item.host === "graph.facebook.com").every((item) => item.auth === "Bearer FB-TESTE-PAGINA"));
  });

  test("sem música: o caminho antigo, igual a antes (graph.instagram.com, token da conta), mesmo com a conexão pelo Facebook", async () => {
    await connectFacebook();
    const id = await insertPost(db!, accountId);
    for (let round = 0; round < 3; round += 1) await scheduler.runContentCycle(8000);
    const post = await readPost(db!, id);
    assert.equal(post.status, "published");
    const hosts = new Set(meta.calls.map((item) => item.host));
    assert.deepEqual([...hosts], ["graph.instagram.com"]);
    const criar = meta.calls.find((item) => item.path.endsWith("/media") && item.method === "POST");
    assert.ok(criar && !("audio_configuration" in criar.body));
    assert.equal(criar.auth, "Bearer IGAA-TESTE-CONTA-A");
  });

  test("música sem a conexão pelo Facebook: 'Publicar agora' falha com a frase e NADA é publicado", async () => {
    const response = await contentRoute.POST(request("/api/content", { json: { accountId, publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/r.mp4", caption: "x", musica: { audioId: "777" }, publishNow: true } }));
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.data.status, "failed");
    assert.equal(body.data.last_error, "Para pôr música do Instagram, conecte esta conta também pelo Facebook em Perfis.");
    assert.equal(meta.count("/media", "POST"), 0, "nenhum container criado");
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("música sem a conexão pelo Facebook: o relógio marca 'Com erro' em vez de publicar sem música", async () => {
    const id = await insertPost(db!, accountId, { musica_audio_id: "777" });
    for (let round = 0; round < 2; round += 1) await scheduler.runContentCycle(8000);
    const post = await readPost(db!, id);
    assert.equal(post.status, "failed");
    assert.equal(post.last_error, audioLib.MUSIC_NEEDS_FACEBOOK);
    assert.equal(meta.count("/media", "POST"), 0);
  });

  test("conexão pelo Facebook some no meio (container já criado): 'Com erro', sem publicar", async () => {
    const id = await insertPost(db!, accountId, { musica_audio_id: "777", status: "publishing", container_id: "container-x", publishing_started_at: new Date() });
    await scheduler.runContentCycle(8000);
    const post = await readPost(db!, id);
    assert.equal(post.status, "failed");
    assert.equal(post.last_error, audioLib.MUSIC_NEEDS_FACEBOOK);
    assert.equal(meta.count("/media_publish"), 0);
  });

  test("agendar Reel com música numa conta sem a conexão: salva e avisa", async () => {
    const quando = new Date(Date.now() + 3600_000).toISOString();
    const response = await contentRoute.POST(request("/api/content", { json: { accountId, publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/r.mp4", musica: { audioId: "777" }, scheduledAt: quando } }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.status, "scheduled");
    assert.equal(body.warning, audioLib.MUSIC_NEEDS_FACEBOOK);
  });

  test("relógio de tokens renova a conexão pelo Facebook (token da pessoa e da Página), sem devolver token", async () => {
    await connectFacebook();
    const response = await tokenRoute.POST(request("/api/token/refresh", { method: "POST", headers: { "x-worker-secret": process.env.WORKER_SECRET as string } }));
    const texto = await response.text();
    assert.doesNotMatch(texto, FB_TOKEN);
    const body = JSON.parse(texto);
    assert.deepEqual(body.facebook.map((item: { username: string; ok: boolean }) => [item.username, item.ok]), [["conta_a (Facebook)", true]]);
    const [conexao] = await db!.sql<{ user_access_token: string; page_access_token: string }>("select user_access_token, page_access_token from public.instagram_facebook_connections");
    assert.match(conexao.user_access_token, /^FB-TESTE-LONGO-/);
    assert.match(conexao.page_access_token, /^FB-TESTE-PAGINA-/);
    const troca = meta.calls.find((item) => item.path === "/oauth/access_token");
    assert.equal(troca?.search.get("grant_type"), "fb_exchange_token");

    // renovada há menos de 24 h: fica para amanhã
    meta.reset();
    const segunda = await (await tokenRoute.POST(request("/api/token/refresh", { method: "POST", headers: { "x-worker-secret": process.env.WORKER_SECRET as string } }))).json();
    assert.deepEqual(segunda.facebook.map((item: { pulada?: boolean }) => item.pulada), [true]);
    assert.equal(meta.calls.filter((item) => item.host === "graph.facebook.com").length, 0);
  });
});
