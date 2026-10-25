import { query, transaction } from "@/lib/db/client";
import { formatSaoPauloTime } from "@/lib/time";
import { isTelegramConfigured, sendTelegram, TELEGRAM_TIMEOUT_MS } from "@/lib/notify";
import { DMVIDEOS_FOLDER } from "@/lib/content/r2";

/**
 * Roteiro de DM com vídeo do avatar (Molde v133, K-DMVIDEO, migração 0014).
 *
 * O caminho de quem comenta a palavra de um Reel com a sequência em modo «vídeo»:
 *   1 · a resposta privada ao comentário (a única que a Meta deixa mandar a quem comentou) nomeia o que a pessoa fez e
 *       pergunta por quê («Valeu por comentar no vídeo! O que te fez comentar?»). Não leva link.
 *   2 · a resposta dela abre a janela de 24 h da Meta. As palavras da resposta escolhem um dos 3 a 5 vídeos do avatar
 *       gravados antes para o post (ou para a palavra), cada um para uma dúvida comum; sem casar, vai o vídeo «geral».
 *   3 · o Nicolas recebe o aviso no Telegram na hora (o que ela respondeu e qual vídeo vai); o vídeo sai sozinho
 *       `videoAposMinutos` depois (padrão 3, nunca mais de 15): a resposta chega em até 15 minutos.
 *   4 · só depois do vídeo vai o link do produto (o link que conta cliques, ?de=dm), `linkAposSegundos` depois do vídeo.
 *
 * O que a Meta NÃO informa: se a pessoa assistiu ao vídeo na DM. O painel mostra «vídeo enviado» (o envio saiu) e, à parte,
 * «com sinal de que viu» = tocou no link depois do vídeo ou escreveu de novo depois dele. Não é uma visualização medida.
 *
 * Sem a 0014: nada disto roda e a sequência da 0012 continua igual (mensagem 2, o link e o lembrete).
 */

export const MIGRATION_0014_DMVIDEO = "Falta colar a atualização 0014 no Supabase: a DM do post segue sem o vídeo do avatar (só a mensagem 2, o link e o lembrete).";
/** O que a Meta não informa, dito do mesmo jeito em todo lugar (a página mostra esta frase no painel). */
export const NOTA_VIDEO_VISTO = "A Meta não informa se a pessoa assistiu ao vídeo na DM. «Vídeo enviado» é o envio que saiu; «com sinal de que viu» conta quem tocou no link ou escreveu de novo depois do vídeo.";
/** Limite da Meta para um vídeo mandado na DM do Instagram (API de mensagens): mp4, ogg, avi, mov ou webm, até 25 MB. */
export const META_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEOS_POR_POST = 6;
export const MAX_PALAVRAS_POR_VIDEO = 30;
/** O vídeo sai até 15 min depois da resposta (o combinado com o Nicolas); o padrão é 3 min. */
export const VIDEO_APOS_MAX_MIN = 15;
export const VIDEO_APOS_PADRAO_MIN = 3;
/** Marca do envio do vídeo na fila (payload.passo). */
export const PASSO_VIDEO = "video";

export type DmVideo = {
  chave: string;
  titulo: string;
  palavras: string[];
  geral: boolean;
  texto: string;
  videoUrl: string;
  tamanho: number | null;
  duracaoSeg: number | null;
  ordem: number;
};

/** minúsculas, sem acento, sem pontuação, espaços simples */
export function normalizar(texto: unknown) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function textoLimpo(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\r/g, "").trim().slice(0, max) : "";
}

/**
 * Lê a lista de vídeos que a página manda. { erro } com a frase em português, ou { videos }.
 * Regras: 1 a 6 vídeos; `chave` curta (letras, números e hífen); cada vídeo com palavras (até 30) ou marcado como `geral`
 * (no máximo 1 geral); `videoUrl` https terminando em .mp4 ou .mov; `tamanho` (bytes), se vier, até 25 MB.
 */
