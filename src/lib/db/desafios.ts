import { randomInt } from "node:crypto";
import { query } from "@/lib/db/client";
import { enqueueJob } from "@/lib/db/repositories";
import { getAppBaseUrl } from "@/lib/env";
import { codigoOrigem } from "@/lib/funil/quiz";
import { emailConfig, EmailError, enviarEmail, type EmailConfig, type EmailMensagem } from "@/lib/vendas/email";
import {
  AMOSTRA_MINIMA,
  checkoutComCodigo,
  compararVariantes,
  DESAFIO_DIAS,
  diasDa,
  emailDoDia,
  emailNoTexto,
  HORAS_PROXIMO_DIA,
  HORAS_RESERVA,
  lerDesafio,
  lerPayloadDesafio,
  ORIGEM_DESAFIO,
  payloadDesafio,
  sortearVariante,
  textosDesafio,
  type Comparacao,
  type DesafioPacote,
  type DesafioVariante,
} from "@/lib/desafio/desafio";

/**
 * O desafio de 5 dias no Direct (Molde v134, 0017): o banco. As regras puras estão em `src/lib/desafio/desafio.ts`.
 * Sem a 0017 as tabelas não existem: as rotas respondem MIGRATION_0017, o webhook segue o caminho de sempre e o relógio pula.
 */
export const MIGRATION_0017 = "Falta colar a atualização 0017 no Supabase (veja docs/ATUALIZACAO_0017.md): o desafio de 5 dias ainda não funciona.";
export const EMAIL_DESLIGADO = "O e-mail de reserva está desligado: falta configurar o envio de e-mail (RESEND_API_KEY e EMAIL_REMETENTE no Netlify). O desafio segue só pelo Direct e o dia 1 não pede o e-mail.";
const TENTATIVAS_EMAIL = 3;

