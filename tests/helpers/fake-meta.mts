/**
 * Meta (Instagram Graph), login do Instagram, R2 e Telegram simulados: troca o fetch global por um falso.
 * Qualquer endereço fora da lista é recusado na hora, para nenhum teste falar com a internet.
 * Baseado no simulador da auditoria (fetch-mock.cjs), com estado em memória por teste.
 */

export type FakeCall = { method: string; host: string; path: string; search: URLSearchParams; body: Record<string, unknown> };

export type FakeMedia = { id: string; caption: string; timestamp: string; permalink: string };

export type FakeMeta = {
  calls: FakeCall[];
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
  reset: () => void;
  restore: () => void;
};

const SIMULATED_HOSTS = /(^|\.)instagram\.com$|(^|\.)facebook\.com$|r2\.cloudflarestorage\.com$|\.invalid$|^api\.telegram\.org$/;

export function installFakeMeta(): FakeMeta {
  const realFetch = globalThis.fetch;
  let seq = 0;
  const containerCaption = new Map<string, string>();

  const fake: FakeMeta = {
    calls: [],
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
    reset: () => {
      fake.calls.length = 0;
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

    const body = await readBody(init.body);
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    fake.calls.push({ method, host: url.hostname, path, search: url.searchParams, body });
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

    if (path.endsWith("/comments") && method === "POST") return json({ id: `comment-${++seq}` });
    if (path.endsWith("/insights")) return json({ data: [] });

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
