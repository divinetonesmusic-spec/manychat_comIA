import { randomInt } from "node:crypto";
import { query } from "@/lib/db/client";
import { enqueueJob } from "@/lib/db/repositories";
import { escolherVideo, hasDmVideoTables, PASSO_VIDEO, VIDEO_APOS_MAX_MIN, VIDEO_APOS_PADRAO_MIN, videosDaAutomacao } from "@/lib/db/dm-videos";

/**
 * Sequência de DM por post (2-DM, 0012). A Meta só deixa mandar UMA mensagem privada para quem comentou (a resposta ao
 * comentário, passo 1). Quando a pessoa responde (toca no botão ou escreve), abre a janela de 24 h e a sequência segue:
 *   passo 2 · `mensagem2` (o valor, sem link), logo depois da resposta;
 *   passo 3 · `mensagem3` com o botão do link (`linkUrl`, o link que conta cliques com ?de=dm), `linkAposSegundos` depois;
 *   passo 4 · `lembrete`, `lembreteHoras` depois da resposta (no máximo 23 h: antes de a janela fechar), só se a pessoa não
 *             tocou no link nem escreveu de novo.
 * Tudo passa pela fila normal de envios (limite de 200 por hora, pausa humana, prazo de 24 h da Meta, quem pediu para parar).
 * Sem a 0012 nada disto roda: a DM do post sai só com a 1ª mensagem, como antes.
 *
 * Modo «vídeo» (Molde v133, 0014; `modo: "video"`): a resposta da pessoa escolhe um dos vídeos do avatar do post
 * (dm-videos.ts, pelas palavras dela; sem casar, o geral). Em vez do passo 2, sai o vídeo (com a frase dele, ou a
 * `mensagem2`) `videoAposMinutos` depois da resposta (padrão 3, até 15) e só então o link (`mensagem3`), `linkAposSegundos`
 * depois do vídeo. O lembrete não muda. Sem a 0014 ou sem vídeo que sirva: a sequência segue como no modo de sempre.
 */

export type DmSequencia = {
  mensagem2: string;
  mensagem3: string;
  linkUrl: string | null;
  linkLabel: string;
  linkAposSegundos: number;
  lembrete: string;
  lembreteHoras: number;
  /** v133 · "link" (o de sempre) ou "video" (o vídeo do avatar escolhido pela resposta antes do link). */
  modo: "link" | "video";
  /** v133 · minutos entre a resposta da pessoa e o vídeo (0 a 15). */
  videoAposMinutos: number;
};

export const SEQUENCIA_PADRAO = { linkLabel: "Abrir link", linkAposSegundos: 60, lembreteHoras: 22 } as const;
export const MAX_TEXTO_SEQUENCIA = 1000;
/** Marca dos envios da sequência na fila (payload.origem): quem pede para parar não recebe o resto. */
export const ORIGEM_SEQUENCIA = "sequencia_dm";
export const MIGRATION_0012_SEQUENCIA = "Falta colar a atualização 0012 no Supabase: a DM do post sai só com a 1ª mensagem (sem a sequência).";

/** Quanto tempo depois do comentário a resposta da pessoa ainda continua a sequência (a resposta ao comentário vale 7 dias). */
const DIAS_PARA_RESPONDER = 7;

function texto(value: unknown, max = MAX_TEXTO_SEQUENCIA) {
  return typeof value === "string" ? value.replace(/\r/g, "").trim().slice(0, max) : "";
}

function inteiro(value: unknown, min: number, max: number, padrao: number) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return padrao;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * Lê a sequência que a página manda (automationOptions.sequencia). undefined = não veio (não mexe); null = tirar;
 * { erro } = formato errado (a frase diz o quê).
 */
