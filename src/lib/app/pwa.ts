/**
 * O que faz a página do app virar «app» no celular (0018): o manifest (o nome, o ícone e as cores da marca do avatar) e o service
 * worker. Puro: as rotas só servem o que sai daqui.
 *
 * O service worker guarda a tela do app e os arquivos dela (para abrir sem internet) e apaga os áudios das versões velhas. Quem
 * guarda os áudios é a própria página (Cache Storage «app-<slug>-audio-v<versão>»): ela baixa cada áudio pelo link com prazo,
 * guarda e toca dali (o áudio nunca é baixado pelo service worker, nem fica público).
 */
import type { AppPacote } from "@/lib/app/pacote";

export const ICONES = [192, 512] as const;

export function manifestDe(slug: string, app: AppPacote) {
  return {
    name: app.titulo,
    short_name: app.nomeCurto,
    description: app.promessa || app.titulo,
    lang: app.idioma,
    id: `/a/${slug}`,
    start_url: `/a/${slug}?de=app`,
    scope: `/a/${slug}`,
    display: "standalone",
    orientation: "portrait",
    background_color: app.marca.fundo,
    theme_color: app.marca.fundo,
    icons: [
      ...ICONES.map((t) => ({ src: `/a/${slug}/icone/${t}`, sizes: `${t}x${t}`, type: "image/png", purpose: "any" })),
      { src: `/a/${slug}/icone/512`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/** Os nomes das caixas do aparelho (a tela e os áudios de cada versão do app). */
export function caixas(slug: string, versao: number) {
  return { tela: `app-${slug}-tela`, audio: `app-${slug}-audio-v${versao}`, prefixo: `app-${slug}-` };
}

/** O service worker (escopo /a/<slug>/): a tela pela rede quando dá (e guardada), guardada quando não dá; os arquivos do Next guardados. */
export function swScript(slug: string, versao: number) {
  const C = caixas(slug, versao);
  return `/* service worker do app ${slug} (versão ${versao}) */
const TELA = ${JSON.stringify(C.tela)};
const AUDIO = ${JSON.stringify(C.audio)};
const PREFIXO = ${JSON.stringify(C.prefixo)};
const BASE = ${JSON.stringify(`/a/${slug}`)};
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n.startsWith(PREFIXO) && n !== TELA && n !== AUDIO).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // a tela do app: pela rede (e guarda a última), ou a guardada sem internet
  if (req.mode === "navigate" && (url.pathname === BASE || url.pathname === BASE + "/")) {
    e.respondWith((async () => {
      const caixa = await caches.open(TELA);
      try {
        const r = await fetch(req);
        if (r.ok) await caixa.put(BASE, r.clone());
        return r;
      } catch (erro) {
        const guardada = await caixa.match(BASE);
        if (guardada) return guardada;
        throw erro;
      }
    })());
    return;
  }
  // o áudio não passa por aqui: a página lê direto da caixa AUDIO (e baixa pela rede quando falta)
  // os arquivos do Next (o código da tela): os guardados primeiro (mudam de nome a cada versão do site)
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith(BASE + "/icone/") || url.pathname === BASE + "/manifest.webmanifest") {
    e.respondWith((async () => {
      const caixa = await caches.open(TELA);
      const guardado = await caixa.match(req);
      if (guardado) return guardado;
      const r = await fetch(req);
      if (r.ok) await caixa.put(req, r.clone());
      return r;
    })());
  }
});
`;
}