export function isMissing0017(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

/** A 0017 foi colada? Lembra o "sim"; o "não" vale 1 min. */
let probe: { exists: boolean; checkedAt: number } | null = null;
export async function hasDesafioTables() {
  if (probe && (probe.exists || Date.now() - probe.checkedAt < 60_000)) return probe.exists;
  const { rows } = await query<{ exists: boolean }>("select to_regclass('public.desafio_inscricoes') is not null as exists");
  probe = { exists: Boolean(rows[0]?.exists), checkedAt: Date.now() };
  return probe.exists;
}

const ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789";
function codigo(n = 16) {
  let out = "";
  for (let i = 0; i < n; i += 1) out += ALFABETO[randomInt(ALFABETO.length)];
  return out;
}

export type DesafioRow = { id: string; slug: string; molde: string; account_id: string | null; titulo: string; keyword: string; pacote: DesafioPacote; gasto_anuncio: string | null; moeda: string | null; ativo: boolean; atualizado_em: string };
const COLUNAS = "id, slug, molde, account_id, titulo, keyword, pacote, gasto_anuncio, moeda, ativo, atualizado_em";

/** Relê o pacote guardado pelo mesmo leitor (um pacote mexido à mão não quebra a DM). null = pacote ruim. */
function comPacote(row: (Omit<DesafioRow, "pacote"> & { pacote: unknown }) | undefined): DesafioRow | null {
  if (!row) return null;
  const lido = lerDesafio(row.pacote);
  return lido.ok ? { ...row, pacote: lido.pacote } : null;
}

async function slugLivre(slug: string, molde: string) {
  for (let i = 1; i < 50; i += 1) {
    const tentativa = i === 1 ? slug : `${slug.slice(0, 56).replace(/-+$/, "")}-${i}`;
    const { rows } = await query<{ molde: string }>("select molde from public.desafios where slug = $1", [tentativa]);
    if (!rows[0] || rows[0].molde === molde) return tentativa;
  }
  return `${slug.slice(0, 50).replace(/-+$/, "")}-${codigo(6)}`;
}

/** Cria ou atualiza o desafio do projeto (pelo id guardado na página, ou pelo mesmo código no mesmo projeto). */
export async function salvarDesafio(input: { id?: string | null; accountId: string | null; molde: string; slug: string; pacote: DesafioPacote }) {
  if (input.id) {
    const { rows } = await query<{ id: string; slug: string }>(
      `update public.desafios set titulo = $2, keyword = $3, pacote = $4::jsonb, account_id = coalesce($5, account_id), ativo = true, atualizado_em = now()
       where id = $1 and molde = $6 returning id, slug`,
      [input.id, input.pacote.titulo, input.pacote.keyword, JSON.stringify(input.pacote), input.accountId, input.molde],
    );
    if (rows[0]) return { ...rows[0], criado: false };
  }
  const slug = await slugLivre(input.slug, input.molde);
  const { rows } = await query<{ id: string; slug: string; criado: boolean }>(
    `insert into public.desafios (account_id, molde, slug, titulo, keyword, pacote) values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (slug) do update set titulo = excluded.titulo, keyword = excluded.keyword, pacote = excluded.pacote,
       account_id = coalesce(excluded.account_id, public.desafios.account_id), ativo = true, atualizado_em = now()
     where public.desafios.molde = excluded.molde
     returning id, slug, (xmax = 0) as criado`,
    [input.accountId, input.molde, slug, input.pacote.titulo, input.pacote.keyword, JSON.stringify(input.pacote)],
  );
  if (!rows[0]) throw new Error("Outro projeto já usa este endereço de desafio.");
  return rows[0];
}

/** O gasto de anúncio que o dono informou (null = apagar). false = não achou o desafio do projeto. */
export async function gravarGasto(id: string, molde: string, gasto: number | null, moeda: string | null) {
  const { rowCount } = await query("update public.desafios set gasto_anuncio = $3, moeda = coalesce($4, moeda), atualizado_em = now() where id = $1 and molde = $2", [id, molde, gasto, moeda]);
  return (rowCount ?? 0) > 0;
}

export async function getDesafioPorId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await query<Omit<DesafioRow, "pacote"> & { pacote: unknown }>(`select ${COLUNAS} from public.desafios where id = $1`, [id]);
  return comPacote(rows[0]);
}
export async function getDesafioPorSlug(slug: string) {
  const { rows } = await query<Omit<DesafioRow, "pacote"> & { pacote: unknown }>(`select ${COLUNAS} from public.desafios where slug = $1 and ativo`, [slug]);
  return comPacote(rows[0]);
}

/** Liga a automação do post ao desafio (o convite e o botão «Começar» já vão na automação). */
export async function ligarAutomacao(automationId: string, desafioId: string) {
  await query("update public.automations set desafio_id = $2 where id = $1", [automationId, desafioId]);
}

/** As respostas rápidas do convite (a 1ª mensagem do post): o botão «Começar». */
export function quickRepliesDoConvite(d: Pick<DesafioRow, "slug" | "pacote">) {
  return [{ title: d.pacote.botaoComecar, payload: payloadDesafio(d.slug, "comecar") }];
}

type Inscricao = { id: string; desafio_id: string; contact_id: string; variante: DesafioVariante; chave: string; dia: number; dia_em: string | null; canal: "dm" | "email"; lead_id: string | null; email_pedido_em: string | null };
const COLUNAS_INSCRICAO = "id, desafio_id, contact_id, variante, chave, dia, dia_em, canal, lead_id, email_pedido_em";

