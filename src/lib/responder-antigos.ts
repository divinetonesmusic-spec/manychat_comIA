import { query } from "@/lib/db/client";
import {
  automationMatches,
  automationPostIds,
  getAutomation,
  getInstagramAccountById,
  getProfileSettings,
  type Automation,
  type InstagramAccount,
} from "@/lib/db/repositories";
import { runCommentAutomations } from "@/lib/comment-automation";
import { GRAPH_BASE_URL } from "@/lib/env";
import { graphFetch, isMetaRateLimit, MetaApiError, withMetaDeadline } from "@/lib/instagram/client";
import { formatSaoPauloTime } from "@/lib/time";

/**
 * «Responder quem já comentou neste post» (comentários que chegaram antes de a automação existir).
 *
 * 1. Simular (nada sai): lê os comentários do post na Meta (GET /{media-id}/comments, 50 por página, e as respostas),
 *    escolhe os que combinam com a palavra-chave da automação (a MESMA regra do webhook: automationMatches) e conta:
 *    lidos, que combinam, já respondidos, mesma pessoa de novo, mais de 7 dias (a Meta não deixa) e para mandar agora.
 * 2. Confirmar: cada comentário escolhido passa pelo MESMO caminho do webhook (runCommentAutomations: resposta privada,
 *    resposta pública e o fluxo), com horário espaçado no ritmo de 200 por hora. A fila (drain.ts) continua segurando o
 *    limite de 200 por hora do perfil.
 *
 * Nunca manda duas vezes: cada comentário tem uma «marca» no banco (public.events, «responder-antigos:<id do comentário>»,
 * índice único por perfil) gravada antes de entrar na fila; quem já tem resposta na fila para o comentário, ou já recebeu
 * esta automação, é pulado. Rodar de novo mais tarde pega só o que faltou.
 *
 * Sem migração: o andamento fica em public.app_status (chave «responder_antigos:<automação>:<post>») e a lista de quem
 * vai receber em pedaços («responder_antigos_parte:…»). Cada chamada trabalha no máximo uns 7 s (limite do Netlify) e o
 * relógio de cada minuto continua sozinho o que ficou pela metade (inclusive com a página fechada).
 */

export const LIMITE_POR_HORA = 200;
export const ORIGEM_RESPONDER_ANTIGOS = "responder_antigos";
const SETE_DIAS_MS = 7 * 24 * 3600 * 1000;
/** Folga antes dos 7 dias (a mesma da fila, em markExpiredDmsSkipped). */
const MARGEM_MS = 10 * 60 * 1000;
const INTERVALO_MS = Math.round(3600_000 / LIMITE_POR_HORA); // 18 s entre uma pessoa e a próxima
const PARTE_MAX = 500;
const PAGINAS_DE_POSTS_MAX = 40; // 2.000 posts do perfil, no máximo, para achar o link
const POSSE_MS = 40_000;
/** Comentários por página. Num Reel viral (milhares de comentários, com as respostas junto) 50 por página pode passar do
 * prazo: cada vez que a Meta demora, a página seguinte pede a metade, até 10. */
const LIMITE_PAGINA = 50;
const LIMITE_PAGINA_MIN = 10;
/** Tentativas seguidas sem ler nada (a Meta demorando ou falhando) até a contagem parar com erro visível. */
const TENTATIVAS_MAX = 6;
const ESPERA_META_MS = 15 * 60_000;
const CAMPOS = "id,text,timestamp,from,username";
const CHAVE = "responder_antigos:";
const CHAVE_PARTE = "responder_antigos_parte:";
const MARCA = "responder-antigos:";

export type EstadoResponder = "lendo" | "pronto" | "enviando" | "concluido" | "erro";
/** [id do comentário, id de quem comentou, @, quando comentou (ms)] */
type Candidato = [string, string, string | null, number];

export type JobResponder = {
  versao: 1;
  accountId: string;
  automationId: string;
  mediaId: string;
  permalink: string | null;
  estado: EstadoResponder;
  /** Página seguinte dos comentários (cursor «after» da Meta); «fim» = acabou. */
  cursor: string | null;
  /** Comentários com mais respostas do que vieram junto (ainda a ler por /{id}/replies): «<id> <cursor>». */
  respostasPendentes: string[];
  respostasCursor: string | null;
  lidos: number;
  combinam: number;
  jaRespondidos: number;
  repetidos: number;
  velhos: number;
  semTempo: number;
  paraEnviar: number;
  enfileirados: number;
  /** Pulados no envio (alguém respondeu nesse meio-tempo, ou o prazo de 7 dias venceu antes da vez). */
  puladosNoEnvio: number;
  partes: number;
  envioParte: number;
  envioPos: number;
  pessoas: string[];
  /** Próximo horário livre no ritmo de 200 por hora (ISO). Continua valendo numa rodada nova. */
  proximoHorario: string | null;
  iniciadoEm: string;
  confirmadoEm: string | null;
  concluidoEm: string | null;
  esperarAte: string | null;
  erro: string | null;
  posse: string | null;
  /** Comentários por página na próxima leitura (cai pela metade quando a Meta demora). */
  limite?: number;
  /** Passos seguidos sem avançar (erro ou demora da Meta). Ao chegar em TENTATIVAS_MAX, a contagem para com erro. */
  semAvanco?: number;
  /** A última leitura na Meta (para ver o que está acontecendo sem abrir os logs). */
  leitura?: Leitura | null;
  /** Páginas que a Meta devolveu sem nenhum comentário (mas com «próxima página»). */
  paginasVazias?: number;
  /** Sem as respostas junto (replies{…}): quando a sonda mostrou que só assim a Meta devolve os comentários. */
  semRespostas?: boolean;
  /** O que a sonda viu na 1ª página vazia: o total de comentários do post e quantos vêm com menos campos. */
  sonda?: Sonda | null;
};

