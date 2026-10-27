import { query } from "@/lib/db/client";
import type { FilaRow } from "@/lib/molde/fila";
import { formatSaoPauloTime } from "@/lib/time";
import { editTelegramMessage, sendTelegramWithButtons, telegramBotConfig } from "@/lib/telegram/api";

/**
 * O progresso de cada vídeo numa mensagem só do Telegram (Molde v137, etapa G7, migração 0020).
 *
 * Antes, cada item da fila única (o Reel do calendário, as cenas, o vídeo do avatar, o vídeo final…) era um assunto à parte.
 * Agora os itens do MESMO vídeo formam um «grupo» e o Telegram mantém UMA mensagem por grupo, editada a cada mudança de etapa
 * ou de estado: «Reel «Oração da manhã» · Birdie / 3 de 6 · Voz ✓ · Fazendo o vídeo…».
 *
 * O grupo de cada item (coluna molde_fila.grupo):
 *  - `grupo` mandado pela página no espelho (o id do Reel no calendário, por exemplo) → `g:<projeto>:<grupo>`;
 *  - senão, o projeto + o tema do título: a página manda o título como «<nome do pedido> · <tema>» (fila134Titulo) e o
 *    Telegram como «Reel: <tema>» → `t:<projeto>:<tema sem acento, minúsculo>`. Só para os tipos de vídeo (PROGRESSO_TIPOS);
 *  - um pedido de vídeo sem tema no título (ex.: «Vídeo do avatar falando», do HeyGen) fica sozinho no grupo dele (`r:<ref>`).
 * Os itens do orquestrador (com estação) e os rascunhos do Telegram não têm grupo: seguem como antes.
 *
 * A aprovação continua na mensagem de aprovação de sempre (com os botões «Aprovar»/«Refazer»…): a mensagem de progresso só
 * diz «esperando você aprovar». Assim o fluxo de aprovar (rodadas, botões assinados, a espera do motivo) não muda.
 *
 * Limite do Telegram: no máximo 1 edição por segundo por mensagem. Quem chega antes de 1 s marca o grupo como «pendente»,
 * espera ~1 s e tenta de novo (as mudanças rápidas se juntam numa edição só); o que sobrar, o relógio manda no minuto seguinte.
 * Ligado por padrão; TELEGRAM_PROGRESSO=0 (ou «desligado») no Netlify desliga. Sem a 0020, desligado (sem erro).
 */

/** Os tipos de pedido que fazem parte de um vídeo (os outros só entram com o `grupo` explícito da página). */
export const PROGRESSO_TIPOS = new Set(["reel", "reel_final", "flow_video", "heygen", "storyboard", "so_flow", "abertura"]);
/** O nome de cada etapa na mensagem (o resto usa o nome que vem no título). */
const NOME_ETAPA: Record<string, string> = {
  reel: "Roteiro",
  flow_video: "Cenas do vídeo",
  storyboard: "Storyboard",
  so_flow: "Cenas do vídeo",
  abertura: "Abertura",
  heygen: "Vídeo do avatar",
  voz: "Voz",
  audio: "Áudio",
  reel_final: "Vídeo final",
};
/** Intervalo mínimo entre duas edições da mesma mensagem (o Telegram aceita ~1 por segundo). */
export const PROGRESSO_INTERVALO_MS = 1000;
/** Um vídeo terminado há mais que isto e que volta a andar ganha mensagem nova (em vez de editar uma lá de cima). */
const NOVA_MENSAGEM_DEPOIS_H = 6;

export function progressoLigado() {
  const v = process.env.TELEGRAM_PROGRESSO?.trim().toLowerCase();
  return !(v && ["0", "false", "nao", "não", "desligado", "off", "no"].includes(v));
}

const isMissing0020 = (error: unknown) => ["42P01", "42703"].includes((error as { code?: string } | null)?.code ?? "");

function shorten(text: string, max: number) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** «Vídeo final do Reel (edição) · Oração da manhã» → {nome, tema}; «Reel: Oração da manhã» → {nome: "Reel", tema}. */
export function temaDoTitulo(titulo: string): { nome: string; tema: string | null } {
  const t = String(titulo ?? "").trim();
  const ponto = /^(.+?)\s+·\s+(.+)$/.exec(t);
  if (ponto) return { nome: ponto[1].trim(), tema: ponto[2].trim() };
  const reel = /^reel:\s*(.+)$/i.exec(t);
  if (reel) return { nome: "Reel", tema: reel[1].trim() };
  return { nome: t, tema: null };
}