export function parseVideos(raw: unknown): { videos: DmVideo[] } | { erro: string } {
  if (!Array.isArray(raw) || !raw.length) return { erro: "Mande videos: uma lista com 1 a 6 vídeos." };
  if (raw.length > MAX_VIDEOS_POR_POST) return { erro: `No máximo ${MAX_VIDEOS_POR_POST} vídeos por post.` };
  const out: DmVideo[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { erro: `O vídeo ${i + 1} precisa ser um objeto.` };
    const r = item as Record<string, unknown>;
    const chave = normalizar(r.chave).replace(/ /g, "-").slice(0, 40);
    if (!chave) return { erro: `O vídeo ${i + 1} está sem chave (um nome curto, ex.: acorda-de-madrugada).` };
    if (out.some((v) => v.chave === chave)) return { erro: `Dois vídeos com a mesma chave: ${chave}.` };
    const palavras = Array.isArray(r.palavras)
      ? [...new Set(r.palavras.map((p) => normalizar(p).slice(0, 40)).filter(Boolean))].slice(0, MAX_PALAVRAS_POR_VIDEO)
      : [];
    const geral = r.geral === true;
    if (!palavras.length && !geral) return { erro: `O vídeo «${chave}» precisa de palavras (ou ser o vídeo geral).` };
    const videoUrl = textoLimpo(r.videoUrl, 2000);
    if (!/^https:\/\/\S+\.(mp4|mov)(\?\S*)?$/i.test(videoUrl)) return { erro: `O vídeo «${chave}» precisa de um endereço https de um arquivo .mp4 ou .mov.` };
    const tamanho = typeof r.tamanho === "number" && Number.isFinite(r.tamanho) && r.tamanho > 0 ? Math.round(r.tamanho) : null;
    if (tamanho && tamanho > META_VIDEO_MAX_BYTES) return { erro: `O vídeo «${chave}» tem ${Math.ceil(tamanho / 1048576)} MB: a Meta só aceita vídeos de até 25 MB na DM.` };
    const duracao = typeof r.duracaoSeg === "number" && Number.isFinite(r.duracaoSeg) && r.duracaoSeg > 0 ? Math.round(r.duracaoSeg) : null;
    out.push({ chave, titulo: textoLimpo(r.titulo, 200), palavras, geral, texto: textoLimpo(r.texto, 1000), videoUrl, tamanho, duracaoSeg: duracao, ordem: i });
  }
  if (out.filter((v) => v.geral).length > 1) return { erro: "Só um vídeo pode ser o geral (o que vai quando nada casa)." };
  return { videos: out };
}

/** A palavra cadastrada casa com a palavra da resposta? Igual, ou o mesmo começo (dorm → dormir, dormindo; ansiedade → ansiosa não). */
function casaPalavra(token: string, palavra: string) {
  if (token === palavra) return true;
  if (palavra.length < 4 || token.length < 4) return false;
  const raiz = palavra.slice(0, Math.max(4, palavra.length - 2));
  return token.startsWith(raiz);
}

/**
 * Escolhe o vídeo pelas palavras da resposta da pessoa (função pura). Cada palavra cadastrada que aparece vale 1 ponto; uma
 * expressão (2+ palavras, ex.: «acordo de madrugada») vale 2. Ganha o vídeo com mais pontos; empate, o que vem antes na lista.
 * Nada casou: o vídeo geral (motivo 'geral'), ou null se não houver geral.
 */
export function escolherVideo(texto: unknown, videos: DmVideo[]): { video: DmVideo; casou: string[]; motivo: "palavra" | "geral" } | null {
  const norm = normalizar(texto);
  const tokens = norm ? norm.split(" ") : [];
  let melhor: { video: DmVideo; casou: string[]; pontos: number } | null = null;
  for (const video of [...videos].sort((a, b) => a.ordem - b.ordem)) {
    const casou: string[] = [];
    let pontos = 0;
    for (const palavra of video.palavras) {
      const p = normalizar(palavra);
      if (!p) continue;
      if (p.includes(" ")) {
        if (` ${norm} `.includes(` ${p} `)) { casou.push(palavra); pontos += 2; }
      } else if (tokens.some((t) => casaPalavra(t, p))) {
        casou.push(palavra);
        pontos += 1;
      }
    }
    if (pontos > 0 && (!melhor || pontos > melhor.pontos)) melhor = { video, casou, pontos };
  }
  if (melhor) return { video: melhor.video, casou: melhor.casou, motivo: "palavra" };
  const geral = videos.find((v) => v.geral);
  return geral ? { video: geral, casou: [], motivo: "geral" } : null;
}