type Sonda = { em: string; total: number | null; completo: number; semRespostas: number; soId: number; erro: string | null };

type Leitura = { em: string; ms: number; limite: number; itens: number; proxima: boolean; erro: string | null };

export class ResponderErro extends Error {
  constructor(message: string, readonly status = 400, readonly dados?: Record<string, unknown>) {
    super(message);
  }
}

type ComentarioMeta = {
  id?: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: { id?: string; username?: string };
  replies?: { data?: ComentarioMeta[]; paging?: Paginacao };
};
type Paginacao = { cursors?: { after?: string }; next?: string };

// ---------------------------------------------------------------------------------------------------------------------
// Entrada pública (as rotas e o relógio usam só estas)

export type PedidoResponder = { automationId: string; accountId?: string | null; post: string; novo?: boolean };

/** Simular (GET): começa ou continua a contagem. Nada é mandado. */
export async function simular(pedido: PedidoResponder, orcamentoMs = 7000) {
  const deadline = Date.now() + orcamentoMs;
  const { job, chave, automation, account } = await abrir(pedido, deadline);
  const atual = job.estado === "lendo" ? await passo(chave, deadline, { automation, account }) ?? job : job;
  return vista(atual, await contarEnvios(atual));
}

/** Confirmar (POST): só depois da contagem pronta, com o mesmo número que o dono viu. Continua o envio se já começou. */
export async function confirmar(pedido: PedidoResponder & { paraEnviar?: unknown }, orcamentoMs = 7000) {
  const deadline = Date.now() + orcamentoMs;
  const { job, chave, automation, account } = await abrir({ ...pedido, novo: false }, deadline);
  if (job.estado === "lendo") throw new ResponderErro("Ainda estou contando os comentários. Espere a contagem terminar.", 409, { data: vista(job, null) });
  if (job.estado === "erro") throw new ResponderErro(job.erro || "A contagem parou com erro. Conte de novo.", 409, { data: vista(job, null) });
  if (job.estado === "pronto") {
    if (Number(pedido.paraEnviar) !== job.paraEnviar) {
      throw new ResponderErro(`A contagem mudou: agora são ${job.paraEnviar} pessoas. Confira os números e confirme de novo.`, 409, { data: vista(job, null) });
    }
    if (job.paraEnviar === 0) {
      const fim = await salvarSe(chave, job, (j) => ({ ...j, estado: "concluido", confirmadoEm: agoraIso(), concluidoEm: agoraIso() }));
      return vista(fim ?? job, await contarEnvios(job));
    }
    const confirmado = await salvarSe(chave, job, (j) => (j.estado === "pronto" ? { ...j, estado: "enviando", confirmadoEm: agoraIso() } : j));
    if (!confirmado) throw new ResponderErro("Outro pedido está mexendo nisto agora. Tente de novo em alguns segundos.", 409);
  }
  const depois = (await passo(chave, deadline, { automation, account })) ?? (await lerJob(chave)) ?? job;
  return vista(depois, await contarEnvios(depois));
}

