/**
 * Meta (Instagram Graph), login do Instagram e R2 simulados: troca o fetch global por um falso.
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
  reset: () => void;
  restore: () => void;
};

const SIMULATED_HOSTS = /(^|\.)instagram\.com$|(^|\.)facebook\.com$|r2\.cloudflarestorage\.com$|\.invalid$/;

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
    reset: () => {
      fake.calls.length = 0;
      fake.containerStatus.clear();
      fake.defaultStatus = "FINISHED";
      fake.feed.length = 0;
      fake.refreshFails.clear();
      fake.cutAfterPublish = false;
      fake.feedFails = false;
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

    if (url.hostname.endsWith("r2.cloudflarestorage.com")) return new Response(null, { status: 204 });

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
      return json({ access_token: `IGAA-TESTE-RENOVADO-${++seq}`, token_type: "bearer", expires_in: 5_184_000 });
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
      const containerId = `container-${++seq}`;
      containerCaption.set(containerId, String(body.caption ?? ""));
      return json({ id: containerId });
    }

    if (path.endsWith("/media") && method === "GET") {
      if (fake.feedFails) return json({ error: { message: "Feed indisponível (simulado)" } }, 500);
      const limit = Number(url.searchParams.get("limit") || 25);
      return json({ data: fake.feed.slice(0, limit) });
    }

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