/** Quem comentou a palavra (e recebeu o convite) entra como «comentou», com a versão sorteada. Repetir não muda nada. */
export async function registrarConvite(input: { desafioId: string; accountId: string | null; contactId: string }): Promise<Inscricao | null> {
  const d = await getDesafioPorId(input.desafioId);
  if (!d) return null;
  const { rows: ja } = await query<Inscricao>(`select ${COLUNAS_INSCRICAO} from public.desafio_inscricoes where desafio_id = $1 and contact_id = $2`, [d.id, input.contactId]);
  if (ja[0]) return ja[0];
  const { rows: cont } = await query<{ variante: DesafioVariante; n: string }>("select variante, count(*) as n from public.desafio_inscricoes where desafio_id = $1 group by variante", [d.id]);
  const contagem = { A: 0, B: 0 };
  for (const c of cont) contagem[c.variante] = Number(c.n);
  const variante = sortearVariante(Boolean(d.pacote.variantes.B), contagem);
  await query(
    `insert into public.desafio_inscricoes (desafio_id, account_id, contact_id, variante, chave) values ($1, $2, $3, $4, $5)
     on conflict (desafio_id, contact_id) do nothing`,
    [d.id, input.accountId, input.contactId, variante, codigo()],
  );
  const { rows } = await query<Inscricao>(`select ${COLUNAS_INSCRICAO} from public.desafio_inscricoes where desafio_id = $1 and contact_id = $2`, [d.id, input.contactId]);
  return rows[0] ?? null;
}

/** O link da oferta da pessoa (conta o toque e leva ao checkout com o código de compra do desafio). */
export function linkDaOferta(base: string, slug: string, chave: string, de: "dm" | "email") {
  return `${base}/d/${slug}/ir?i=${chave}&de=${de}`;
}

type Envio = { accountId: string | null; contactId: string; instagramRecipientId: string; eventId: string | null };

/** Ainda dá para pedir o e-mail? (o envio de e-mail configurado e a Lista própria da 0013 no banco) */
async function podePedirEmail() {
  if (!emailConfig()) return false;
  const { rows } = await query<{ ok: boolean }>("select to_regclass('public.leads') is not null as ok");
  return Boolean(rows[0]?.ok);
}

/**
 * Põe na fila as mensagens de um dia no Direct, a partir de `quando`: o texto com o vídeo, (no dia 1) o pedido do e-mail e, por
 * último, a tarefa com o botão do dia seguinte (no dia 5, a tarefa e depois a oferta com o link). A resposta rápida só aparece
 * na última mensagem da conversa: por isso o botão vai sempre por último. Grava o envio do dia (marcado quando sai de verdade).
 */
async function enfileirarDia(d: DesafioRow, ins: Inscricao, n: number, quando: Date, envio: Envio) {
  const dia = diasDa(d.pacote, ins.variante)[n - 1];
  if (!dia) return null;
  const base = { accountId: envio.accountId, eventId: envio.eventId, contactId: envio.contactId, instagramRecipientId: envio.instagramRecipientId, sendType: "dm" as const };
  const marca = { origem: ORIGEM_DESAFIO, desafio: d.slug, dia: n };
  let t = quando.getTime();
  const proximo = () => new Date((t += 20_000) - 20_000);
  await enqueueJob({
    ...base,
    availableAt: proximo(),
    payload: dia.videoUrl ? { type: "media", mediaType: "video", mediaUrl: dia.videoUrl, text: dia.texto, ...marca, parte: "video" } : { type: "text", text: dia.texto, ...marca, parte: "texto" },
  });
  if (n === 1 && !ins.lead_id && (await podePedirEmail())) {
    await enqueueJob({ ...base, availableAt: proximo(), payload: { type: "text", text: d.pacote.pedidoEmail, ...marca, parte: "pedido_email" } });
    await query("update public.desafio_inscricoes set email_pedido_em = coalesce(email_pedido_em, now()) where id = $1", [ins.id]);
  }
  let principal: string | null;
  if (n < DESAFIO_DIAS) {
    principal = await enqueueJob({
      ...base,
      availableAt: proximo(),
      payload: { type: "text", text: dia.tarefa, quickReplies: [{ title: dia.botao, payload: payloadDesafio(d.slug, "prox") }], ...marca, parte: "tarefa", principal: true },
    });
  } else {
    await enqueueJob({ ...base, availableAt: proximo(), payload: { type: "text", text: dia.tarefa, ...marca, parte: "tarefa" } });
    principal = await enqueueJob({
      ...base,
      availableAt: proximo(),
      payload: { type: "link", text: d.pacote.oferta.texto || dia.tarefa, buttonLabel: d.pacote.oferta.rotulo, url: linkDaOferta(getAppBaseUrl(), d.slug, ins.chave, "dm"), ...marca, parte: "oferta", principal: true },
    });
  }
  await query(
    `insert into public.desafio_envios (inscricao_id, dia, canal, queue_id) values ($1, $2, 'dm', $3)
     on conflict (inscricao_id, dia, canal) do update set queue_id = excluded.queue_id, enviado_em = null, erro = null`,
    [ins.id, n, principal],
  );
  return principal;
}