/* ------------------------------------------------ o funil e o gargalo ------------------------------------------------ */

export type FunilNumeros = { comentarios: number; responderam: number; videos: number; cliques: number; compras: number; views?: number | null };
export type Gargalo = {
  etapa: "comentarios" | "resposta" | "video" | "clique" | "compra" | null;
  tipo: "trafego" | "conversa" | "pagina" | "nenhum";
  frase: string;
  taxas: { resposta: number | null; video: number | null; clique: number | null; compra: number | null };
};

/** Referências (de mercado, a testar) de cada passagem do funil e o mínimo de pessoas para julgar uma passagem. */
export const REFERENCIAS_FUNIL = { resposta: 0.35, video: 0.9, clique: 0.25, compra: 0.05, comentariosPorMilViews: 3, minimoComentarios: 20, minimoBase: 10 } as const;

const taxa = (a: number, b: number) => (b > 0 ? a / b : null);

/**
 * O gargalo do funil de um post (função pura): comentários → respondeu a DM → vídeo enviado → clique → compra.
 * - Tráfego: poucos comentários (menos de 20; ou, com as views, menos de 3 comentários por mil views).
 * - Conversa: a passagem com a menor taxa em relação à referência (resposta 35 %, vídeo 90 %, clique 25 %), entre as
 *   que têm pelo menos 10 pessoas na entrada.
 * - Página: a compra (5 % dos cliques) é a pior passagem.
 * Nenhuma passagem abaixo da referência: «nenhum» (o próximo passo é mais tráfego). Com 20 comentários a resposta sempre é
 * julgada; as outras passagens só com 10 pessoas na entrada.
 */
export function gargaloFunil(n: FunilNumeros): Gargalo {
  const R = REFERENCIAS_FUNIL;
  const c = Math.max(0, n.comentarios || 0), r = Math.max(0, n.responderam || 0), v = Math.max(0, n.videos || 0);
  const k = Math.max(0, n.cliques || 0), p = Math.max(0, n.compras || 0);
  const taxas = { resposta: taxa(r, c), video: taxa(v, r), clique: taxa(k, v), compra: taxa(p, k) };
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  if (!c) return { etapa: "comentarios", tipo: "trafego", frase: "Ninguém comentou a palavra ainda: o gargalo é o tráfego (o Reel precisa chegar a mais gente ou a chamada «comenta» precisa ficar mais clara).", taxas };
  const views = typeof n.views === "number" && n.views > 0 ? n.views : null;
  if (views && (c / views) * 1000 < R.comentariosPorMilViews) {
    return { etapa: "comentarios", tipo: "trafego", frase: `Só ${c} comentários em ${views} views (menos de ${R.comentariosPorMilViews} por mil): o gargalo é o tráfego — a chamada para comentar não está pegando.`, taxas };
  }
  if (c < R.minimoComentarios) {
    return { etapa: "comentarios", tipo: "trafego", frase: `Só ${c} ${c === 1 ? "pessoa comentou" : "pessoas comentaram"} a palavra: o gargalo é o tráfego. Com ${R.minimoComentarios} comentários dá para julgar a conversa.`, taxas };
  }
  const passos: Array<{ etapa: Gargalo["etapa"]; tipo: Gargalo["tipo"]; base: number; valor: number | null; ref: number; frase: (x: number) => string }> = [
    { etapa: "resposta", tipo: "conversa", base: c, valor: taxas.resposta, ref: R.resposta, frase: (x) => `Só ${pct(x)} de quem comentou respondeu a pergunta da DM (a referência é ${pct(R.resposta)}): o gargalo é a conversa — a 1ª mensagem precisa soar mais pessoal.` },
    { etapa: "video", tipo: "conversa", base: r, valor: taxas.video, ref: R.video, frase: (x) => `Só ${pct(x)} de quem respondeu recebeu o vídeo: falta o vídeo geral ou as palavras não casam com o que as pessoas escrevem.` },
    { etapa: "clique", tipo: "conversa", base: v, valor: taxas.clique, ref: R.clique, frase: (x) => `Só ${pct(x)} de quem recebeu o vídeo tocou no link (a referência é ${pct(R.clique)}): o gargalo é a conversa — o vídeo precisa responder a dúvida e convidar para o próximo passo.` },
    { etapa: "compra", tipo: "pagina", base: k, valor: taxas.compra, ref: R.compra, frase: (x) => `Só ${pct(x)} de quem tocou no link comprou (a referência é ${pct(R.compra)}): o gargalo é a página de venda.` },
  ];
  let pior: { passo: (typeof passos)[number]; nota: number } | null = null;
  for (const passo of passos) {
    if (passo.valor == null || passo.base < R.minimoBase) continue;
    const nota = passo.valor / passo.ref;
    if (nota < 1 && (!pior || nota < pior.nota)) pior = { passo, nota };
  }
  if (pior) return { etapa: pior.passo.etapa, tipo: pior.passo.tipo, frase: pior.passo.frase(pior.passo.valor as number), taxas };
  return { etapa: null, tipo: "nenhum", frase: "Nenhuma passagem abaixo da referência: o próximo passo é mais tráfego (mais Reels com a chamada para comentar).", taxas };
}