export function parseSequencia(value: unknown): DmSequencia | null | undefined | { erro: string } {
  if (value === undefined) return undefined;
  if (value === null || value === false) return null;
  if (typeof value !== "object" || Array.isArray(value)) return { erro: "automationOptions.sequencia precisa ser um objeto (ou null para tirar)." };
  const record = value as Record<string, unknown>;
  for (const key of ["mensagem2", "mensagem3", "lembrete"]) {
    if (typeof record[key] === "string" && Array.from(record[key] as string).length > MAX_TEXTO_SEQUENCIA) {
      return { erro: `automationOptions.sequencia.${key} passa de ${MAX_TEXTO_SEQUENCIA} letras.` };
    }
  }
  const linkUrl = texto(record.linkUrl, 2000);
  if (linkUrl && !/^https:\/\/[^\s]+$/i.test(linkUrl)) return { erro: "automationOptions.sequencia.linkUrl precisa começar com https://" };
  const seq: DmSequencia = {
    mensagem2: texto(record.mensagem2),
    mensagem3: texto(record.mensagem3),
    linkUrl: linkUrl || null,
    linkLabel: texto(record.linkLabel, 20) || SEQUENCIA_PADRAO.linkLabel,
    linkAposSegundos: inteiro(record.linkAposSegundos, 0, 3600, SEQUENCIA_PADRAO.linkAposSegundos),
    lembrete: texto(record.lembrete),
    lembreteHoras: inteiro(record.lembreteHoras, 1, 23, SEQUENCIA_PADRAO.lembreteHoras),
    modo: record.modo === "video" ? "video" : "link",
    videoAposMinutos: inteiro(record.videoAposMinutos, 0, VIDEO_APOS_MAX_MIN, VIDEO_APOS_PADRAO_MIN),
  };
  if (record.modo !== undefined && record.modo !== "video" && record.modo !== "link") return { erro: "automationOptions.sequencia.modo precisa ser \"link\" ou \"video\"." };
  if (seq.linkUrl && !seq.mensagem3) return { erro: "automationOptions.sequencia: com linkUrl, mande a mensagem3 (o texto que vai com o botão do link)." };
  if (!seq.mensagem2 && !seq.mensagem3 && !seq.lembrete && seq.modo !== "video") return null; // nada para mandar: como se não houvesse sequência
  return seq;
}

/** A sequência guardada na automação (coluna automations.sequencia, 0012), já conferida; null = sem sequência. */
export function sequenciaDaAutomacao(automation: { sequencia?: unknown } | null | undefined): DmSequencia | null {
  const parsed = parseSequencia(automation?.sequencia ?? null);
  return parsed && !("erro" in parsed) ? parsed : null;
}

/** A 0012 foi colada? (a tabela dm_sequencias e a coluna automations.sequencia chegam juntas). O "não" vale 1 min. */
let probe: { exists: boolean; checkedAt: number } | null = null;
export async function hasSequenciaTables() {
  if (probe && (probe.exists || Date.now() - probe.checkedAt < 60_000)) return probe.exists;
  const { rows } = await query<{ exists: boolean }>("select to_regclass('public.dm_sequencias') is not null as exists");
  probe = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
  return probe.exists;
}

/** Guarda a sequência na automação do post. false = sem a 0012 (não guardou). */
export async function salvarSequenciaNaAutomacao(automationId: string, seq: DmSequencia | null) {
  if (!(await hasSequenciaTables())) return false;
  await query("update public.automations set sequencia = $2::jsonb where id = $1", [automationId, JSON.stringify(seq ?? {})]);
  return true;
}

const CODIGO_ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789";
function novoCodigo() {
  let out = "";
  for (let i = 0; i < 12; i += 1) out += CODIGO_ALFABETO[randomInt(CODIGO_ALFABETO.length)];
  return out;
}

/**
 * A 1ª mensagem (resposta ao comentário) entrou na fila: a pessoa fica esperando a resposta dela. Comentou de novo depois
 * de uma sequência que já acabou (mais de 24 h): começa outra. Nunca falha o webhook (erro só vai para o log).
 */
export async function iniciarSequencia(input: { accountId: string | null; automationId: string; contactId: string }) {
  try {
    if (!(await hasSequenciaTables())) return false;
    await query(
      `insert into public.dm_sequencias (account_id, automation_id, contact_id, chave)
       values ($1, $2, $3, $4)
       on conflict (automation_id, contact_id) do update
         set etapa = 'aguardando_resposta', comentou_em = now(), respondeu_em = null, clicou_em = null,
             respondeu_depois_em = null, lembrete_queue_id = null, atualizado_em = now()
         where public.dm_sequencias.etapa <> 'aguardando_resposta'
           and coalesce(public.dm_sequencias.respondeu_em, public.dm_sequencias.comentou_em) < now() - interval '24 hours'`,
      [input.accountId, input.automationId, input.contactId, novoCodigo()],
    );
    return true;
  } catch (error) {
    console.error("[sequência] não consegui começar:", error instanceof Error ? error.message : error);
    return false;
  }
}

