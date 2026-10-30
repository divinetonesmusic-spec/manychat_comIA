/**
 * Meta (Instagram Graph), login do Instagram, R2 e Telegram simulados: troca o fetch global por um falso.
 * Qualquer endereço fora da lista é recusado na hora, para nenhum teste falar com a internet.
 * Baseado no simulador da auditoria (fetch-mock.cjs), com estado em memória por teste.
 */

export type FakeCall = { method: string; host: string; path: string; search: URLSearchParams; body: Record<string, unknown>; auth: string | null; headers: Headers };

export type FakeMedia = { id: string; caption: string; timestamp: string; permalink: string };

/** Comentário de um post (GET /{media-id}/comments), com as respostas dele. */
export type FakeComment = { id: string; text: string; timestamp: string; from?: { id: string; username?: string }; replies?: FakeComment[] };

export type FakeMeta = {
  calls: FakeCall[];
  /** Comentários de cada post (mídia → comentários, o mais novo primeiro), lidos de 50 em 50 com cursor. */
  comments: Map<string, FakeComment[]>;
  /** Se definido, GET /{media-id}/comments responde este erro (ex.: limite de uso, código 4). */
  commentsFailure: null | { status: number; error: Record<string, unknown> };
  /** Se true, GET /{media-id}/comments com replies{…} nos campos devolve páginas vazias (só com «próxima»). */
  commentsEmptyWithReplies: boolean;
  /** Quantas chamadas cujo caminho termina em `suffix` (ex.: "/media_publish"). */
  count: (suffix: string, method?: string) => number;
  /** status_code de cada container (o padrão vale para os que não estão aqui). */
  containerStatus: Map<string, string>;
  defaultStatus: string;
  /** O que GET /{ig-user-id}/media devolve (mais recente primeiro). */
  feed: FakeMedia[];
  /** Tokens cuja renovação a Meta recusa. */
  refreshFails: Set<string>;
  /** Simula o corte do Netlify: a Meta publica, mas a resposta nunca chega ao UaiFlow. */
  cutAfterPublish: boolean;
  /** Se true, a listagem do feed responde erro. */
  feedFails: boolean;
  /** Perfil devolvido pelo login do Instagram (GET /me). */
  profile: { user_id: string; username: string; name?: string };
  /** Validade (em segundos) do token devolvido pela renovação. O padrão é 60 dias. */
  refreshExpiresIn: number;
  /** Se definido, a criação de container (POST /{ig-user-id}/media) responde este erro da Meta. */
  createMediaError: string | null;
  /** Se true, a Meta recusa (erro 400) todo pedido de container que leve is_ai_generated. */
  rejectAiFlag: boolean;
  /** Avisos recebidos pelo Telegram falso (POST api.telegram.org/bot<token>/sendMessage). */
  telegram: { token: string; body: Record<string, unknown> }[];
  /** Outras chamadas ao Telegram falso (editMessageText, answerCallbackQuery, setWebhook…), na ordem. */
  telegramApi: { method: string; body: Record<string, unknown> }[];
  /** Falha do Telegram falso: "rede" (sem conexão) ou uma resposta de erro da API. */
  telegramFails: null | "rede" | { status: number; description: string };
  /** Se definido, todo POST /messages responde este erro (ex.: limite de uso da Meta, código 4 ou HTTP 429). */
  messagesError: null | { status: number; error: Record<string, unknown> };
  /** Quantos dos próximos envios de mídia por DM (anexo image/audio/video) a Meta recusa (erro 400). */
  mediaMessageFails: number;
  /** Se definido, a criação de container responde este erro completo (com code/error_subcode). */
  createMediaFailure: null | { status: number; error: Record<string, unknown> };
  /** Caminhos em que a Meta "trava" (não responde até o UaiFlow desistir pelo prazo). */
  hang: RegExp | null;
  /** Arquivos do R2 falso (chave → conteúdo). PUT guarda, GET lê/lista (ListObjectsV2), DELETE apaga. */
  r2: Map<string, { body: Buffer; lastModified: Date; contentType: string }>;
  /** Se definido, toda chamada ao R2 responde este código (ex.: 500). */
  r2Fails: number | null;
  /** Baldes do R2 que receberam alguma chamada (o primeiro pedaço do caminho). */
  r2Buckets: Set<string>;
  /** Login do Facebook (graph.facebook.com): Páginas devolvidas em GET /me/accounts. */
  facebookPages: Array<{ id: string; name?: string; access_token?: string; instagram_business_account?: { id: string; username?: string } }>;
  /** Músicas devolvidas em GET /ig_audio (Audio API). */
  igAudio: Array<Record<string, unknown>>;
  /** Se definido, GET /ig_audio responde este erro da Meta. */
  igAudioError: string | null;
  /** Tokens do Facebook cuja troca (fb_exchange_token) a Meta recusa. */
  facebookRefreshFails: Set<string>;
  /** Permissões concedidas devolvidas em GET /me/permissions (Login do Facebook). */
  facebookPermissions: string[];
  /** Reels da Página: o status devolvido em GET /{video-id}?fields=status. */
  fbReelStatus: Record<string, unknown>;
  /** Se definido, o finish (upload_phase=finish) responde este erro. */
  fbReelFinishError: string | null;
  /** Threads: status de cada container (o padrão vale para os outros) e erro na criação do container. */
  threadsStatus: Map<string, string>;
  threadsDefaultStatus: string;
  threadsCreateError: string | null;
  threadsRefreshFails: Set<string>;
  /** YouTube: sessões de envio (upload_id → total e bytes recebidos), erro ao abrir a sessão, pedaços que falham (503). */
  youtubeSessions: Map<string, { total: number; received: number; resource: Record<string, unknown>; done: boolean }>;
  youtubeStartError: null | { status: number; reason: string; message: string };
  youtubeChunkFails: number;
  googleRefreshFails: boolean;
  /** Tamanho do vídeo servido por https://midia.teste.invalid/... (HEAD e GET com Range). */
  mediaSize: number;
  /** Vendas que a API do Gumroad confirma (GET /v2/sales/{id}). */
  gumroadSales: Set<string>;
  reset: () => void;
  restore: () => void;
};