/**
 * O toque num botão do desafio (resposta rápida: desafio:<slug>:comecar ou :prox). O toque é um gesto da pessoa: abre (ou
 * renova) a janela de 24 h da Meta.
 *   - «Começar» de quem ainda não começou: o dia 1 sai na hora.
 *   - O botão do dia: o dia seguinte entra na fila para 23 h depois (dentro da janela), com «Combinado!» agora. Um toque
 *     repetido antes de o dia sair não marca outro; quem estava recebendo por e-mail volta para o Direct.
 * false = desafio que não existe mais (ou sem a 0017): nada sai.
 */
export async function tocarDesafio(input: Envio & { payload: string; agora?: Date }) {
  const p = lerPayloadDesafio(input.payload);
  if (!p || !(await hasDesafioTables())) return false;
  const d = await getDesafioPorSlug(p.slug);
  if (!d || (d.account_id && input.accountId && d.account_id !== input.accountId)) return false;
  const ins = await registrarConvite({ desafioId: d.id, accountId: input.accountId, contactId: input.contactId });
  if (!ins) return false;
  const agora = input.agora ?? new Date();
  const T = textosDesafio(d.pacote.idioma);
  const ack = (text: string) => enqueueJob({ accountId: input.accountId, eventId: input.eventId, contactId: input.contactId, instagramRecipientId: input.instagramRecipientId, sendType: "dm", availableAt: agora, payload: { type: "text", text, origem: ORIGEM_DESAFIO, desafio: d.slug, parte: "combinado" } });

  if (ins.dia === 0) {
    const { rows } = await query<Inscricao>(
      `update public.desafio_inscricoes set dia = 1, dia_em = $2, inscrito_em = coalesce(inscrito_em, $2), canal = 'dm', atualizado_em = now()
       where id = $1 and dia = 0 returning ${COLUNAS_INSCRICAO}`,
      [ins.id, agora],
    );
    if (rows[0]) await enfileirarDia(d, rows[0], 1, agora, input);
    return true;
  }
  if (ins.dia >= DESAFIO_DIAS) {
    await ack(T.acabou);
    return true;
  }
  if (ins.canal === "dm" && ins.dia_em && new Date(ins.dia_em).getTime() > agora.getTime()) {
    await ack(T.jaMarcado(ins.dia)); // o dia já está na fila (toque repetido)
    return true;
  }
  const n = ins.dia + 1;
  const quando = new Date(agora.getTime() + HORAS_PROXIMO_DIA * 3_600_000);
  const { rows } = await query<Inscricao>(
    `update public.desafio_inscricoes set dia = $2, dia_em = $3, canal = 'dm', atualizado_em = now()
     where id = $1 and dia = $4 and (dia_em is null or dia_em <= $5) returning ${COLUNAS_INSCRICAO}`,
    [ins.id, n, quando, ins.dia, agora],
  );
  if (!rows[0]) return true; // outro toque chegou junto e já marcou
  await ack(T.combinado(n));
  await enfileirarDia(d, rows[0], n, quando, input);
  return true;
}

/**
 * A pessoa respondeu o pedido do e-mail (no Direct) com um endereço: entra na Lista própria (fonte «desafio», com o
 * consentimento = a frase do pedido) e recebe «Anotado!» com o botão do dia seguinte de novo (a resposta dela apaga o botão
 * da mensagem anterior). false = não era isso (segue o caminho normal da mensagem).
 */