/* ------------------------------------------------ o banco ------------------------------------------------ */

let probe: { exists: boolean; checkedAt: number } | null = null;
/** A 0014 foi colada? (a tabela dm_videos e a coluna dm_sequencias.video_chave). O "não" vale 1 min. */
export async function hasDmVideoTables() {
  if (probe && (probe.exists || Date.now() - probe.checkedAt < 60_000)) return probe.exists;
  const { rows } = await query<{ exists: boolean }>(
    `select to_regclass('public.dm_videos') is not null
        and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dm_sequencias' and column_name = 'video_chave') as exists`,
  );
  probe = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
  return probe.exists;
}

export type Escopo = { accountId: string | null; externalRef: string; keyword: string };

/** O escopo pedido: o post (externalRef) ou a palavra (keyword, maiúsculas sem acento). Pelo menos um. */
export function parseEscopo(input: { accountId?: unknown; externalRef?: unknown; keyword?: unknown }): Escopo | { erro: string } {
  const externalRef = textoLimpo(input.externalRef, 200);
  const keyword = normalizar(input.keyword).toUpperCase().replace(/ /g, "").slice(0, 40);
  if (!externalRef && !keyword) return { erro: "Mande o externalRef do post ou a keyword (a palavra que a pessoa comenta)." };
  const accountId = typeof input.accountId === "string" && /^[0-9a-f-]{36}$/i.test(input.accountId) ? input.accountId : null;
  return { accountId, externalRef, keyword: externalRef ? "" : keyword };
}

type VideoRow = { chave: string; titulo: string; palavras: string[]; geral: boolean; texto: string; video_url: string; tamanho: string | null; duracao_seg: number | null; ordem: number };
const deLinha = (row: VideoRow): DmVideo => ({
  chave: row.chave, titulo: row.titulo, palavras: row.palavras ?? [], geral: row.geral, texto: row.texto, videoUrl: row.video_url,
  tamanho: row.tamanho == null ? null : Number(row.tamanho), duracaoSeg: row.duracao_seg, ordem: row.ordem,
});

