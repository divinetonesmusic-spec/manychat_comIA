/**
 * As contas do app por assinatura (0018), puras: o dia no fuso da pessoa, a noite da rotina («Noite N de 30»), os dias seguidos,
 * até quando a assinatura dá acesso e os números da decisão dos 60 dias. Sem banco e sem Node.
 */
import { APP_DIAS } from "@/lib/app/pacote";

/** O mês que uma cobrança cobre (31 dias: o mês mais longo) — depois disso, sem renovação, o acesso vence (com a carência). */
export const PERIODO_DIAS = 31;
export const CARENCIA_PADRAO = 3;
const DIA_MS = 86_400_000;

/** O fuso é um nome que o Intl conhece (America/Sao_Paulo…)? */
export function fusoValido(fuso: unknown): fuso is string {
  if (typeof fuso !== "string" || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(fuso) || fuso.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** O dia (AAAA-MM-DD) de um momento no fuso. */
export function diaLocal(momento: Date, fuso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fusoValido(fuso) ? fuso : "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(momento);
}
function diaMenos(dia: string, n: number) {
  const d = new Date(`${dia}T12:00:00Z`);
  return new Date(d.getTime() - n * DIA_MS).toISOString().slice(0, 10);
}

/**
 * Dias seguidos: conta para trás a partir de hoje (ou de ontem, se hoje ainda não tocou — a sequência só quebra quando passa um
 * dia inteiro sem tocar). `dias` = os dias com uso (AAAA-MM-DD), em qualquer ordem.
 */
export function diasSeguidos(dias: string[], hoje: string) {
  const set = new Set(dias);
  let d = set.has(hoje) ? hoje : diaMenos(hoje, 1);
  let n = 0;
  while (set.has(d)) {
    n += 1;
    d = diaMenos(d, 1);
  }
  return n;
}

/**
 * A noite da rotina: a próxima que falta (quem já tocou hoje vê a de hoje). Depois da 30ª, a rotina recomeça (ciclo 2, 3…).
 * `feitos` = quantos dias diferentes a pessoa já tocou; `tocouHoje` = se um deles é hoje.
 */
export function noiteDe(feitos: number, tocouHoje: boolean) {
  const base = Math.max(0, Math.floor(feitos) - (tocouHoje ? 1 : 0));
  return { noite: (base % APP_DIAS) + 1, ciclo: Math.floor(base / APP_DIAS) + 1, total: APP_DIAS };
}

export type SituacaoAssinatura = "ativo" | "atrasada" | "cancelada" | "reembolsada" | "chargeback";
export type TipoPagamento = "aprovada" | "renovada" | "cancelada" | "atrasada" | "reembolsada" | "chargeback";

/**
 * O acesso depois de um aviso da plataforma (puro). Pagou (aprovada/renovada): ativo até o pagamento + 31 dias + a carência
 * (assim, numa plataforma que não avisa o cancelamento, o acesso vence sozinho quando a renovação não vem). Cancelada, atrasada,
 * reembolsada ou chargeback: o acesso vai até o fim da carência, contada do aviso (nunca além do que já tinha).
 */
export function acessoDepois(input: { tipo: TipoPagamento; em: Date; acessoAte: Date | null; carenciaDias: number }) {
  const carencia = Math.max(0, input.carenciaDias) * DIA_MS;
  if (input.tipo === "aprovada" || input.tipo === "renovada") {
    const ate = new Date(input.em.getTime() + PERIODO_DIAS * DIA_MS + carencia);
    return { status: "ativo" as SituacaoAssinatura, acessoAte: input.acessoAte && input.acessoAte > ate ? input.acessoAte : ate };
  }
  const fim = new Date(input.em.getTime() + carencia);
  const ate = input.acessoAte && input.acessoAte < fim ? input.acessoAte : fim;
  return { status: input.tipo as SituacaoAssinatura, acessoAte: ate };
}

/** Tem acesso agora? */
export function temAcesso(acessoAte: Date | string | null, agora = new Date()) {
  if (!acessoAte) return false;
  return new Date(acessoAte).getTime() > agora.getTime();
}

/* ---------------- os números do teste (base da decisão dos 60 dias) ---------------- */

export type NumerosApp = {
  ativos: number;
  emCarencia: number;
  novos30: number;
  cancelamentos30: number;
  retencao2: { elegiveis: number; retidos: number; taxa: number | null };
  uso: { tocaramHoje: number; semana: number | null; seguidosMedia: number | null; quatroDias: number | null };
  receita30: Record<string, number>;
  mrr: Record<string, number>;
  diasDeTeste: number | null;
};

/** Uma taxa (0 a 1) com 2 casas, ou null sem base. */
export function taxa(parte: number, todo: number) {
  return todo > 0 ? Math.round((parte / todo) * 100) / 100 : null;
}

/**
 * O critério dos 60 dias para ir (ou não) a uma loja de apps — proposto na v134 e repetido na página do Molde:
 *  1 · retenção no 2º mês ≥ 50% (de quem assinou há 35 dias ou mais, quantos pagaram o 2º mês), com pelo menos 20 pessoas;
 *  2 · receita mensal (as assinaturas ativas) ≥ US$ 500 (R$ 2.500 no Brasil): paga a taxa da loja (15%) e o trabalho do app nativo;
 *  3 · hábito: ≥ 40% dos ativos tocaram 4 dias ou mais na última semana (a notificação do app nativo vale a pena).
 * 3 de 3 → loja de apps; 2 de 3 → mais 30 dias; 0 ou 1 → ficar na página-app (ou mudar a oferta). Antes de 60 dias, «espere».
 */
export const DECISAO_60 = { dias: 60, retencao: 0.5, minimoRetencao: 20, receita: { USD: 500, BRL: 2500 } as Record<string, number>, habito: 0.4 };
export function decisao60(n: NumerosApp, moeda: "USD" | "BRL") {
  const criterios = [
    { id: "retencao", ok: n.retencao2.elegiveis >= DECISAO_60.minimoRetencao && (n.retencao2.taxa ?? 0) >= DECISAO_60.retencao },
    { id: "receita", ok: (n.mrr[moeda] ?? 0) >= DECISAO_60.receita[moeda] },
    { id: "habito", ok: (n.uso.quatroDias ?? 0) >= DECISAO_60.habito },
  ];
  const passou = criterios.filter((c) => c.ok).length;
  const pronto = (n.diasDeTeste ?? 0) >= DECISAO_60.dias;
  const veredito = !pronto ? "esperar" : passou === 3 ? "loja" : passou === 2 ? "mais30" : "ficar";
  return { pronto, passou, criterios, veredito };
}