export async function capturarEmailDesafio(input: Envio & { texto: string }) {
  const email = emailNoTexto(input.texto);
  if (!email || !(await hasDesafioTables())) return false;
  const { rows } = await query<Inscricao & { slug: string }>(
    `select ${COLUNAS_INSCRICAO.split(", ").map((c) => `i.${c}`).join(", ")}, d.slug from public.desafio_inscricoes i join public.desafios d on d.id = i.desafio_id
     where i.contact_id = $1 and i.email_pedido_em is not null and i.lead_id is null and i.email_pedido_em > now() - interval '7 days' and d.ativo
     order by i.email_pedido_em desc limit 1`,
    [input.contactId],
  );
  const ins = rows[0];
  if (!ins) return false;
  const d = await getDesafioPorId(ins.desafio_id);
  if (!d) return false;
  const lista = d.account_id || input.accountId || `molde:${d.molde}`;
  const { rows: lead } = await query<{ id: string }>(
    `insert into public.leads (account_id, molde, lista, email, fonte, desafio_id, consentimento, consentimento_texto, consentimento_em, chave)
     values ($1, $2, $3, lower($4), 'desafio', $5, true, $6, now(), $7)
     on conflict (lista, email) do update set desafio_id = coalesce(public.leads.desafio_id, excluded.desafio_id), consentimento = true,
       consentimento_texto = excluded.consentimento_texto, consentimento_em = now(), descadastrado_em = null, atualizado_em = now()
     returning id`,
    [d.account_id || input.accountId, d.molde, lista, email, d.id, d.pacote.pedidoEmail, codigo(20)],
  );
  await query("update public.desafio_inscricoes set lead_id = $2, atualizado_em = now() where id = $1", [ins.id, lead[0].id]);
  const dia = diasDa(d.pacote, ins.variante)[ins.dia - 1];
  const comBotao = ins.dia >= 1 && ins.dia < DESAFIO_DIAS && dia && !(ins.dia_em && new Date(ins.dia_em).getTime() > Date.now());
  await enqueueJob({
    accountId: input.accountId,
    eventId: input.eventId,
    contactId: input.contactId,
    instagramRecipientId: input.instagramRecipientId,
    sendType: "dm",
    payload: { type: "text", text: d.pacote.emailAnotado, ...(comBotao ? { quickReplies: [{ title: dia.botao, payload: payloadDesafio(d.slug, "prox") }] } : {}), origem: ORIGEM_DESAFIO, desafio: d.slug, parte: "email_anotado" },
  });
  return true;
}

/** A fila mandou a última mensagem de um dia no Direct: o dia conta como entregue (e o dia 5, como concluído). Nunca falha. */
export async function marcarEnvioDesafio(queueId: string) {
  try {
    if (!(await hasDesafioTables())) return;
    const { rows } = await query<{ inscricao_id: string; dia: number }>(
      "update public.desafio_envios set enviado_em = coalesce(enviado_em, now()) where queue_id = $1 returning inscricao_id, dia",
      [queueId],
    );
    for (const r of rows) if (r.dia === DESAFIO_DIAS) await query("update public.desafio_inscricoes set concluido_em = coalesce(concluido_em, now()) where id = $1", [r.inscricao_id]);
  } catch (error) {
    console.error("[desafio] não consegui marcar o dia entregue:", error instanceof Error ? error.message : error);
  }
}

/** O toque no botão da oferta (/d/<slug>/ir?i=<chave>): o código de compra do desafio e da versão, e o toque contado. */
export async function irParaOferta(slug: string, chave: string | null) {
  const d = await getDesafioPorSlug(slug);
  if (!d) return null;
  let variante: DesafioVariante = "A";
  if (chave && /^[a-z0-9]{12,40}$/.test(chave)) {
    const { rows } = await query<{ variante: DesafioVariante }>(
      "update public.desafio_inscricoes set clicou_oferta_em = coalesce(clicou_oferta_em, now()), atualizado_em = now() where chave = $1 and desafio_id = $2 returning variante",
      [chave, d.id],
    );
    if (rows[0]) variante = rows[0].variante;
  }
  const codigoCompra = codigoOrigem(`desafio:${d.slug}:${variante}`);
  await query("insert into public.desafio_origens (chave, desafio_id, variante) values ($1, $2, $3) on conflict (chave) do nothing", [codigoCompra, d.id, variante]);
  return checkoutComCodigo(d.pacote.oferta.url, codigoCompra);
}