const normal = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/["'«»“”‘’]/g, "").replace(/\s+/g, " ").trim();

/** O grupo (o vídeo) de um item, ou null quando ele não tem mensagem de progresso. */
export function grupoDoItem(row: Pick<FilaRow, "projeto" | "tipo" | "titulo" | "ref" | "estado"> & { estacao?: string | null }, explicito?: string | null): string | null {
  if (row.estacao || row.estado === "rascunho") return null;
  const projeto = row.projeto || "-";
  if (explicito && explicito.trim()) return `g:${projeto}:${explicito.trim()}`.slice(0, 300);
  if (!PROGRESSO_TIPOS.has(row.tipo)) return null;
  const { tema } = temaDoTitulo(row.titulo);
  if (tema && normal(tema)) return `t:${projeto}:${normal(tema)}`.slice(0, 300);
  return `r:${row.ref}`.slice(0, 300);
}

const FEITO = new Set(["pronto", "aprovado"]);
const FIM = new Set(["pronto", "aprovado", "erro", "cancelado"]);

function nomeDaEtapa(item: FilaRow) {
  return NOME_ETAPA[item.tipo] ?? shorten(temaDoTitulo(item.titulo).nome || item.tipo, 60);
}

function agora(item: FilaRow): string {
  const nome = nomeDaEtapa(item);
  switch (item.estado) {
    case "produzindo":
    case "na_revisao":
      return item.etapa ? `${shorten(item.etapa, 80).replace(/[.…]+$/, "")}…` : `Fazendo: ${nome.toLowerCase()}…`;
    case "na_fila":
      return `${nome}: na fila…`;
    case "para_aprovar":
      return `${nome}: esperando você aprovar`;
    case "refazer":
      return `${nome}: refazendo…`;
    case "erro":
      return `${nome}: parou com erro`;
    default:
      return nome;
  }
}

function linhaDoItem(item: FilaRow) {
  const nome = nomeDaEtapa(item);
  switch (item.estado) {
    case "pronto":
    case "aprovado":
      return `✓ ${nome}`;
    case "erro":
      return `✗ ${nome}: parou com erro${item.nota ? ` (${shorten(item.nota, 120)})` : ""}`;
    case "cancelado":
      return `– ${nome}: cancelado`;
    case "para_aprovar":
      return `→ ${nome}: esperando você aprovar (veja a mensagem com os botões)`;
    case "refazer":
      return `→ ${nome}: refazendo${item.decisao?.nota ? ` («${shorten(item.decisao.nota, 100)}»)` : ""}`;
    case "na_fila":
      return `… ${nome}: na fila`;
    default:
      return `… ${nome}${item.etapa ? `: ${shorten(item.etapa, 100)}` : ": fazendo"}`;
  }
}

/** O texto da mensagem de progresso (sem a hora: a hora não conta como mudança). `itens` na ordem em que foram criados. */
export function textoDoProgresso(itens: FilaRow[], passos: number | null = null) {
  const ref = itens.find((i) => temaDoTitulo(i.titulo).tema) ?? itens[0];
  const tema = temaDoTitulo(ref.titulo).tema ?? ref.titulo;
  const ehVideo = itens.some((i) => PROGRESSO_TIPOS.has(i.tipo));
  const avatar = itens.find((i) => i.avatar)?.avatar;
  const cabeca = `${ehVideo ? "Reel" : "Pedido"} «${shorten(tema, 80)}»${avatar ? ` · ${avatar}` : ""}`;

  const feitos = itens.filter((i) => FEITO.has(i.estado));
  const total = Math.max(passos ?? 0, itens.length);
  const porHora = (a: FilaRow, b: FilaRow) => new Date(b.atualizado_em).getTime() - new Date(a.atualizado_em).getTime();
  const ultimoFeito = [...feitos].sort(porHora)[0];
  const abertos = itens.filter((i) => !FIM.has(i.estado));
  // o que pede o dono vem primeiro; depois o que mudou por último
  const atual = abertos.find((i) => i.estado === "para_aprovar") ?? [...abertos].sort(porHora)[0] ?? itens.find((i) => i.estado === "erro");
  const partes = [`${feitos.length} de ${total}`];
  if (ultimoFeito) partes.push(`${nomeDaEtapa(ultimoFeito)} ✓`);
  if (atual) partes.push(agora(atual));
  else if (feitos.length) partes.push(feitos.length >= total ? "Pronto ✓" : "Esperando a próxima etapa");
  else partes.push("Cancelado");

  return [cabeca, partes.join(" · "), "", ...itens.map(linhaDoItem)].join("\n");
}

type GrupoRow = { grupo: string; projeto: string; telegram_msg_id: string | number | null; passos: number | null; texto: string | null; editado_em: Date | null; antes_em: Date | null };

const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mostra o grupo no Telegram: manda a mensagem (1ª vez) ou edita (se o texto mudou), respeitando 1 edição por segundo.
 * `esperar`: se a última edição foi há menos de 1 s, espera e tenta mais uma vez (senão fica pendente para o relógio).
 * Nunca lança. true = o Telegram está mostrando o estado de agora.
 */
export async function mostrarGrupo(grupo: string, options: { timeoutMs?: number; esperar?: boolean } = {}): Promise<boolean> {
  try {
    if (!progressoLigado() || !telegramBotConfig()) return false;
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      // pega a vez (atômico): só quem pega edita; a marca «pendente» sai junto (o que mudar depois marca de novo)
      const { rows: [vez] } = await query<GrupoRow>(
        `with antes as (select grupo, editado_em from public.molde_fila_grupos where grupo = $1 for update)
         update public.molde_fila_grupos g set editado_em = now(), pendente = false
         from antes
         where g.grupo = antes.grupo and g.pendente
           and (g.editado_em is null or g.editado_em <= now() - make_interval(secs => $2::double precision / 1000))
         returning g.grupo, g.projeto, g.telegram_msg_id, g.passos, g.texto, g.editado_em, antes.editado_em as antes_em`,
        [grupo, PROGRESSO_INTERVALO_MS],
      );
      if (!vez) {
        const { rows: [g] } = await query<{ pendente: boolean; espera_ms: number }>(
          `select pendente, greatest(0, extract(epoch from (editado_em + make_interval(secs => $2::double precision / 1000) - now())) * 1000)::int as espera_ms
           from public.molde_fila_grupos where grupo = $1`,
          [grupo, PROGRESSO_INTERVALO_MS],
        );
        if (!g?.pendente) return true; // nada novo (ou outra chamada já mostrou)
        if (!options.esperar || tentativa > 0) return false; // o relógio manda no minuto seguinte
        await dormir(Math.min(PROGRESSO_INTERVALO_MS + 100, Number(g.espera_ms) + 60));
        continue;
      }
      return await editarOuMandar(vez, options.timeoutMs);
    }
    return false;
  } catch (error) {
    if (!isMissing0020(error)) console.error("[progresso] não consegui mostrar o vídeo no Telegram:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function editarOuMandar(vez: GrupoRow, timeoutMs?: number) {
  const { rows: itens } = await query<FilaRow>(
    "select * from public.molde_fila where grupo = $1 and estado <> 'rascunho' order by criado_em, id limit 30",
    [vez.grupo],
  );
  if (!itens.length) return true;
  const corpo = textoDoProgresso(itens, vez.passos);
  if (vez.telegram_msg_id && corpo === vez.texto) return true;
  const final = `${corpo}\n\nAtualizado às ${formatSaoPauloTime(new Date())}.`;
  const terminadoAntes = Boolean(vez.texto && itens.length && vez.antes_em && Date.now() - new Date(vez.antes_em).getTime() > NOVA_MENSAGEM_DEPOIS_H * 3600_000);
  let msgId = vez.telegram_msg_id && !terminadoAntes ? Number(vez.telegram_msg_id) : null;

  if (msgId) {
    const editado = await editTelegramMessage(msgId, final, { timeoutMs });
    if (editado.ok) {
      await query("update public.molde_fila_grupos set texto = $2, atualizado_em = now() where grupo = $1", [vez.grupo, corpo]);
      return true;
    }
    // a mensagem sumiu (apagada no Telegram) ou não dá mais para editar: manda outra
    if (!/not found|can't be edited|cannot be edited|message_id_invalid/i.test(editado.error)) {
      await query("update public.molde_fila_grupos set pendente = true, atualizado_em = now() where grupo = $1", [vez.grupo]);
      return false;
    }
    msgId = null;
  }
  const enviada = await sendTelegramWithButtons(final, null, { timeoutMs });
  if (!enviada.ok) {
    await query("update public.molde_fila_grupos set pendente = true, atualizado_em = now() where grupo = $1", [vez.grupo]);
    return false;
  }
  await query("update public.molde_fila_grupos set telegram_msg_id = $2, texto = $3, atualizado_em = now() where grupo = $1", [vez.grupo, enviada.messageId, corpo]);
  return true;
}

export type EntradaProgresso = { id: string; grupo?: string | null; passos?: number | null };

/**
 * Itens da fila que mudaram (o espelho da página, uma decisão, um cancelamento): grava o grupo de cada um, marca o grupo como
 * pendente e mostra no Telegram (uma mensagem por vídeo). Nunca lança. Devolve quantos vídeos ficaram em dia no Telegram.
 */
export async function atualizarProgresso(entradas: EntradaProgresso[], options: { timeoutMs?: number; esperar?: boolean } = {}): Promise<number> {
  if (!entradas.length || !progressoLigado() || !telegramBotConfig()) return 0;
  try {
    const porId = new Map(entradas.map((e) => [e.id, e]));
    const { rows } = await query<FilaRow & { grupo?: string | null }>("select * from public.molde_fila where id = any($1::uuid[])", [[...porId.keys()]]);
    const grupos = new Map<string, { projeto: string; passos: number | null }>();
    for (const row of rows) {
      const entrada = porId.get(row.id);
      // o grupo explícito vale uma vez: depois, o item continua no grupo gravado (mesmo sem a página mandar de novo)
      const explicito = entrada?.grupo ?? (row.grupo?.startsWith("g:") ? row.grupo.slice(`g:${row.projeto || "-"}:`.length) : null);
      const grupo = grupoDoItem(row, explicito);
      if (!grupo) continue;
      if (row.grupo !== grupo) await query("update public.molde_fila set grupo = $2 where id = $1", [row.id, grupo]);
      const atual = grupos.get(grupo);
      const passos = entrada?.passos ?? null;
      grupos.set(grupo, { projeto: row.projeto, passos: Math.max(atual?.passos ?? 0, passos ?? 0) || null });
    }
    for (const [grupo, g] of grupos) {
      await query(
        `insert into public.molde_fila_grupos (grupo, projeto, passos, pendente) values ($1, $2, $3, true)
         on conflict (grupo) do update set pendente = true, atualizado_em = now(),
           passos = case when excluded.passos is null then public.molde_fila_grupos.passos else greatest(coalesce(public.molde_fila_grupos.passos, 0), excluded.passos) end`,
        [grupo, g.projeto, g.passos],
      );
    }
    const feitos = await Promise.all([...grupos.keys()].map((grupo) => mostrarGrupo(grupo, options)));
    return feitos.filter(Boolean).length;
  } catch (error) {
    if (!isMissing0020(error)) console.error("[progresso] não consegui atualizar o progresso:", error instanceof Error ? error.message : error);
    return 0;
  }
}

/** Para o relógio: os vídeos que mudaram e ainda não foram mostrados (limite de 1 edição por segundo, Telegram fora…). */
export async function gruposPendentes(limite = 5): Promise<string[]> {
  if (!progressoLigado()) return [];
  try {
    const { rows } = await query<{ grupo: string }>(
      `select grupo from public.molde_fila_grupos
       where pendente and atualizado_em > now() - interval '1 day'
         and (editado_em is null or editado_em < now() - interval '2 seconds')
       order by atualizado_em limit $1`,
      [limite],
    );
    return rows.map((r) => r.grupo);
  } catch (error) {
    if (!isMissing0020(error)) console.error("[progresso] não consegui ler os vídeos pendentes:", error instanceof Error ? error.message : error);
    return [];
  }
}
