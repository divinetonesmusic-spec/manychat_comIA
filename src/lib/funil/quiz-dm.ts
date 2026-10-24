import { addContactTag, enqueueJob } from "@/lib/db/repositories";
import { getQuizPublico } from "@/lib/db/funil-molde";
import { getAppBaseUrl } from "@/lib/env";
import { origemValida } from "@/lib/funil/quiz";

/**
 * «Começar pela pergunta do quiz» (0013): a 1ª mensagem da DM do post é a 1ª pergunta do quiz, com um botão por perfil
 * (respostas rápidas). O toque marca a etiqueta do perfil no contato e a resposta leva o link do quiz já com o perfil
 * (/q/<slug>?perfil=<id>&de=dm&o=<código do post>). Vem no pacote do post: automationOptions.quizDm.
 */
export type QuizDmPost = { slug: string; texto: string; botoes: Array<{ rotulo: string; perfilId: string }>; origem: string | null };

export const QUIZ_PAYLOAD = "quiz:";
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

/** undefined = não veio (ou veio errado: o post sai como antes, com a 1ª mensagem de sempre). */
export function parseQuizDm(value: unknown): QuizDmPost | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  const slug = typeof r.slug === "string" ? r.slug.trim() : "";
  const texto = typeof r.texto === "string" ? r.texto.trim().slice(0, 1000) : "";
  const botoes = (Array.isArray(r.botoes) ? r.botoes : []).map((b) => {
    const x = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    return { rotulo: typeof x.rotulo === "string" ? x.rotulo.trim().slice(0, 20) : "", perfilId: typeof x.perfilId === "string" ? x.perfilId.trim() : "" };
  }).filter((b) => b.rotulo && ID_RE.test(b.perfilId)).slice(0, 4);
  if (!SLUG_RE.test(slug) || !texto || botoes.length < 2) return undefined;
  return { slug, texto, botoes, origem: origemValida(r.origem) };
}

/** As respostas rápidas da 1ª mensagem: o payload leva o quiz, o perfil e o código do post. */
export function quickRepliesDoQuiz(q: QuizDmPost) {
  return q.botoes.map((b) => ({ title: b.rotulo, payload: `${QUIZ_PAYLOAD}${q.slug}:${b.perfilId}:${q.origem ?? ""}` }));
}

export function lerPayloadQuiz(payload: string) {
  if (!payload.startsWith(QUIZ_PAYLOAD)) return null;
  const [slug, perfilId, origem] = payload.slice(QUIZ_PAYLOAD.length).split(":");
  if (!SLUG_RE.test(slug || "") || !ID_RE.test(perfilId || "")) return null;
  return { slug, perfilId, origem: origemValida(origem) };
}

export function linkDoQuiz(base: string, slug: string, perfilId: string, origem: string | null) {
  const url = new URL(`${base}/q/${slug}`);
  url.searchParams.set("perfil", perfilId);
  url.searchParams.set("de", "dm");
  if (origem) url.searchParams.set("o", origem);
  return url.toString();
}

/**
 * O toque num botão da pergunta do quiz na DM: etiqueta do perfil no contato e a mensagem com o link do quiz.
 * false = o quiz não existe mais (ou a 0013 não foi colada): nada sai.
 */
export async function responderQuizDm(input: { accountId: string; contactId: string; instagramRecipientId: string; eventId: string | null; payload: string }) {
  const p = lerPayloadQuiz(input.payload);
  if (!p) return false;
  const q = await getQuizPublico(p.slug);
  if (!q || (q.accountId && q.accountId !== input.accountId) || !q.quiz.perfis.some((x) => x.id === p.perfilId)) return false;
  await addContactTag(input.contactId, `perfil:${p.perfilId}`);
  const en = q.quiz.idioma !== "pt-BR";
  await enqueueJob({
    accountId: input.accountId,
    eventId: input.eventId,
    contactId: input.contactId,
    instagramRecipientId: input.instagramRecipientId,
    sendType: "dm",
    payload: {
      type: "link",
      text: q.quiz.dmResposta || (en ? "Got it! Take the 1-minute quiz to see your full result and your plan:" : "Entendi! Faça o quiz de 1 minuto para ver o seu resultado completo e o seu plano:"),
      buttonLabel: en ? "Take the quiz" : "Fazer o quiz",
      url: linkDoQuiz(getAppBaseUrl(), q.slug, p.perfilId, p.origem),
      origem: "quiz_dm",
    },
  });
  return true;
}