/* ---------------- o e-mail de reserva (no relógio, a cada minuto) ---------------- */

export type DesafioClockResult = { enviados: number; erros: number; motivo?: "sem_tempo" | "sem_migracao" | "sem_email" | "erro" };

type Candidato = Inscricao & { email: string; codigo_lead: string; envio_dia_ok: boolean };

/**
 * Quem não tocou no botão em 24 h depois de um dia recebe o dia seguinte por e-mail; quem já está no e-mail recebe 1 dia a
 * cada 24 h, até o dia 5. Só com e-mail dado, consentimento, sem ter saído da lista nem pedido para parar no Direct, e com o
 * envio de e-mail configurado. Se o dia de antes não chegou pelo Direct (a fila pulou), o e-mail manda esse dia de novo.
 * Erro no envio: tenta de novo em 1 h, até 3 vezes. Nunca lança erro.
 */
export async function runDesafioClock(options: { deadline: number; origin?: string | null; now?: Date; enviar?: (config: EmailConfig, mensagem: EmailMensagem) => Promise<unknown> }): Promise<DesafioClockResult> {
  const out: DesafioClockResult = { enviados: 0, erros: 0 };
  try {
    if (options.deadline - Date.now() < 1500) return { ...out, motivo: "sem_tempo" };
    const config = emailConfig();
    if (!config) return { ...out, motivo: "sem_email" };
    if (!(await hasDesafioTables())) return { ...out, motivo: "sem_migracao" };
    const agora = options.now ?? new Date();
    const base = (process.env.APP_BASE_URL || options.origin || getAppBaseUrl()).replace(/\/+$/, "");
    const enviar = options.enviar ?? ((c: EmailConfig, m: EmailMensagem) => enviarEmail(c, m, Math.min(6000, Math.max(1000, options.deadline - Date.now() - 500))));
    const { rows } = await query<Candidato>(
      `select ${COLUNAS_INSCRICAO.split(", ").map((c) => `i.${c}`).join(", ")}, l.email, l.chave as codigo_lead,
              exists (select 1 from public.desafio_envios e where e.inscricao_id = i.id and e.dia = i.dia and e.enviado_em is not null) as envio_dia_ok
       from public.desafio_inscricoes i
       join public.desafios d on d.id = i.desafio_id and d.ativo
       join public.leads l on l.id = i.lead_id and l.consentimento and l.descadastrado_em is null
       join public.contacts c on c.id = i.contact_id and c.opted_out_at is null
       where i.dia between 1 and $2 and i.dia_em < $1::timestamptz - make_interval(hours => $3)
       order by i.dia_em limit 5`,
      [agora, DESAFIO_DIAS, HORAS_RESERVA],
    );
    for (const c of rows) {
      if (options.deadline - Date.now() < 1200) break;
      // O dia de antes não chegou (a fila pulou, ex.: passou da janela): o e-mail manda esse dia; senão, o seguinte.
      const n = c.envio_dia_ok ? c.dia + 1 : c.dia;
      if (n > DESAFIO_DIAS) continue;
      const { rows: tomado } = await query<{ id: string }>(
        `update public.desafio_inscricoes set dia = $2, dia_em = $3, canal = 'email', atualizado_em = now()
         where id = $1 and dia = $4 and canal = $5 and dia_em < $3::timestamptz - make_interval(hours => $6) returning id`,
        [c.id, n, agora, c.dia, c.canal, HORAS_RESERVA],
      );
      if (!tomado[0]) continue; // outro relógio (ou um toque) chegou antes
      const d = await getDesafioPorId(c.desafio_id);
      const dia = d ? diasDa(d.pacote, c.variante)[n - 1] : null;
      if (!d || !dia) continue;
      const descadastrarUrl = `${base}/lista/sair/${c.codigo_lead}`;
      const mensagem = emailDoDia({ pacote: d.pacote, dia, n, ofertaUrl: linkDaOferta(base, d.slug, c.chave, "email"), descadastrarUrl, enderecoPostal: config.enderecoPostal });
      try {
        await enviar(config, { para: c.email, ...mensagem, descadastrarUrl });
        await query(
          `insert into public.desafio_envios (inscricao_id, dia, canal, enviado_em) values ($1, $2, 'email', now())
           on conflict (inscricao_id, dia, canal) do update set enviado_em = now(), erro = null`,
          [c.id, n],
        );
        if (n === DESAFIO_DIAS) await query("update public.desafio_inscricoes set concluido_em = coalesce(concluido_em, now()) where id = $1", [c.id]);
        out.enviados += 1;
      } catch (error) {
        out.erros += 1;
        const motivo = error instanceof EmailError ? error.message : "Erro ao mandar o e-mail.";
        const { rows: e } = await query<{ tentativas: number }>(
          `insert into public.desafio_envios (inscricao_id, dia, canal, erro, tentativas) values ($1, $2, 'email', $3, 1)
           on conflict (inscricao_id, dia, canal) do update set erro = excluded.erro, tentativas = public.desafio_envios.tentativas + 1
           returning tentativas`,
          [c.id, n, motivo.slice(0, 300)],
        );
        // Volta para onde estava e tenta de novo em 1 h (dia_em recua para 23 h atrás); na 3ª falha do mesmo dia, para.
        const parar = (e[0]?.tentativas ?? 1) >= TENTATIVAS_EMAIL;
        await query(
          "update public.desafio_inscricoes set dia = $2, canal = $3, dia_em = $4, atualizado_em = now() where id = $1",
          [c.id, c.dia, c.canal, parar ? null : new Date(agora.getTime() - (HORAS_RESERVA - 1) * 3_600_000)],
        );
      }
    }
    return out;
  } catch (error) {
    console.error("[desafio] relógio do e-mail de reserva:", error instanceof Error ? error.message : error);
    return { ...out, motivo: "erro" };
  }
}