/** A sequência desta pessoa que espera a resposta dela (a mais recente, comentada há até 7 dias), ou null. */
export async function sequenciaAguardando(contactId: string): Promise<{ id: string; automation_id: string } | null> {
  if (!(await hasSequenciaTables())) return null;
  const { rows } = await query<{ id: string; automation_id: string }>(
    `select s.id, s.automation_id from public.dm_sequencias s
     join public.automations a on a.id = s.automation_id and a.active = true
     where s.contact_id = $1 and s.etapa = 'aguardando_resposta' and s.comentou_em > now() - make_interval(days => $2)
     order by s.comentou_em desc
     limit 1`,
    [contactId, DIAS_PARA_RESPONDER],
  );
  return rows[0] ?? null;
}

/** O link do passo 3: no link que conta cliques (/l/<código>) vai também &s=<código da pessoa> (o toque pula o lembrete). */
export function linkDaPessoa(linkUrl: string, codigo: string) {
  try {
    const url = new URL(linkUrl);
    if (!/^\/l\/[a-z0-9]{3,32}$/.test(url.pathname)) return linkUrl;
    url.searchParams.set("s", codigo);
    return url.toString();
  } catch {
    return linkUrl;
  }
}

/**
 * A pessoa respondeu (tocou no botão da 1ª mensagem ou escreveu): põe na fila os passos 2, 3 e o lembrete, uma vez só
 * (a mesma resposta repetida pela Meta não manda de novo). Devolve true quando a sequência andou.
 */
export async function avancarSequencia(input: {
  automation: { id: string; account_id: string | null; sequencia?: unknown };
  contactId: string;
  instagramRecipientId: string;
  eventId?: string | null;
  /** v133 · o que a pessoa escreveu (ou o texto do botão): no modo vídeo, escolhe o vídeo. */
  texto?: string | null;
}): Promise<boolean> {
  const seq = sequenciaDaAutomacao(input.automation);
  if (!seq || !(await hasSequenciaTables())) return false;
  const { rows } = await query<{ id: string; chave: string }>(
    `update public.dm_sequencias set etapa = 'em_andamento', respondeu_em = now(), atualizado_em = now()
     where automation_id = $1 and contact_id = $2 and etapa = 'aguardando_resposta'
     returning id, chave`,
    [input.automation.id, input.contactId],
  );
  const row = rows[0];
  if (!row) return false;

  const base = {
    accountId: input.automation.account_id,
    eventId: input.eventId ?? null,
    contactId: input.contactId,
    automationId: input.automation.id,
    instagramRecipientId: input.instagramRecipientId,
    sendType: "dm" as const,
  };
  const agora = Date.now();
  if (seq.modo === "video" && (await enfileirarVideo({ seq, base, seqId: row.id, chave: row.chave, agora, automation: input.automation, texto: input.texto ?? "" }))) {
    await enfileirarLembrete(seq, base, row.id, agora);
    return true;
  }
  if (seq.mensagem2) {
    await enqueueJob({ ...base, availableAt: new Date(agora), payload: { type: "text", text: seq.mensagem2, origem: ORIGEM_SEQUENCIA, seqId: row.id, passo: 2 } });
  }
  if (seq.mensagem3) {
    const espera = seq.mensagem2 ? seq.linkAposSegundos * 1000 : 0;
    const payload = seq.linkUrl
      ? { type: "link", text: seq.mensagem3, buttonLabel: seq.linkLabel, url: linkDaPessoa(seq.linkUrl, row.chave), origem: ORIGEM_SEQUENCIA, seqId: row.id, passo: 3 }
      : { type: "text", text: seq.mensagem3, origem: ORIGEM_SEQUENCIA, seqId: row.id, passo: 3 };
    await enqueueJob({ ...base, availableAt: new Date(agora + espera), payload });
  }
  await enfileirarLembrete(seq, base, row.id, agora);
  return true;
}

type BaseEnvio = Omit<Parameters<typeof enqueueJob>[0], "availableAt" | "payload">;

async function enfileirarLembrete(seq: DmSequencia, base: BaseEnvio, seqId: string, agora: number) {
  if (!seq.lembrete) return;
  const lembreteId = await enqueueJob({
    ...base,
    availableAt: new Date(agora + seq.lembreteHoras * 3_600_000),
    payload: { type: "reminder", text: seq.lembrete, origem: ORIGEM_SEQUENCIA, seqId, passo: 4 },
  });
  if (lembreteId) await query("update public.dm_sequencias set lembrete_queue_id = $2 where id = $1", [seqId, lembreteId]);
}

/**
 * v133 · modo vídeo: escolhe o vídeo pela resposta e põe na fila o vídeo (com a frase dele) e, depois, o link. false = sem a
 * 0014 ou sem vídeo que sirva (o chamador segue o modo de sempre). Nunca deixa a sequência sem andar.
 */