/** Troca os vídeos do escopo pelos da lista (os que saíram da lista são apagados). Sem a 0014: false. */
export async function salvarVideos(escopo: Escopo, videos: DmVideo[]) {
  if (!(await hasDmVideoTables())) return false;
  const conta = escopo.accountId ?? "";
  await transaction(async (client) => {
    await client.query(
      `delete from public.dm_videos where coalesce(account_id::text, '') = $1 and external_ref = $2 and keyword = $3 and not (chave = any($4::text[]))`,
      [conta, escopo.externalRef, escopo.keyword, videos.map((v) => v.chave)],
    );
    for (const v of videos) {
      await client.query(
        `insert into public.dm_videos (account_id, external_ref, keyword, chave, titulo, palavras, geral, texto, video_url, r2_key, tamanho, duracao_seg, ordem)
         values ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11, $12, $13)
         on conflict (coalesce(account_id::text, ''), external_ref, keyword, chave) do update
           set titulo = excluded.titulo, palavras = excluded.palavras, geral = excluded.geral, texto = excluded.texto,
               video_url = excluded.video_url, r2_key = excluded.r2_key, tamanho = excluded.tamanho, duracao_seg = excluded.duracao_seg,
               ordem = excluded.ordem, atualizado_em = now()`,
        [escopo.accountId, escopo.externalRef, escopo.keyword, v.chave, v.titulo, v.palavras, v.geral, v.texto, v.videoUrl, chaveDoR2(v.videoUrl), v.tamanho, v.duracaoSeg, v.ordem],
      );
    }
  });
  return true;
}

/** A chave do R2 a partir do endereço público (só na pasta dos vídeos de resposta), para a limpeza saber o que é dela. */
function chaveDoR2(url: string) {
  const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!base || !url.startsWith(`${base}/`)) return null;
  const key = decodeURIComponent(url.slice(base.length + 1).split("?")[0]);
  return key.startsWith(`uaiflow/${DMVIDEOS_FOLDER}/`) ? key : null;
}

/** Os vídeos de um escopo, na ordem. Sem a 0014: null. */
export async function listarVideos(escopo: Escopo): Promise<DmVideo[] | null> {
  if (!(await hasDmVideoTables())) return null;
  const { rows } = await query<VideoRow>(
    `select chave, titulo, palavras, geral, texto, video_url, tamanho, duracao_seg, ordem from public.dm_videos
     where external_ref = $1 and keyword = $2 and ($3::uuid is null or account_id is null or account_id = $3::uuid)
     order by ordem, chave`,
    [escopo.externalRef, escopo.keyword, escopo.accountId],
  );
  return rows.map(deLinha);
}

/**
 * Os vídeos de uma automação (o post publicado que a criou): primeiro os do post (externalRef); se o post não tem, os da
 * palavra-chave do post. Sem a 0014 ou sem vídeos: [].
 */
export async function videosDaAutomacao(automation: { id: string; account_id: string | null }): Promise<DmVideo[]> {
  if (!(await hasDmVideoTables())) return [];
  const { rows: posts } = await query<{ external_ref: string | null; keyword: string | null }>(
    `select external_ref, keyword from public.content_posts where automation_id = $1 order by created_at desc limit 1`,
    [automation.id],
  );
  const post = posts[0];
  const conta = automation.account_id;
  if (post?.external_ref) {
    const doPost = await listarVideos({ accountId: conta, externalRef: post.external_ref, keyword: "" });
    if (doPost?.length) return doPost;
  }
  const palavras = String(post?.keyword ?? "").split(",").map((p) => normalizar(p).toUpperCase().replace(/ /g, "")).filter(Boolean);
  for (const keyword of palavras) {
    const daPalavra = await listarVideos({ accountId: conta, externalRef: "", keyword });
    if (daPalavra?.length) return daPalavra;
  }
  return [];
}

/* ------------------------------------------------ o funil por post ------------------------------------------------ */

export type FunilPost = FunilNumeros & {
  ref: string;
  comSinalDeVisto: number;
  porVideo: Array<{ chave: string; enviados: number; cliques: number }>;
  gargalo: Gargalo;
};

/**
 * O funil de cada post do Molde (externalRef): comentários (pessoas que comentaram a palavra e receberam a 1ª DM),
 * responderam, vídeo enviado, clique no link (o toque no link da DM com a chave da pessoa) e compra (as vendas aprovadas
 * cuja origem é o post, da 0012). `views` (opcional, mesma ordem dos refs) entra só na conta do gargalo.
 * Sem a 0012 (sem dm_sequencias): os comentários vêm das DMs disparadas e o resto fica 0.
 */