/* ---------------- os números (o painel do Molde) ---------------- */

export type NumerosDesafio = {
  comentaram: number;
  inscritos: number;
  porDia: number[];
  comEmail: number;
  emailsReserva: number;
  cliques: number;
  compras: number;
  receita: number;
};
export type DesafioComNumeros = {
  id: string;
  slug: string;
  titulo: string;
  keyword: string;
  ativo: boolean;
  atualizadoEm: string;
  temB: boolean;
  gastoAnuncio: number | null;
  moeda: string | null;
  numeros: NumerosDesafio;
  porVariante: { A: NumerosDesafio; B: NumerosDesafio | null };
  custoPorVenda: number | null;
  comparacao: Comparacao;
};

function vazio(): NumerosDesafio {
  return { comentaram: 0, inscritos: 0, porDia: [0, 0, 0, 0, 0], comEmail: 0, emailsReserva: 0, cliques: 0, compras: 0, receita: 0 };
}

/** As vendas pagas casadas pelo código do desafio (precisa da 0012: vendas.origem). Sem ela, 0. */
async function comprasPorVariante(ids: string[]) {
  const out = new Map<string, { variante: DesafioVariante; n: number; valor: number }[]>();
  if (!ids.length) return out;
  const { rows: tem } = await query<{ ok: boolean }>(
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vendas' and column_name = 'origem') as ok",
  );
  if (!tem[0]?.ok) return out;
  const { rows } = await query<{ desafio_id: string; variante: DesafioVariante; n: string; valor: string | null }>(
    `select o.desafio_id, o.variante, count(*) as n, sum(v.valor) as valor from public.vendas v join public.desafio_origens o on o.chave = v.origem
     where o.desafio_id = any($1::uuid[]) and v.status = 'paga' and not v.teste group by o.desafio_id, o.variante`,
    [ids],
  );
  for (const r of rows) {
    if (!out.has(r.desafio_id)) out.set(r.desafio_id, []);
    out.get(r.desafio_id)!.push({ variante: r.variante, n: Number(r.n), valor: Number(r.valor ?? 0) });
  }
  return out;
}