/** Relógio (a cada minuto): continua a contagem ou o envio que ficou pela metade. Nunca lança erro. */
export async function runResponderAntigosClock(options: { deadline: number }) {
  const out = { passos: 0 };
  try {
    if (options.deadline - Date.now() < 2500) return out;
    const { rows } = await query<{ chave: string }>(
      `select chave from public.app_status
       where chave like 'responder\\_antigos:%'
         and valor ->> 'estado' in ('lendo', 'enviando')
       order by atualizado_em asc
       limit 3`,
    );
    for (const { chave } of rows) {
      if (options.deadline - Date.now() < 2500) break;
      const feito = await passo(chave, options.deadline - 500).catch((error) => {
        console.error("[responder-antigos] relógio:", error instanceof Error ? error.message : error);
        return null;
      });
      if (feito) out.passos += 1;
    }
  } catch (error) {
    // Sem a app_status (0004) ou banco lento: fica para o próximo minuto.
    console.error("[responder-antigos] relógio:", error instanceof Error ? error.message : error);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Abrir: automação, perfil, post e o andamento guardado

async function abrir(pedido: PedidoResponder, deadline: number) {
  const automation = await getAutomation(pedido.automationId, pedido.accountId || null);
  if (!automation) throw new ResponderErro("Automação não encontrada.", 404);
  const account = await getInstagramAccountById(automation.account_id);
  if (!account) throw new ResponderErro("O Instagram desta automação não está conectado.", 400);
  conferirAutomacao(automation);
  const settings = await getProfileSettings(account.id);
  if (!settings.channel_active) throw new ResponderErro("As automações deste perfil estão pausadas. Ligue o canal antes de responder.", 400);

  const post = await postGuardado(automation.id, pedido) ?? (await resolverPost(account, pedido.post, deadline));
  const postIds = automationPostIds(automation);
  if (postIds.length && !postIds.includes(post.mediaId)) {
    throw new ResponderErro("Esta automação não está ligada a este post. Escolha o post na automação (ou use outro link).", 400);
  }

  const chave = `${CHAVE}${automation.id}:${post.mediaId}`;
  let job = await lerJob(chave);
  if (!job || (pedido.novo && (job.estado === "lendo" ? semProgresso(job) : job.estado !== "enviando"))) {
    job = await comecar(chave, account, automation, post, job);
  }
  return { job, chave, automation, account };
}

/** Contagem «lendo» que não leu nada: pode recomeçar com novo=1 (antes ficava presa para sempre). */
function semProgresso(job: JobResponder) {
  return job.lidos === 0 && !job.partes && !job.respostasPendentes?.length;
}

/** Id da mídia (só números) que já tem contagem guardada: não precisa perguntar à Meta de novo a cada chamada. */
async function postGuardado(automationId: string, pedido: PedidoResponder) {
  const valor = String(pedido.post || "").trim();
  if (pedido.novo || !/^\d{6,30}$/.test(valor)) return null;
  const job = await lerJob(`${CHAVE}${automationId}:${valor}`);
  return job ? { mediaId: job.mediaId, permalink: job.permalink } : null;
}

function conferirAutomacao(automation: Automation) {
  if (!automation.active) throw new ResponderErro("Esta automação está desligada. Ligue «Ativo» e salve antes de responder.", 400);
  if (!automation.triggers.includes("comments")) throw new ResponderErro("Esta automação não responde comentários.", 400);
  if (automation.match_type !== "any" && !automation.keywords.some((k) => k.trim())) {
    throw new ResponderErro("Esta automação não tem palavra-chave.", 400);
  }
}

async function comecar(chave: string, account: InstagramAccount, automation: Automation, post: { mediaId: string; permalink: string | null }, antigo: JobResponder | null) {
  await query("delete from public.app_status where chave like $1", [`${CHAVE_PARTE}${chave.slice(CHAVE.length)}:%`]);
  const job: JobResponder = {
    versao: 1,
    accountId: account.id,
    automationId: automation.id,
    mediaId: post.mediaId,
    permalink: post.permalink,
    estado: "lendo",
    cursor: null,
    respostasPendentes: [],
    respostasCursor: null,
    lidos: 0,
    combinam: 0,
    jaRespondidos: 0,
    repetidos: 0,
    velhos: 0,
    semTempo: 0,
    paraEnviar: 0,
    enfileirados: 0,
    puladosNoEnvio: 0,
    partes: 0,
    envioParte: 0,
    envioPos: 0,
    pessoas: [],
    proximoHorario: antigo?.proximoHorario ?? null,
    iniciadoEm: agoraIso(),
    confirmadoEm: null,
    concluidoEm: null,
    esperarAte: null,
    erro: null,
    posse: null,
    limite: LIMITE_PAGINA,
    semAvanco: 0,
    leitura: null,
  };
  await query(
    `insert into public.app_status (chave, valor, atualizado_em) values ($1, $2, now())
     on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
    [chave, JSON.stringify(job)],
  );
  return job;
}

/** O link do Reel/post (ou o id da mídia) → o id da mídia na Meta, procurando nos posts do perfil. */
export async function resolverPost(account: InstagramAccount, entrada: string, deadline: number) {
  const valor = String(entrada || "").trim();
  if (!valor) throw new ResponderErro("Cole o link do Reel ou do post (ou o id da mídia).", 400);
  if (/^\d{6,30}$/.test(valor)) {
    const media = await chamarMeta(deadline, () => {
      const url = new URL(`${GRAPH_BASE_URL}/${valor}`);
      url.searchParams.set("fields", "id,permalink");
      return graphFetch<{ id?: string; permalink?: string }>(url, account.instagram_access_token);
    }).catch((error) => {
      throw new ResponderErro(`Não achei esse post neste perfil (${mensagemMeta(error)}).`, 400);
    });
    return { mediaId: String(media.id || valor), permalink: media.permalink ?? null };
  }

  const codigo = codigoDoLink(valor);
  if (!codigo) throw new ResponderErro("Esse link não parece de um post ou Reel do Instagram (ex.: https://www.instagram.com/reel/ABC123/).", 400);
  let after: string | null = null;
  for (let pagina = 0; pagina < PAGINAS_DE_POSTS_MAX; pagina += 1) {
    if (deadline - Date.now() < 1000) throw new ResponderErro("A Meta está lenta para listar os posts. Tente de novo, ou cole o id da mídia.", 503);
    const resposta = await chamarMeta(deadline, () => {
      const url = new URL(`${GRAPH_BASE_URL}/${account.instagram_user_id}/media`);
      url.searchParams.set("fields", "id,permalink,timestamp");
      url.searchParams.set("limit", "50");
      if (after) url.searchParams.set("after", after);
      return graphFetch<{ data?: Array<{ id: string; permalink?: string }>; paging?: Paginacao }>(url, account.instagram_access_token);
    });
    const achado = (resposta.data ?? []).find((m) => m.permalink && codigoDoLink(m.permalink) === codigo);
    if (achado) return { mediaId: achado.id, permalink: achado.permalink ?? null };
    after = resposta.paging?.next ? resposta.paging.cursors?.after ?? null : null;
    if (!after) break;
  }
  throw new ResponderErro("Não achei esse post nos posts deste perfil. Confira se o link é deste Instagram.", 404);
}

/** O código do post no link (…/reel/ABC123/ ou …/p/ABC123/). */
export function codigoDoLink(link: string) {
  const achado = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(link);
  return achado ? achado[1] : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Um passo (contar ou enviar), com posse: só um pedido por vez mexe no mesmo trabalho

async function passo(chave: string, deadline: number, contexto?: { automation: Automation; account: InstagramAccount }) {
  const posse = await pegarPosse(chave);
  if (!posse) return null;
  let job = posse;
  const comeco = Date.now();
  try {
    if (job.esperarAte && Date.parse(job.esperarAte) > Date.now()) return await soltar(chave, job);
    const automation = contexto?.automation ?? (await getAutomation(job.automationId, job.accountId));
    const account = contexto?.account ?? (await getInstagramAccountById(job.accountId));
    if (!automation || !account) {
      return await soltar(chave, { ...job, estado: "erro", erro: "A automação ou o perfil não existem mais." });
    }
    if (job.estado === "lendo") job = await contar(chave, job, account, automation, deadline);
    else if (job.estado === "enviando") {
      // Desligou a automação no meio: para de pôr gente na fila (o que já entrou segue a regra da fila).
      if (!automation.active) return await soltar(chave, { ...job, erro: "A automação foi desligada: o envio está parado. Ligue de novo para continuar." });
      job = await enviar(chave, { ...job, erro: null }, account, automation, deadline);
    }
    registrar(chave, job, comeco, null);
    return await soltar(chave, job);
  } catch (error) {
    // Nunca engole o erro: ele fica no job.erro (a tela, o Molde e o GET mostram) e nos logs da função; a posse é solta.
    // O que `contar` já tinha lido antes do erro vem junto (ErroNoMeio), para não perder nem contar duas vezes.
    const base = error instanceof ErroNoMeio ? error.job : job;
    const causa = error instanceof ErroNoMeio ? error.causa : error;
    registrar(chave, base, comeco, causa);
    const lendo = base.estado === "lendo";
    if (isMetaRateLimit(causa)) {
      // Esperar não conta como tentativa perdida: a Meta disse quando voltar.
      const ate = new Date(Date.now() + ESPERA_META_MS);
      return await soltar(chave, { ...base, esperarAte: ate.toISOString(), erro: `A Meta pediu para esperar. Continuo sozinho às ${formatSaoPauloTime(ate)}.` });
    }
    const falhas = (base.semAvanco ?? 0) + 1;
    const desistir = lendo && falhas >= TENTATIVAS_MAX;
    const fim = (erro: string) =>
      soltar(chave, {
        ...base,
        semAvanco: falhas,
        estado: desistir ? "erro" : base.estado,
        erro: desistir ? `A contagem parou depois de ${falhas} tentativas seguidas sem conseguir ler. Último erro: ${erro} Conte de novo (novo=1).` : erro,
      });
    if (causa instanceof MetaApiError && causa.temporary) {
      return await fim(`A Meta demorou para responder (${mensagemMeta(causa)}). Continuo sozinho no próximo minuto.`);
    }
    if (causa instanceof MetaApiError) {
      return await soltar(chave, { ...base, estado: lendo ? "erro" : base.estado, erro: `A Meta recusou: ${mensagemMeta(causa)}` });
    }
    return await fim(`Erro inesperado: ${causa instanceof Error ? causa.message : String(causa)}.`);
  }
}

/** Uma linha por passo nos logs do Netlify (Functions → Next.js Server Handler, filtro «responder-antigos»). */
function registrar(chave: string, job: JobResponder, comeco: number, erro: unknown) {
  const linha = `[responder-antigos] ${chave} estado=${job.estado} lidos=${job.lidos} combinam=${job.combinam} paraEnviar=${job.paraEnviar} ms=${Date.now() - comeco} leitura=${JSON.stringify(job.leitura ?? null)}`;
  if (erro) console.error(`${linha} erro=${erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro)}`);
  else console.info(linha);
}

/** Erro no meio da contagem, levando o que já foi lido (o job até a última página que deu certo). */
class ErroNoMeio extends Error {
  constructor(readonly job: JobResponder, readonly causa: unknown) {
    super(causa instanceof Error ? causa.message : String(causa));
  }
}

async function pegarPosse(chave: string): Promise<JobResponder | null> {
  const ate = new Date(Date.now() + POSSE_MS).toISOString();
  const { rows } = await query<{ valor: JobResponder }>(
    `update public.app_status
     set valor = jsonb_set(valor, '{posse}', to_jsonb($2::text)), atualizado_em = now()
     where chave = $1
       and (valor ->> 'posse' is null or (valor ->> 'posse')::timestamptz < now())
     returning valor`,
    [chave, ate],
  );
  return rows[0]?.valor ?? null;
}

/**
 * Grava e solta a posse — só se a posse ainda for a nossa. Um pedido que passou dos 40 s (ou uma contagem recomeçada com
 * novo=1 no meio) não sobrescreve o que o dono da posse nova gravou.
 */
async function soltar(chave: string, job: JobResponder) {
  const livre = { ...job, posse: null };
  if (!job.posse) {
    await query("update public.app_status set valor = $2, atualizado_em = now() where chave = $1", [chave, JSON.stringify(livre)]);
    return livre;
  }
  const { rows } = await query<{ valor: JobResponder }>(
    `update public.app_status set valor = $2, atualizado_em = now()
     where chave = $1 and valor ->> 'posse' = $3
     returning valor`,
    [chave, JSON.stringify(livre), job.posse],
  );
  if (rows[0]) return livre;
  return (await lerJob(chave)) ?? livre;
}

/** Muda o trabalho só se ninguém estiver com a posse (para a confirmação não brigar com o relógio). */
async function salvarSe(chave: string, job: JobResponder, mudar: (job: JobResponder) => JobResponder) {
  const posse = await pegarPosse(chave);
  if (!posse) return null;
  if (posse.estado !== job.estado) return soltar(chave, posse);
  return soltar(chave, mudar(posse));
}

async function lerJob(chave: string) {
  const { rows } = await query<{ valor: JobResponder }>("select valor from public.app_status where chave = $1", [chave]);
  return rows[0]?.valor ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Contar (simulação): ler os comentários na Meta e separar quem vai receber

async function contar(chave: string, inicio: JobResponder, account: InstagramAccount, automation: Automation, deadline: number) {
  // O erro anterior continua visível até a leitura avançar de novo (antes era apagado no começo de cada passo).
  let job: JobResponder = { ...inicio, esperarAte: null };
  const novos: Candidato[] = [];
  const pessoas = new Set(job.pessoas);
  let paginas = 0;
  const avancou = () => {
    paginas += 1;
    job.semAvanco = 0;
    job.erro = null;
  };

  try {
    // Pelo menos uma página por passo quando há 1,5 s; as seguintes só com folga (2,5 s) para gravar antes do fim.
    while (deadline - Date.now() > (paginas ? 2500 : 1500)) {
      const limite = job.limite ?? LIMITE_PAGINA;
      if (job.cursor !== "fim") {
        const pagina = await lerNaMeta(job, limite, deadline, () => {
          const url = new URL(`${GRAPH_BASE_URL}/${job.mediaId}/comments`);
          url.searchParams.set("fields", job.semRespostas ? CAMPOS : `${CAMPOS},replies{${CAMPOS}}`);
          url.searchParams.set("limit", String(limite));
          if (job.cursor) url.searchParams.set("after", job.cursor);
          return graphFetch<{ data?: ComentarioMeta[]; paging?: Paginacao }>(url, account.instagram_access_token);
        });
        const lista: ComentarioMeta[] = [];
        const pendentes: string[] = [];
        for (const comentario of pagina.data ?? []) {
          lista.push(comentario);
          for (const resposta of comentario.replies?.data ?? []) lista.push(resposta);
          // Mais respostas do que vieram junto: guarda o comentário e de onde continuar («<id> <cursor>»).
          if (comentario.id && comentario.replies?.paging?.next && comentario.replies.paging.cursors?.after) pendentes.push(`${comentario.id} ${comentario.replies.paging.cursors.after}`);
        }
        job = await separar(job, lista, account, automation, pessoas, novos);
        job.respostasPendentes = [...job.respostasPendentes, ...pendentes];
        const proximo = pagina.paging?.next && pagina.paging.cursors?.after ? pagina.paging.cursors.after : null;
        if (!pagina.data?.length && proximo) {
          job.paginasVazias = (job.paginasVazias ?? 0) + 1;
          // 1ª página vazia: pergunta à Meta de outro jeito (uma vez) para saber se é o pedido ou se ela esconde tudo.
          if (!job.sonda && deadline - Date.now() > 3000) {
            job.sonda = await sondar(job, account, limite, deadline);
            if (!job.semRespostas && !job.sonda.completo && job.sonda.semRespostas > 0) {
              // Sem replies{…} os comentários aparecem: continua sem eles, da mesma página (não avança o cursor).
              job.semRespostas = true;
              avancou();
              continue;
            }
          }
        }
        // A Meta devolvendo o mesmo cursor: acabou (senão ficaria lendo a mesma página para sempre).
        job.cursor = proximo && proximo !== job.cursor ? proximo : "fim";
        avancou();
        continue;
      }
      if (job.respostasPendentes.length) {
        const [pai, cursorInicial] = job.respostasPendentes[0].split(" ");
        const cursor = job.respostasCursor || cursorInicial;
        const pagina = await lerNaMeta(job, limite, deadline, () => {
          const url = new URL(`${GRAPH_BASE_URL}/${pai}/replies`);
          url.searchParams.set("fields", CAMPOS);
          url.searchParams.set("limit", String(limite));
          if (cursor) url.searchParams.set("after", cursor);
          return graphFetch<{ data?: ComentarioMeta[]; paging?: Paginacao }>(url, account.instagram_access_token);
        });
        // Continua depois da 1ª página de respostas (que veio junto com o comentário); se repetir alguma, ela não conta de novo.
        job = await separar(job, pagina.data ?? [], account, automation, pessoas, novos);
        const proximo = pagina.paging?.next ? pagina.paging.cursors?.after ?? null : null;
        job.respostasCursor = proximo && proximo !== cursor ? proximo : null;
        if (!job.respostasCursor) job.respostasPendentes = job.respostasPendentes.slice(1);
        avancou();
        continue;
      }
      // Leu tudo: monta a lista final (do mais antigo para o mais novo) e fecha a contagem.
      job = await guardarParte(chave, job, novos.splice(0));
      job = await fecharContagem(chave, { ...job, pessoas: [...pessoas] });
      return job;
    }
  } catch (error) {
    // Guarda o que já foi lido nas páginas que deram certo e devolve o erro para o passo gravar em job.erro.
    const salvo = await guardarParte(chave, job, novos.splice(0)).catch(() => job);
    throw new ErroNoMeio({ ...salvo, pessoas: [...pessoas] }, error);
  }
  job = await guardarParte(chave, job, novos.splice(0));
  return { ...job, pessoas: [...pessoas] };
}

/** Uma leitura na Meta com o tempo medido (job.leitura). Demorou demais: a próxima página pede a metade. */
async function lerNaMeta<T extends { data?: unknown[]; paging?: Paginacao }>(job: JobResponder, limite: number, deadline: number, fazer: () => Promise<T>) {
  const comeco = Date.now();
  try {
    const pagina = await chamarMeta(deadline, fazer);
    const ms = Date.now() - comeco;
    job.leitura = { em: agoraIso(), ms, limite, itens: pagina.data?.length ?? 0, proxima: Boolean(pagina.paging?.next), erro: null };
    // A Meta voltou a responder rápido: a página volta a crescer (até 50).
    if (ms < 1500 && limite < LIMITE_PAGINA) job.limite = Math.min(LIMITE_PAGINA, limite * 2);
    return pagina;
  } catch (error) {
    job.leitura = { em: agoraIso(), ms: Date.now() - comeco, limite, itens: 0, proxima: false, erro: mensagemMeta(error) };
    if (error instanceof MetaApiError && error.kind === "timeout") job.limite = Math.max(LIMITE_PAGINA_MIN, Math.floor(limite / 2));
    throw error;
  }
}

/** A sonda: o total de comentários do post e a mesma página pedida com e sem as respostas, e só com o id. Nunca lança. */
async function sondar(job: JobResponder, account: InstagramAccount, limite: number, deadline: number): Promise<Sonda> {
  const pedir = async (fields: string) => {
    const url = new URL(`${GRAPH_BASE_URL}/${job.mediaId}/comments`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("limit", String(limite));
    if (job.cursor && job.cursor !== "fim") url.searchParams.set("after", job.cursor);
    const pagina = await chamarMeta(deadline, () => graphFetch<{ data?: unknown[] }>(url, account.instagram_access_token));
    return pagina.data?.length ?? 0;
  };
  const sonda: Sonda = { em: agoraIso(), total: null, completo: 0, semRespostas: 0, soId: 0, erro: null };
  try {
    sonda.semRespostas = await pedir(CAMPOS);
    sonda.soId = await pedir("id");
  } catch (error) {
    sonda.erro = mensagemMeta(error);
  }
  try {
    const media = await chamarMeta(deadline, () => {
      const url = new URL(`${GRAPH_BASE_URL}/${job.mediaId}`);
      url.searchParams.set("fields", "comments_count");
      return graphFetch<{ comments_count?: number }>(url, account.instagram_access_token);
    });
    sonda.total = typeof media.comments_count === "number" ? media.comments_count : null;
  } catch (error) {
    sonda.erro ??= mensagemMeta(error);
  }
  console.info(`[responder-antigos] sonda ${job.mediaId}: ${JSON.stringify(sonda)}`);
  return sonda;
}

/** Uma página de comentários: conta e separa quem combina, quem já foi respondido, repetidos e velhos. */
async function separar(job: JobResponder, lista: ComentarioMeta[], account: InstagramAccount, automation: Automation, pessoas: Set<string>, novos: Candidato[]) {
  const vistos = new Set<string>();
  const unicos = lista.filter((c) => c.id && !vistos.has(c.id) && vistos.add(c.id));
  // As respostas lidas por /{id}/replies podem repetir a 1ª página que veio junto: as que já estão na lista não contam.
  const ja = await jaNaLista(job, unicos.map((c) => String(c.id)));
  const novosComentarios = unicos.filter((c) => !ja.has(String(c.id)) && !novos.some((n) => n[0] === c.id));
  const out = { ...job, lidos: job.lidos + novosComentarios.length };

  const agora = Date.now();
  const combinam = novosComentarios
    .map((c) => ({ id: String(c.id), texto: c.text ?? "", de: c.from?.id ?? null, arroba: c.from?.username ?? c.username ?? null, em: Date.parse(c.timestamp ?? "") }))
    .filter((c) => c.de && c.de !== account.instagram_user_id && c.texto.trim())
    .filter((c) => automationMatches(automation, { accountId: account.id, trigger: "comments", text: c.texto, postId: job.mediaId }));
  if (!combinam.length) return out;
  out.combinam += combinam.length;

  const { comentarios, pessoasRespondidas } = await jaRespondidos(account.id, automation.id, combinam.map((c) => c.id), combinam.map((c) => c.de as string));
  for (const c of combinam) {
    const de = c.de as string;
    if (comentarios.has(c.id) || pessoasRespondidas.has(de)) out.jaRespondidos += 1;
    else if (pessoas.has(de)) out.repetidos += 1;
    else if (!Number.isFinite(c.em) || c.em < agora - SETE_DIAS_MS + MARGEM_MS) out.velhos += 1;
    else {
      pessoas.add(de);
      novos.push([c.id, de, c.arroba, c.em]);
    }
  }
  return out;
}

/** Os comentários desta lista que já estão guardados nas partes (respostas lidas duas vezes). */
async function jaNaLista(job: JobResponder, ids: string[]) {
  if (!job.partes || !ids.length) return new Set<string>();
  const { rows } = await query<{ id: string }>(
    `select distinct item ->> 0 as id
     from public.app_status, jsonb_array_elements(valor) as item
     where chave like $1 and item ->> 0 = any($2::text[])`,
    [`${CHAVE_PARTE}${job.automationId}:${job.mediaId}:%`, ids],
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * Quem já foi respondido: o comentário já tem envio na fila (o webhook respondeu, ou uma rodada anterior), já tem a
 * marca do «Responder quem já comentou», ou a pessoa já recebeu esta automação (por outro comentário).
 */
export async function jaRespondidos(accountId: string, automationId: string, commentIds: string[], pessoas: string[]) {
  const { rows: c } = await query<{ id: string }>(
    `select instagram_comment_id as id from public.queue where account_id = $1 and instagram_comment_id = any($2::text[])
     union
     select instagram_comment_id from public.events where account_id = $1 and instagram_event_id = any($3::text[])`,
    [accountId, commentIds, commentIds.map((id) => MARCA + id)],
  );
  const { rows: p } = await query<{ id: string }>(
    `select distinct ct.instagram_user_id as id
     from public.contacts ct
     join public.queue q on q.contact_id = ct.id
     where ct.account_id = $1 and q.automation_id = $2 and ct.instagram_user_id = any($3::text[])`,
    [accountId, automationId, pessoas],
  );
  return { comentarios: new Set(c.map((r) => r.id)), pessoasRespondidas: new Set(p.map((r) => r.id)) };
}

async function guardarParte(chave: string, job: JobResponder, itens: Candidato[]) {
  if (!itens.length) return job;
  await query(
    `insert into public.app_status (chave, valor, atualizado_em) values ($1, $2, now())
     on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
    [`${CHAVE_PARTE}${chave.slice(CHAVE.length)}:${job.partes}`, JSON.stringify(itens)],
  );
  return { ...job, partes: job.partes + 1 };
}

/**
 * Fim da contagem: junta as partes, ordena do comentário mais antigo para o mais novo (o que vence primeiro sai primeiro)
 * e tira quem não daria tempo de receber dentro dos 7 dias no ritmo de 200 por hora.
 */
async function fecharContagem(chave: string, job: JobResponder) {
  const todos = await lerPartes(chave, job.partes);
  todos.sort((a, b) => a[3] - b[3]);
  const cabem: Candidato[] = [];
  let horario = Math.max(Date.now(), job.proximoHorario ? Date.parse(job.proximoHorario) : 0);
  let semTempo = 0;
  for (const item of todos) {
    if (horario > item[3] + SETE_DIAS_MS - MARGEM_MS) {
      semTempo += 1;
      continue;
    }
    cabem.push(item);
    horario += INTERVALO_MS;
  }
  await query("delete from public.app_status where chave like $1", [`${CHAVE_PARTE}${chave.slice(CHAVE.length)}:%`]);
  let out: JobResponder = { ...job, partes: 0 };
  for (let i = 0; i < cabem.length; i += PARTE_MAX) out = await guardarParte(chave, out, cabem.slice(i, i + PARTE_MAX));
  return { ...out, estado: "pronto" as const, semTempo, paraEnviar: cabem.length, envioParte: 0, envioPos: 0, respostasPendentes: [], respostasCursor: null };
}

async function lerPartes(chave: string, partes: number) {
  const todos: Candidato[] = [];
  for (let i = 0; i < partes; i += 1) todos.push(...(await lerParte(chave, i)));
  return todos;
}

async function lerParte(chave: string, indice: number): Promise<Candidato[]> {
  const { rows } = await query<{ valor: Candidato[] }>("select valor from public.app_status where chave = $1", [`${CHAVE_PARTE}${chave.slice(CHAVE.length)}:${indice}`]);
  return Array.isArray(rows[0]?.valor) ? rows[0].valor : [];
}

// ---------------------------------------------------------------------------------------------------------------------
// Enviar (depois do «Mandar para N pessoas»): o mesmo caminho do webhook, espaçado no ritmo de 200 por hora

async function enviar(chave: string, inicio: JobResponder, account: InstagramAccount, automation: Automation, deadline: number) {
  const job = { ...inicio };
  let parte: Candidato[] | null = null;
  while (deadline - Date.now() > 1500) {
    if (job.envioParte >= job.partes) {
      return { ...job, estado: "concluido" as const, concluidoEm: agoraIso() };
    }
    parte ??= await lerParte(chave, job.envioParte);
    const item = parte[job.envioPos];
    if (!item) {
      job.envioParte += 1;
      job.envioPos = 0;
      parte = null;
      continue;
    }
    const resultado = await responderUm(account, automation, job, item);
    if (resultado === "enfileirado") job.enfileirados += 1;
    else job.puladosNoEnvio += 1;
    job.envioPos += 1;
  }
  return job;
}

/** Um comentário: marca (uma vez só, para sempre), confere de novo e põe na fila como o webhook poria. */
async function responderUm(account: InstagramAccount, automation: Automation, job: JobResponder, item: Candidato): Promise<"enfileirado" | "pulado"> {
  const [commentId, de, arroba, em] = item;
  const agora = Date.now();
  const horario = Math.max(agora, job.proximoHorario ? Date.parse(job.proximoHorario) : 0);
  if (horario > em + SETE_DIAS_MS - MARGEM_MS) return "pulado"; // não dá mais tempo dentro dos 7 dias

  // A marca: o índice único (perfil, instagram_event_id) garante que só um pedido passa daqui por comentário.
  const { rows } = await query<{ id: string }>(
    `insert into public.events (account_id, event_type, instagram_event_id, instagram_user_id, instagram_username, instagram_comment_id, instagram_media_id, payload)
     values ($1, 'comment_backfill', $2, $3, $4, $5, $6, $7)
     on conflict (account_id, instagram_event_id) where instagram_event_id is not null do nothing
     returning id`,
    [account.id, MARCA + commentId, de, arroba, commentId, job.mediaId, JSON.stringify({ origem: ORIGEM_RESPONDER_ANTIGOS, automationId: automation.id, comentarioEm: new Date(em).toISOString() })],
  );
  const eventId = rows[0]?.id;
  if (!eventId) return "pulado";

  // Confere de novo (o webhook ou outra rodada pode ter respondido depois da contagem). A marca acabou de entrar, então aqui
  // vale só a fila (este comentário) e a pessoa (esta automação, por outro comentário).
  const ja = await jaRespondidos(account.id, automation.id, [], [de]);
  const { rows: naFila } = await query("select 1 from public.queue where account_id = $1 and instagram_comment_id = $2 limit 1", [account.id, commentId]);
  if (naFila.length || ja.pessoasRespondidas.has(de)) return "pulado";

  await runCommentAutomations({ account, eventId, commentId, instagramUserId: de, username: arroba, matches: [automation] });

  // Os envios deste comentário: marcados (para a fila pular o que passar dos 7 dias) e empurrados para o horário dele.
  const atraso = Math.max(0, horario - agora);
  const { rows: envios } = await query<{ send_type: string }>(
    `update public.queue
     set payload = payload || $2::jsonb,
         available_at = available_at + make_interval(secs => $3::double precision / 1000)
     where event_id = $1 and status = 'pending'
     returning send_type`,
    [eventId, JSON.stringify({ origem: ORIGEM_RESPONDER_ANTIGOS, comentarioEm: new Date(em).toISOString() }), atraso],
  );
  if (envios.some((e) => e.send_type !== "public_reply")) job.proximoHorario = new Date(horario + INTERVALO_MS).toISOString();
  return "enfileirado";
}

// ---------------------------------------------------------------------------------------------------------------------
// O que a tela, o robô e o MCP mostram

type Envios = { enviadas: number; naFila: number; naoSairam: number };

async function contarEnvios(job: JobResponder): Promise<Envios | null> {
  if (job.estado !== "enviando" && job.estado !== "concluido") return null;
  const { rows } = await query<{ enviadas: string; na_fila: string; nao_sairam: string }>(
    `select count(*) filter (where q.status = 'sent') as enviadas,
            count(*) filter (where q.status in ('pending', 'sending')) as na_fila,
            count(*) filter (where q.status in ('failed', 'skipped')) as nao_sairam
     from public.events e
     join public.queue q on q.event_id = e.id
     where e.account_id = $1 and e.event_type = 'comment_backfill' and e.instagram_media_id = $2
       and q.automation_id = $3 and q.send_type in ('private_reply', 'dm') and q.instagram_comment_id is not null`,
    [job.accountId, job.mediaId, job.automationId],
  );
  return { enviadas: Number(rows[0]?.enviadas ?? 0), naFila: Number(rows[0]?.na_fila ?? 0), naoSairam: Number(rows[0]?.nao_sairam ?? 0) };
}

export function vista(job: JobResponder, envios: Envios | null) {
  const horas = job.paraEnviar / LIMITE_POR_HORA;
  const restantes = Math.max(0, job.paraEnviar - (envios?.enviadas ?? 0) - (envios?.naoSairam ?? 0) - job.puladosNoEnvio);
  const faltamEntrar = Math.max(0, job.paraEnviar - job.enfileirados - job.puladosNoEnvio);
  const base = Math.max(Date.now(), job.proximoHorario ? Date.parse(job.proximoHorario) : 0);
  const termina = job.estado === "pronto" ? new Date(Date.now() + horas * 3600_000) : job.estado === "enviando" || job.estado === "concluido" ? new Date(base + faltamEntrar * INTERVALO_MS) : null;
  return {
    estado: job.estado,
    automationId: job.automationId,
    accountId: job.accountId,
    mediaId: job.mediaId,
    permalink: job.permalink,
    numeros: {
      lidos: job.lidos,
      combinam: job.combinam,
      jaRespondidos: job.jaRespondidos,
      repetidos: job.repetidos,
      velhos: job.velhos,
      semTempo: job.semTempo,
      paraEnviar: job.paraEnviar,
    },
    enfileirados: job.enfileirados,
    puladosNoEnvio: job.puladosNoEnvio,
    enviadas: envios?.enviadas ?? 0,
    naFila: envios?.naFila ?? 0,
    naoSairam: envios?.naoSairam ?? 0,
    tempoEstimado: duracao(horas),
    terminaPorVolta: termina && termina.getTime() > Date.now() ? termina.toISOString() : null,
    mensagem: mensagem(job, envios, restantes, horas),
    erro: job.erro,
    leitura: job.leitura ?? null,
    paginasVazias: job.paginasVazias ?? 0,
    semRespostas: job.semRespostas ?? false,
    sonda: job.sonda ?? null,
    esperarAte: job.esperarAte,
    iniciadoEm: job.iniciadoEm,
    confirmadoEm: job.confirmadoEm,
    concluidoEm: job.concluidoEm,
  };
}

export type VistaResponder = ReturnType<typeof vista>;

function mensagem(job: JobResponder, envios: Envios | null, restantes: number, horas: number) {
  if (job.estado === "lendo") return `Lendo os comentários do post: ${job.lidos} lidos até agora. Nada foi mandado.`;
  if (job.estado === "erro") return job.erro || "A contagem parou com erro.";
  if (job.estado === "pronto") {
    if (!job.paraEnviar) return `Ninguém para responder agora: todos já foram respondidos, não combinam ou passaram de 7 dias.${avisoVazias(job)}`;
    return `${job.paraEnviar} pessoas podem receber agora. No ritmo de ${LIMITE_POR_HORA} por hora, leva ${duracao(horas)}. Nada foi mandado ainda.${avisoVazias(job)}`;
  }
  const enviadas = envios?.enviadas ?? 0;
  if (job.estado === "concluido" && restantes === 0) return `${enviadas} de ${job.paraEnviar} enviadas. Terminou.`;
  return `${enviadas} de ${job.paraEnviar} enviadas; o resto sai no ritmo de ${LIMITE_POR_HORA} por hora.`;
}

/** A Meta mandou páginas sem comentário nenhum: o número pode estar baixo porque ela escondeu comentários. */
function avisoVazias(job: JobResponder) {
  if (!job.paginasVazias) return "";
  const total = job.sonda?.total;
  return ` Atenção: a Meta devolveu ${job.paginasVazias} páginas sem nenhum comentário${typeof total === "number" ? ` (o post tem ${total} comentários; li ${job.lidos})` : ""}; ela pode estar escondendo comentários deste app.`;
}

/** «cerca de 1 h 30 min», «menos de 1 min»… */
export function duracao(horas: number) {
  const minutos = Math.ceil(horas * 60);
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `cerca de ${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h >= 48) return `cerca de ${Math.round(h / 24)} dias`;
  return m ? `cerca de ${h} h ${m} min` : `cerca de ${h} h`;
}

// ---------------------------------------------------------------------------------------------------------------------

function chamarMeta<T>(deadline: number, fazer: () => Promise<T>) {
  return withMetaDeadline(deadline, fazer);
}

function mensagemMeta(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/^Instagram Graph v[\d.]+:\s*/, "");
}

function agoraIso() {
  return new Date().toISOString();
}