export async function funilPorRefs(refs: string[], compras: Map<string, number>, views: Map<string, number> = new Map()): Promise<FunilPost[]> {
  if (!refs.length) return [];
  const { rows } = await query<{ ref: string; ids: string[] }>(
    `select external_ref as ref, array_agg(distinct automation_id) as ids from public.content_posts
     where external_ref = any($1::text[]) and automation_id is not null group by external_ref`,
    [refs],
  );
  const ids = [...new Set(rows.flatMap((row) => row.ids))];
  const temSeq = (await query<{ ok: boolean }>("select to_regclass('public.dm_sequencias') is not null as ok")).rows[0]?.ok === true;
  const temVideo = temSeq && (await hasDmVideoTables());
  const seq = new Map<string, { comentarios: number; responderam: number; cliques: number; sinal: number }>();
  const enviados = new Map<string, number>();
  const porVideo = new Map<string, Array<{ chave: string; enviados: number; cliques: number }>>();
  const disparadas = new Map<string, number>();
  if (ids.length && temSeq) {
    const { rows: s } = await query<{ automation_id: string; pessoas: string; responderam: string; cliques: string }>(
      `select automation_id, count(*) as pessoas, count(*) filter (where respondeu_em is not null) as responderam,
              count(*) filter (where clicou_em is not null) as cliques
       from public.dm_sequencias where automation_id = any($1::uuid[]) group by automation_id`,
      [ids],
    );
    for (const row of s) seq.set(row.automation_id, { comentarios: Number(row.pessoas), responderam: Number(row.responderam), cliques: Number(row.cliques), sinal: 0 });
  }
  if (ids.length && temVideo) {
    // vídeo enviado = o envio do vídeo saiu (status sent); uma pessoa conta uma vez
    const { rows: v } = await query<{ automation_id: string; chave: string; enviados: string; cliques: string; sinal: string }>(
      `select q.automation_id, coalesce(q.payload ->> 'videoChave', '') as chave, count(distinct q.contact_id) as enviados,
              count(distinct q.contact_id) filter (where s.clicou_em is not null) as cliques,
              count(distinct q.contact_id) filter (where s.clicou_em > q.sent_at or s.respondeu_depois_em > q.sent_at) as sinal
       from public.queue q
       left join public.dm_sequencias s on s.automation_id = q.automation_id and s.contact_id = q.contact_id
       where q.automation_id = any($1::uuid[]) and q.status = 'sent' and q.payload ->> 'origem' = 'sequencia_dm' and q.payload ->> 'passo' = $2
       group by q.automation_id, coalesce(q.payload ->> 'videoChave', '')`,
      [ids, PASSO_VIDEO],
    );
    for (const row of v) {
      enviados.set(row.automation_id, (enviados.get(row.automation_id) ?? 0) + Number(row.enviados));
      const atual = seq.get(row.automation_id);
      if (atual) atual.sinal += Number(row.sinal);
      const lista = porVideo.get(row.automation_id) ?? [];
      lista.push({ chave: row.chave, enviados: Number(row.enviados), cliques: Number(row.cliques) });
      porVideo.set(row.automation_id, lista);
    }
  }
  if (ids.length && !temSeq) {
    const { rows: d } = await query<{ automation_id: string; n: string }>(
      `select automation_id, count(*) as n from public.queue where automation_id = any($1::uuid[]) and send_type = 'private_reply' and status = 'sent' group by automation_id`,
      [ids],
    );
    for (const row of d) disparadas.set(row.automation_id, Number(row.n));
  }
  return refs.map((ref) => {
    const daRef = rows.find((row) => row.ref === ref)?.ids ?? [];
    const soma = (f: (id: string) => number) => daRef.reduce((t, id) => t + f(id), 0);
    const numeros: FunilNumeros = {
      comentarios: temSeq ? soma((id) => seq.get(id)?.comentarios ?? 0) : soma((id) => disparadas.get(id) ?? 0),
      responderam: soma((id) => seq.get(id)?.responderam ?? 0),
      videos: soma((id) => enviados.get(id) ?? 0),
      cliques: soma((id) => seq.get(id)?.cliques ?? 0),
      compras: compras.get(ref) ?? 0,
      views: views.get(ref) ?? null,
    };
    const juntos = new Map<string, { chave: string; enviados: number; cliques: number }>();
    for (const id of daRef) for (const x of porVideo.get(id) ?? []) {
      const j = juntos.get(x.chave) ?? { chave: x.chave, enviados: 0, cliques: 0 };
      j.enviados += x.enviados; j.cliques += x.cliques; juntos.set(x.chave, j);
    }
    return { ref, ...numeros, comSinalDeVisto: soma((id) => seq.get(id)?.sinal ?? 0), porVideo: [...juntos.values()], gargalo: gargaloFunil(numeros) };
  });
}