/** Os desafios do projeto com os números: no total e por versão, o funil dia a dia, o custo por venda e a comparação A/B. */
export async function listarDesafios(molde: string): Promise<DesafioComNumeros[]> {
  const { rows } = await query<Omit<DesafioRow, "pacote"> & { pacote: unknown }>(`select ${COLUNAS} from public.desafios where molde = $1 order by atualizado_em desc limit 20`, [molde]);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { rows: ins } = await query<{ desafio_id: string; variante: DesafioVariante; comentaram: string; inscritos: string; com_email: string; cliques: string }>(
    `select desafio_id, variante, count(*) as comentaram, count(inscrito_em) as inscritos, count(lead_id) as com_email, count(clicou_oferta_em) as cliques
     from public.desafio_inscricoes where desafio_id = any($1::uuid[]) group by desafio_id, variante`,
    [ids],
  );
  const { rows: dias } = await query<{ desafio_id: string; variante: DesafioVariante; dia: number; chegaram: string; emails: string }>(
    `select i.desafio_id, i.variante, e.dia, count(distinct e.inscricao_id) as chegaram, count(*) filter (where e.canal = 'email') as emails
     from public.desafio_envios e join public.desafio_inscricoes i on i.id = e.inscricao_id
     where i.desafio_id = any($1::uuid[]) and e.enviado_em is not null group by i.desafio_id, i.variante, e.dia`,
    [ids],
  );
  const compras = await comprasPorVariante(ids);
  return rows.map((r) => {
    const lido = lerDesafio(r.pacote);
    const temB = Boolean(lido.ok && lido.pacote.variantes.B);
    const pv: { A: NumerosDesafio; B: NumerosDesafio } = { A: vazio(), B: vazio() };
    for (const x of ins.filter((y) => y.desafio_id === r.id)) {
      const n = pv[x.variante];
      n.comentaram += Number(x.comentaram);
      n.inscritos += Number(x.inscritos);
      n.comEmail += Number(x.com_email);
      n.cliques += Number(x.cliques);
    }
    for (const x of dias.filter((y) => y.desafio_id === r.id)) {
      const n = pv[x.variante];
      if (x.dia >= 1 && x.dia <= DESAFIO_DIAS) n.porDia[x.dia - 1] += Number(x.chegaram);
      n.emailsReserva += Number(x.emails);
    }
    for (const c of compras.get(r.id) ?? []) {
      pv[c.variante].compras += c.n;
      pv[c.variante].receita += c.valor;
    }
    const total = vazio();
    for (const v of [pv.A, pv.B]) {
      total.comentaram += v.comentaram;
      total.inscritos += v.inscritos;
      total.comEmail += v.comEmail;
      total.emailsReserva += v.emailsReserva;
      total.cliques += v.cliques;
      total.compras += v.compras;
      total.receita += v.receita;
      v.porDia.forEach((x, i) => (total.porDia[i] += x));
    }
    const gasto = r.gasto_anuncio === null ? null : Number(r.gasto_anuncio);
    return {
      id: r.id,
      slug: r.slug,
      titulo: r.titulo,
      keyword: r.keyword,
      ativo: r.ativo,
      atualizadoEm: r.atualizado_em,
      temB,
      gastoAnuncio: gasto,
      moeda: r.moeda,
      numeros: total,
      porVariante: { A: pv.A, B: temB ? pv.B : null },
      custoPorVenda: gasto !== null && total.compras > 0 ? Math.round((gasto / total.compras) * 100) / 100 : null,
      comparacao: compararVariantes(
        { inscritos: pv.A.inscritos, dia5: pv.A.porDia[4], compras: pv.A.compras },
        temB ? { inscritos: pv.B.inscritos, dia5: pv.B.porDia[4], compras: pv.B.compras } : null,
        AMOSTRA_MINIMA,
      ),
    };
  });
}