const SIMULATED_HOSTS = /(^|\.)instagram\.com$|(^|\.)facebook\.com$|r2\.cloudflarestorage\.com$|\.invalid$|^api\.telegram\.org$|(^|\.)threads\.net$|^oauth2\.googleapis\.com$|^www\.googleapis\.com$|^api\.gumroad\.com$/;

export function installFakeMeta(): FakeMeta {
  const realFetch = globalThis.fetch;
  let seq = 0;
  const containerCaption = new Map<string, string>();

  const fake: FakeMeta = {
    calls: [],
    comments: new Map(),
    commentsFailure: null,
    commentsEmptyWithReplies: false,
    count: (suffix, method) => fake.calls.filter((call) => call.path.endsWith(suffix) && (!method || call.method === method)).length,
    containerStatus: new Map(),
    defaultStatus: "FINISHED",
    feed: [],
    refreshFails: new Set(),
    cutAfterPublish: false,
    feedFails: false,
    profile: { user_id: "17840000000000001", username: "conta_nova" },
    refreshExpiresIn: 5_184_000,
    createMediaError: null,
    rejectAiFlag: false,
    telegram: [],
    telegramApi: [],
    telegramFails: null,
    messagesError: null,
    mediaMessageFails: 0,
    createMediaFailure: null,
    hang: null,
    r2: new Map(),
    r2Fails: null,
    r2Buckets: new Set(),
    facebookPages: [],
    igAudio: [],
    igAudioError: null,
    facebookRefreshFails: new Set(),
    facebookPermissions: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    fbReelStatus: { video_status: "upload_complete", uploading_phase: { status: "complete" }, processing_phase: { status: "in_progress" } },
    fbReelFinishError: null,
    threadsStatus: new Map(),
    threadsDefaultStatus: "FINISHED",
    threadsCreateError: null,
    threadsRefreshFails: new Set(),
    youtubeSessions: new Map(),
    youtubeStartError: null,
    youtubeChunkFails: 0,
    googleRefreshFails: false,
    mediaSize: 600 * 1024,
    gumroadSales: new Set(),
    reset: () => {
      fake.calls.length = 0;
      fake.comments.clear();
      fake.commentsFailure = null;
      fake.commentsEmptyWithReplies = false;
      fake.containerStatus.clear();
      fake.defaultStatus = "FINISHED";
      fake.feed.length = 0;
      fake.refreshFails.clear();
      fake.cutAfterPublish = false;
      fake.feedFails = false;
      fake.refreshExpiresIn = 5_184_000;
      fake.createMediaError = null;
      fake.rejectAiFlag = false;
      fake.telegram.length = 0;
      fake.telegramApi.length = 0;
      fake.telegramFails = null;
      fake.messagesError = null;
      fake.mediaMessageFails = 0;
      fake.createMediaFailure = null;
      fake.hang = null;
      fake.r2.clear();
      fake.r2Fails = null;
      fake.r2Buckets.clear();
      fake.facebookPages = [];
      fake.igAudio = [];
      fake.igAudioError = null;
      fake.facebookRefreshFails.clear();
      fake.facebookPermissions = ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "pages_manage_posts"];
      fake.fbReelStatus = { video_status: "upload_complete", uploading_phase: { status: "complete" }, processing_phase: { status: "in_progress" } };
      fake.fbReelFinishError = null;
      fake.threadsStatus.clear();
      fake.threadsDefaultStatus = "FINISHED";
      fake.threadsCreateError = null;
      fake.threadsRefreshFails.clear();
      fake.youtubeSessions.clear();
      fake.youtubeStartError = null;
      fake.youtubeChunkFails = 0;
      fake.googleRefreshFails = false;
      fake.mediaSize = 600 * 1024;
      fake.gumroadSales.clear();
      containerCaption.clear();
    },
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = String(init.method || request?.method || "GET").toUpperCase();
    if (!SIMULATED_HOSTS.test(url.hostname)) {
      throw new Error(`Rede real bloqueada nos testes: ${method} ${url.hostname}`);
    }

    const rawBody = init.body;
    const body = rawBody instanceof Uint8Array ? {} : await readBody(rawBody);
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const headers = new Headers(init.headers ?? request?.headers ?? undefined);
    const auth = headers.get("authorization");
    fake.calls.push({ method, host: url.hostname, path, search: url.searchParams, body, auth, headers });
    const id = path.split("/").filter(Boolean)[0] ?? "";
    const fields = url.searchParams.get("fields") || "";

    if (fake.hang?.test(path)) {
      // Não responde: só termina quando o UaiFlow desiste (o sinal do prazo aborta o pedido).
      const signal = init.signal ?? request?.signal;
      return new Promise<Response>((_, reject) => {
        if (!signal) return;
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }

    if (url.hostname.endsWith("r2.cloudflarestorage.com")) return fakeR2(fake, method, url, init);

    // Vídeo público no R2 (as outras redes leem o arquivo): HEAD dá o tamanho, GET com Range dá o pedaço.
    if (url.hostname === "midia.teste.invalid" && (method === "HEAD" || method === "GET")) {
      const size = fake.mediaSize;
      if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": String(size), "content-type": "video/mp4" } });
      const range = headers.get("range")?.match(/bytes=(\d+)-(\d+)/);
      const start = range ? Number(range[1]) : 0;
      const end = range ? Math.min(Number(range[2]), size - 1) : size - 1;
      const chunk = new Uint8Array(end - start + 1).fill(7);
      return new Response(chunk, { status: range ? 206 : 200, headers: { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${size}` } });
    }

    // Threads API (graph.threads.net)
    if (url.hostname.endsWith("threads.net")) {
      if (path === "/oauth/access_token" && method === "POST") {
        if (!body.code) return json({ error: { message: "Missing code", code: 100 } }, 400);
        return json({ access_token: "TH-TESTE-CURTO", user_id: 7001 });
      }
      if (path === "/access_token") return json({ access_token: `TH-TESTE-LONGO-${++seq}`, token_type: "bearer", expires_in: 5_184_000 });
      if (path === "/refresh_access_token") {
        const token = url.searchParams.get("access_token") || "";
        if (fake.threadsRefreshFails.has(token)) return json({ error: { message: "Session has expired", code: 190 } }, 400);
        return json({ access_token: `TH-TESTE-RENOVADO-${++seq}`, token_type: "bearer", expires_in: 5_184_000 });
      }
      if (path === "/me") return json({ id: "7001", username: "threads_teste" });
      if (path.endsWith("/threads_publish") && method === "POST") {
        const containerId = url.searchParams.get("creation_id") || "";
        fake.threadsStatus.set(containerId, "PUBLISHED");
        return json({ id: `thmedia-${++seq}` });
      }
      if (path.endsWith("/threads") && method === "POST") {
        if (fake.threadsCreateError) return json({ error: { message: fake.threadsCreateError, code: 100 } }, 400);
        return json({ id: `thcontainer-${++seq}` });
      }
      if (method === "GET" && fields.includes("status")) return json({ id, status: fake.threadsStatus.get(id) ?? fake.threadsDefaultStatus });
      if (method === "GET" && fields === "permalink") return json({ id, permalink: `https://www.threads.net/@threads_teste/post/${id}` });
      return json({ error: { message: `simulado: rota do Threads não prevista ${method} ${path}` } }, 400);
    }

    // Google OAuth
    if (url.hostname === "oauth2.googleapis.com" && path === "/token") {
      if (body.grant_type === "authorization_code") {
        return json({ access_token: "ya29.TESTE-ACESSO", expires_in: 3599, refresh_token: "YT-TESTE-REFRESH", scope: "https://www.googleapis.com/auth/youtube.upload", token_type: "Bearer" });
      }
      if (fake.googleRefreshFails) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
      return json({ access_token: `ya29.TESTE-${++seq}`, expires_in: 3599, token_type: "Bearer" });
    }

    // YouTube Data API: envio "resumable"
    if (url.hostname === "www.googleapis.com" && path === "/upload/youtube/v3/videos") {
      const uploadId = url.searchParams.get("upload_id");
      if (method === "POST" && url.searchParams.get("uploadType") === "resumable" && !uploadId) {
        if (fake.youtubeStartError) return json({ error: { message: fake.youtubeStartError.message, errors: [{ reason: fake.youtubeStartError.reason }] } }, fake.youtubeStartError.status);
        const newId = `UP${++seq}`;
        fake.youtubeSessions.set(newId, { total: Number(headers.get("x-upload-content-length")), received: 0, resource: body, done: false });
        return new Response(null, { status: 200, headers: { location: `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=${newId}` } });
      }
      const session = uploadId ? fake.youtubeSessions.get(uploadId) : undefined;
      if (method === "PUT") {
        if (!session) return json({ error: { message: "Not Found" } }, 404);
        const finished = () => json({ id: `yt-video-${uploadId}`, snippet: { channelId: "UC-teste" }, status: { uploadStatus: "uploaded" } }, 201);
        const incomplete = () => new Response(null, { status: 308, headers: session.received ? { range: `bytes=0-${session.received - 1}` } : {} });
        const contentRange = headers.get("content-range") || "";
        if (/^bytes \*\//.test(contentRange)) return session.done ? finished() : incomplete();
        if (fake.youtubeChunkFails > 0) {
          fake.youtubeChunkFails -= 1;
          return json({ error: { message: "Backend Error" } }, 503);
        }
        const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        const size = rawBody instanceof Uint8Array ? rawBody.length : 0;
        if (!match || Number(match[1]) !== session.received || Number(match[2]) - Number(match[1]) + 1 !== size) return incomplete();
        session.received = Number(match[2]) + 1;
        if (session.received >= session.total) {
          session.done = true;
          return finished();
        }
        return incomplete();
      }
    }

    // API do Gumroad (confirmação da venda)
    if (url.hostname === "api.gumroad.com") {
      const saleId = decodeURIComponent(path.split("/").pop() ?? "");
      if (path.startsWith("/v2/sales/") && fake.gumroadSales.has(saleId)) return json({ success: true, sale: { id: saleId } });
      return json({ success: false, message: "The sale was not found." }, 404);
    }

    // Telegram (avisos): /bot<token>/sendMessage; as outras chamadas (editMessageText, answerCallbackQuery, setWebhook…) vão
    // para telegramApi.
    if (url.hostname === "api.telegram.org") {
      const match = path.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
      if (!match || method !== "POST") return json({ ok: false, error_code: 404, description: "Not Found" }, 404);
      if (fake.telegramFails === "rede") throw new TypeError("fetch failed (Telegram fora do ar, simulado)");
      if (fake.telegramFails) return json({ ok: false, error_code: fake.telegramFails.status, description: fake.telegramFails.description }, fake.telegramFails.status);
      if (match[2] !== "sendMessage") {
        fake.telegramApi.push({ method: match[2], body });
        return json({ ok: true, result: true });
      }
      fake.telegram.push({ token: match[1], body });
      return json({ ok: true, result: { message_id: fake.telegram.length } });
    }

    // Login do Facebook e Audio API (graph.facebook.com). Criar container, status e media_publish caem nas regras comuns abaixo.
    if (url.hostname === "graph.facebook.com") {
      if (path === "/oauth/access_token") {
        const old = url.searchParams.get("fb_exchange_token");
        if (old !== null) {
          if (fake.facebookRefreshFails.has(old)) return json({ error: { message: "Error validating access token: Session has expired", code: 190 } }, 400);
          return json({ access_token: `FB-TESTE-LONGO-${++seq}`, token_type: "bearer", expires_in: 5_184_000 });
        }
        if (!url.searchParams.get("code")) return json({ error: { message: "Missing code" } }, 400);
        return json({ access_token: "FB-TESTE-CURTO", token_type: "bearer" });
      }
      if (path === "/me") return json({ id: "fb-user-1", name: "Pessoa Teste" });
      if (path === "/me/permissions") return json({ data: fake.facebookPermissions.map((permission) => ({ permission, status: "granted" })) });
      // Reels da Página: start / finish em /{page-id}/video_reels; status e permalink_url no vídeo
      if (path.endsWith("/video_reels") && method === "POST") {
        if (body.upload_phase === "start") return json({ video_id: `fbvideo-${++seq}`, upload_url: "https://rupload.facebook.com/video-upload/v25.0/x" });
        if (body.upload_phase === "finish") {
          if (fake.fbReelFinishError) return json({ error: { message: fake.fbReelFinishError, code: 100 } }, 400);
          fake.fbReelStatus = { ...fake.fbReelStatus, publishing_phase: { status: "complete" } };
          return json({ success: true });
        }
      }
      // Foto na Página (imagem estática): POST /{page-id}/photos com url + caption
      if (path.endsWith("/photos") && method === "POST") {
        if (!body.url) return json({ error: { message: "url ausente", code: 100 } }, 400);
        const n = ++seq;
        return json({ id: `fbphoto-${n}`, post_id: `page-1_${n}` });
      }
      if (method === "GET" && fields === "status") return json({ id, status: fake.fbReelStatus });
      if (method === "GET" && fields === "permalink_url") return json({ id, permalink_url: `/reel/${id}` });
      if (path === "/me/accounts") return json({ data: fake.facebookPages });
      if (path === "/ig_audio") {
        if (fake.igAudioError) return json({ error: { message: fake.igAudioError, code: 100 } }, 400);
        return json({ audio: fake.igAudio });
      }
      if (method === "GET" && fields === "access_token") return json({ id, access_token: `FB-TESTE-PAGINA-${++seq}` });
    }
    if (url.hostname === "rupload.facebook.com" && path.startsWith("/video-upload/")) {
      if (!headers.get("file_url")) return json({ error: { message: "file_url ausente" } }, 400);
      return json({ success: true });
    }

    // Login do Instagram (troca do código por token curto e longo)
    if (url.hostname === "api.instagram.com" && path === "/oauth/access_token") {
      return json({ access_token: "IGAA-TESTE-CURTO", user_id: Number(fake.profile.user_id) });
    }
    if (path === "/access_token") return json({ access_token: `IGAA-TESTE-LONGO-${++seq}`, token_type: "bearer", expires_in: 5_184_000 });
    if (path === "/me") return json(fake.profile);
    if (path.endsWith("/subscribed_apps")) return json({ success: true });

    if (path === "/refresh_access_token") {
      const token = url.searchParams.get("access_token") || "";
      if (fake.refreshFails.has(token)) return json({ error: { message: "Error validating access token: Session has expired" } }, 400);
      return json({ access_token: `IGAA-TESTE-RENOVADO-${++seq}`, token_type: "bearer", expires_in: fake.refreshExpiresIn });
    }

    if (path.endsWith("/media_publish") && method === "POST") {
      const containerId = String(body.creation_id || "");
      const mediaId = `media-${++seq}`;
      fake.containerStatus.set(containerId, "PUBLISHED");
      fake.feed.unshift({
        id: mediaId,
        caption: containerCaption.get(containerId) ?? "",
        timestamp: metaTimestamp(new Date()),
        permalink: `https://www.instagram.com/reel/${mediaId}/`,
      });
      if (fake.cutAfterPublish) throw new TypeError("fetch failed (corte simulado depois de a Meta publicar)");
      return json({ id: mediaId });
    }

    if (path.endsWith("/media") && method === "POST") {
      if (fake.createMediaFailure) return json({ error: fake.createMediaFailure.error }, fake.createMediaFailure.status);
      if (fake.createMediaError) return json({ error: { message: fake.createMediaError } }, 400);
      if (fake.rejectAiFlag && "is_ai_generated" in body) return json({ error: { message: "(#100) Invalid parameter: is_ai_generated is not supported for this request" } }, 400);
      const containerId = `container-${++seq}`;
      containerCaption.set(containerId, String(body.caption ?? ""));
      return json({ id: containerId });
    }

    if (path.endsWith("/media") && method === "GET") {
      if (fake.feedFails) return json({ error: { message: "Feed indisponível (simulado)" } }, 500);
      const limit = Number(url.searchParams.get("limit") || 25);
      return json({ data: fake.feed.slice(0, limit) });
    }

    // Mensagens diretas e respostas privadas (POST /{ig-user-id}/messages) e resposta pública a comentário (POST /{comment-id}/replies).
    if (path.endsWith("/messages") && method === "POST") {
      if (fake.messagesError) return json({ error: fake.messagesError.error }, fake.messagesError.status);
      const attachment = (body.message as { attachment?: { type?: string } } | undefined)?.attachment;
      if (fake.mediaMessageFails > 0 && attachment && ["image", "audio", "video"].includes(String(attachment.type))) {
        fake.mediaMessageFails -= 1;
        return json({ error: { message: "(#100) Falha simulada ao mandar a mídia", code: 100 } }, 400);
      }
      return json({ recipient_id: "destinatario", message_id: `mid-${++seq}` });
    }
    if (path.endsWith("/replies") && method === "POST") return json({ id: `reply-${++seq}` });

    // Leitura dos comentários (paginada como a Meta: 50 por vez, cursor «after»), com as respostas (2 vêm junto).
    if (path.endsWith("/comments") && method === "GET") {
      if (fake.commentsFailure) return json({ error: fake.commentsFailure.error }, fake.commentsFailure.status);
      const lista = fake.comments.get(id) ?? [];
      if (fake.commentsEmptyWithReplies && fields.includes("replies{")) {
        const pagina = paginar(lista, url.searchParams, (comment) => comment);
        return json({ ...pagina, data: [] });
      }
      return json(paginar(lista, url.searchParams, (comment) => {
        const { replies, ...resto } = comment;
        if (!replies?.length) return resto;
        return { ...resto, replies: paginar(replies, new URLSearchParams({ limit: "2" }), (reply) => reply) };
      }));
    }
    if (path.endsWith("/replies") && method === "GET") {
      const pai = [...fake.comments.values()].flat().find((comment) => comment.id === id);
      return json(paginar(pai?.replies ?? [], url.searchParams, (reply) => reply));
    }

    if (path.endsWith("/comments") && method === "POST") return json({ id: `comment-${++seq}` });
    if (path.endsWith("/insights")) return json({ data: [] });

    if (method === "GET" && fields === "comments_count") return json({ id, comments_count: (fake.comments.get(id) ?? []).length });
    if (method === "GET" && fields.includes("status_code")) {
      return json({ id, status_code: fake.containerStatus.get(id) ?? fake.defaultStatus, status: "" });
    }
    if (method === "GET" && fields.includes("permalink")) {
      const found = fake.feed.find((media) => media.id === id);
      return json({ id, permalink: found?.permalink ?? `https://www.instagram.com/reel/${id}/` });
    }

    return json({ error: { message: `simulado: rota não prevista ${method} ${path}` } }, 400);
  }) as typeof fetch;

  return fake;
}

function paginar<T>(lista: T[], search: URLSearchParams, mostrar: (item: T) => unknown) {
  const limite = Math.min(50, Number(search.get("limit") || 25));
  const inicio = Number(search.get("after") || 0);
  const pagina = lista.slice(inicio, inicio + limite).map(mostrar);
  const fim = inicio + limite;
  return {
    data: pagina,
    paging: fim < lista.length ? { cursors: { before: String(inicio), after: String(fim) }, next: `https://graph.instagram.com/next?after=${fim}` } : { cursors: { before: String(inicio), after: String(fim) } },
  };
}

/** Formato de data que a Meta usa no campo timestamp (ex.: 2026-10-07T12:00:00+0000). */
export function metaTimestamp(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "+0000");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** R2 falso com estado: /<balde>/<chave>. Só o essencial do S3 que o UaiFlow usa. */
async function fakeR2(fake: FakeMeta, method: string, url: URL, init: RequestInit) {
  if (fake.r2Fails) return new Response("<Error><Code>InternalError</Code></Error>", { status: fake.r2Fails });
  const [, bucket, ...rest] = url.pathname.split("/");
  fake.r2Buckets.add(bucket);
  const key = rest.map((part) => decodeURIComponent(part)).join("/");
  if (method === "GET" && !key && url.searchParams.get("list-type") === "2") {
    const prefix = url.searchParams.get("prefix") ?? "";
    const max = Number(url.searchParams.get("max-keys") || 1000);
    const start = Number(url.searchParams.get("continuation-token") || 0);
    const keys = [...fake.r2.keys()].filter((k) => k.startsWith(prefix)).sort();
    const page = keys.slice(start, start + max);
    const truncated = start + max < keys.length;
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const contents = page
      .map((k) => `<Contents><Key>${esc(k)}</Key><Size>${fake.r2.get(k)!.body.length}</Size><LastModified>${fake.r2.get(k)!.lastModified.toISOString()}</LastModified></Contents>`)
      .join("");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>balde</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${start + max}</NextContinuationToken>` : ""}${contents}</ListBucketResult>`;
    return new Response(xml, { status: 200, headers: { "content-type": "application/xml" } });
  }
  if (method === "PUT") {
    const raw = init.body;
    const body = raw == null ? Buffer.alloc(0) : typeof raw === "string" ? Buffer.from(raw) : raw instanceof Uint8Array ? Buffer.from(raw) : Buffer.from(await new Response(raw as BodyInit).arrayBuffer());
    const headers = new Headers(init.headers);
    fake.r2.set(key, { body, lastModified: new Date(), contentType: headers.get("content-type") || "" });
    return new Response(null, { status: 200 });
  }
  if (method === "GET") {
    const obj = fake.r2.get(key);
    if (!obj) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    return new Response(new Uint8Array(obj.body), { status: 200, headers: { "content-type": obj.contentType } });
  }
  if (method === "HEAD") {
    const obj = fake.r2.get(key);
    if (!obj) return new Response(null, { status: 404 });
    return new Response(null, { status: 200, headers: { "content-length": String(obj.body.length), "content-type": obj.contentType } });
  }
  if (method === "DELETE") {
    fake.r2.delete(key);
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 405 });
}

async function readBody(body: BodyInit | null | undefined): Promise<Record<string, unknown>> {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return Object.fromEntries(new URLSearchParams(body));
    }
  }
  if (body instanceof URLSearchParams) return Object.fromEntries(body);
  return {};
}