/* ------------------------------------------------ o aviso no Telegram ------------------------------------------------ */

type AlertaRow = { id: string; username: string | null; resposta: string | null; titulo: string | null; chave: string; sai_em: Date | null; post: string | null };

/**
 * Ex.: «UaiFlow · DM com vídeo: @maria respondeu no post «Durma em 10 min»: "acordo toda noite às 3h". Vai o vídeo «Acorda de
 *       madrugada» às 21:43 (horário de Brasília), sozinho. Se quiser, escreva para ela antes pelo Instagram: o vídeo e o link
 *       saem do mesmo jeito.»
 */
export function alertaTexto(row: Pick<AlertaRow, "username" | "resposta" | "titulo" | "chave" | "sai_em" | "post">) {
  const quem = row.username ? `@${row.username}` : "Uma pessoa";
  const onde = row.post ? ` no post «${row.post}»` : "";
  const quando = row.sai_em ? ` às ${formatSaoPauloTime(new Date(row.sai_em))} (horário de Brasília)` : "";
  return [
    `UaiFlow · DM com vídeo: ${quem} respondeu${onde}: "${String(row.resposta ?? "").slice(0, 300)}".`,
    `Vai o vídeo «${row.titulo || row.chave}»${quando}, sozinho (a resposta chega em até 15 min).`,
    "Se quiser, escreva para ela antes pelo Instagram: o vídeo e o link saem do mesmo jeito.",
  ].join("\n");
}

/**
 * Roda no relógio (a cada minuto): um aviso no Telegram por pessoa que respondeu a DM de um post em modo vídeo, uma vez só
 * (dm_sequencias.alerta_em). Só as respostas da última hora. Sem Telegram, sem a 0014 ou sem tempo: não faz nada. Nunca lança.
 */
export async function avisarRespostasVideo(options: { deadline?: number } = {}): Promise<{ sent: number; skipped?: string }> {
  if (!isTelegramConfigured()) return { sent: 0, skipped: "sem_telegram" };
  try {
    if (!(await hasDmVideoTables())) return { sent: 0, skipped: "sem_migracao" };
    const deadline = options.deadline ?? Date.now() + TELEGRAM_TIMEOUT_MS + 1000;
    const { rows } = await query<AlertaRow>(
      `select s.id, c.instagram_username as username, s.resposta_texto as resposta, v.titulo, s.video_chave as chave, s.video_sai_em as sai_em,
              (select coalesce(nullif(p.title, ''), left(p.caption, 60)) from public.content_posts p where p.automation_id = s.automation_id order by p.created_at desc limit 1) as post
       from public.dm_sequencias s
       join public.contacts c on c.id = s.contact_id
       left join lateral (select d.titulo from public.dm_videos d where d.chave = s.video_chave order by (d.account_id = s.account_id) desc nulls last limit 1) v on true
       where s.video_chave is not null and s.alerta_em is null and s.respondeu_em > now() - interval '1 hour'
       order by s.respondeu_em asc limit 10`,
    );
    let sent = 0;
    for (const row of rows) {
      const timeoutMs = Math.min(TELEGRAM_TIMEOUT_MS, deadline - Date.now() - 300);
      if (timeoutMs < 500) return { sent, skipped: "sem_tempo" };
      const result = await sendTelegram(alertaTexto(row), { timeoutMs });
      if (!result.ok) continue; // tenta de novo no próximo minuto
      await query("update public.dm_sequencias set alerta_em = now() where id = $1", [row.id]);
      sent += 1;
    }
    return { sent };
  } catch (error) {
    console.error("[dm-video] não consegui avisar as respostas:", error instanceof Error ? error.message : error);
    return { sent: 0, skipped: "erro" };
  }
}