async function enfileirarVideo(input: { seq: DmSequencia; base: BaseEnvio; seqId: string; chave: string; agora: number; automation: { id: string; account_id: string | null }; texto: string }) {
  const { seq, base, seqId } = input;
  if (!(await hasDmVideoTables())) return false;
  const escolha = escolherVideo(input.texto, await videosDaAutomacao(input.automation));
  if (!escolha) return false;
  const saiEm = new Date(input.agora + seq.videoAposMinutos * 60_000);
  const videoId = await enqueueJob({
    ...base,
    availableAt: saiEm,
    payload: { type: "media", mediaType: "video", mediaUrl: escolha.video.videoUrl, text: escolha.video.texto || seq.mensagem2, origem: ORIGEM_SEQUENCIA, seqId, passo: PASSO_VIDEO, videoChave: escolha.video.chave },
  });
  if (seq.mensagem3) {
    const linkEm = new Date(saiEm.getTime() + seq.linkAposSegundos * 1000);
    const payload = seq.linkUrl
      ? { type: "link", text: seq.mensagem3, buttonLabel: seq.linkLabel, url: linkDaPessoa(seq.linkUrl, input.chave), origem: ORIGEM_SEQUENCIA, seqId, passo: 3 }
      : { type: "text", text: seq.mensagem3, origem: ORIGEM_SEQUENCIA, seqId, passo: 3 };
    await enqueueJob({ ...base, availableAt: linkEm, payload });
  }
  await query(
    "update public.dm_sequencias set resposta_texto = $2, video_chave = $3, video_sai_em = $4, video_queue_id = $5 where id = $1",
    [seqId, String(input.texto ?? "").trim().slice(0, 500) || null, escolha.video.chave, saiEm, videoId ?? null],
  );
  return true;
}

const LEMBRETE_DISPENSADO_CLIQUE = "A pessoa tocou no link: o lembrete não precisa sair.";
const LEMBRETE_DISPENSADO_RESPOSTA = "A pessoa respondeu de novo: o lembrete não precisa sair.";

async function dispensarLembretes(ids: Array<string | null>, motivo: string) {
  const list = ids.filter(Boolean) as string[];
  if (!list.length) return;
  await query("update public.queue set status = 'skipped', last_error = $2, updated_at = now() where id = any($1::uuid[]) and status = 'pending'", [list, motivo]);
}

/** O toque no link do passo 3 (/l/...&s=<código>): marca e tira o lembrete da fila. */
export async function marcarCliqueSequencia(codigo: string) {
  if (!(await hasSequenciaTables())) return false;
  const { rows } = await query<{ lembrete_queue_id: string | null }>(
    `update public.dm_sequencias set clicou_em = coalesce(clicou_em, now()), etapa = 'concluida', atualizado_em = now()
     where chave = $1 returning lembrete_queue_id`,
    [codigo],
  );
  await dispensarLembretes(rows.map((row) => row.lembrete_queue_id), LEMBRETE_DISPENSADO_CLIQUE);
  return rows.length > 0;
}

/** A pessoa escreveu de novo depois que a sequência andou: a conversa seguiu, então o lembrete não sai. Nunca falha. */
export async function marcarRespostaDepois(contactId: string) {
  try {
    if (!(await hasSequenciaTables())) return;
    const { rows } = await query<{ lembrete_queue_id: string | null }>(
      `update public.dm_sequencias set respondeu_depois_em = now(), atualizado_em = now()
       where contact_id = $1 and etapa = 'em_andamento' and respondeu_depois_em is null
       returning lembrete_queue_id`,
      [contactId],
    );
    await dispensarLembretes(rows.map((row) => row.lembrete_queue_id), LEMBRETE_DISPENSADO_RESPOSTA);
  } catch (error) {
    console.error("[sequência] não consegui marcar a resposta:", error instanceof Error ? error.message : error);
  }
}

/** Quantas pessoas responderam e quantas tocaram no link, por automação (para a contagem do Molde). */
export async function contagemSequencias(automationIds: string[]) {
  const out = new Map<string, { responderam: number; clicaram: number }>();
  if (!automationIds.length || !(await hasSequenciaTables())) return out;
  const { rows } = await query<{ automation_id: string; responderam: string; clicaram: string }>(
    `select automation_id, count(*) filter (where respondeu_em is not null) as responderam, count(*) filter (where clicou_em is not null) as clicaram
     from public.dm_sequencias where automation_id = any($1::uuid[]) group by automation_id`,
    [automationIds],
  );
  for (const row of rows) out.set(row.automation_id, { responderam: Number(row.responderam), clicaram: Number(row.clicaram) });
  return out;
}
