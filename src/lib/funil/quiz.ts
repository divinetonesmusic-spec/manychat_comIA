/**
 * O quiz do Molde (0013): o pacote que a página do Molde manda (POST /api/molde/quiz), conferido aqui, e as regras que o
 * servidor e a página pública (/q/<código>) usam juntos: a pontuação das respostas, o código da origem do checkout e o
 * endereço da oferta de cada perfil. Sem banco e sem nada do Node: roda no servidor e no navegador.
 */
import { lerMarca, type Marca } from "@/lib/funil/marca";

export const QUIZ_TIPOS = ["botoes", "imagem", "escala"] as const;
export type QuizTipo = (typeof QUIZ_TIPOS)[number];
export type QuizIdioma = "pt-BR" | "en-US" | "es";

export type QuizOpcao = { texto: string; imagem: string | null; pesos: Record<string, number> };
export type QuizPergunta = { texto: string; ajuda: string; tipo: QuizTipo; opcoes: QuizOpcao[] };
export type QuizOferta = { nome: string; preco: number | null; moeda: string; garantia: string; checkout: string | null; rotulo: string };
export type QuizPerfil = { id: string; nome: string; causa: string; miniPlano: string[]; projecao: string; ofertaDegrau: string; oferta: QuizOferta };
export type QuizProva = { tipo: "numero"; numero: string; texto: string } | { tipo: "como"; passos: string[] };
export type QuizDm = { texto: string; botoes: Array<{ rotulo: string; perfilId: string }> };
export type QuizPacote = {
  titulo: string;
  subtitulo: string;
  idioma: QuizIdioma;
  minutos: number;
  perfis: QuizPerfil[];
  perguntas: QuizPergunta[];
  provaSocial: QuizProva;
  provaDepois: number; // a tela de prova aparece depois desta pergunta (1 = depois da 1ª)
  dmPergunta: QuizDm | null;
  dmResposta: string; // a mensagem da DM que leva o link do quiz, depois do toque no botão
  marca: Marca;
  aviso: string; // o rodapé (ex.: «Personagem criado com IA.»); vazio = nenhum
};

export const QUIZ_LIMITES = { perfisMin: 2, perfisMax: 4, perguntasMin: 4, perguntasMax: 10, opcoesMin: 2, opcoesMax: 6, botoesDmMax: 4 };
/** Marca do lugar da origem no checkout: a página do Molde põe este texto onde vai o código (rec131ComOrigem); o servidor troca. */
export const ORIGEM_MARCA = "MOQUIZORIGEM";
const ID_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

function txt(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";
}
function urlHttps(value: unknown, max = 2000) {
  const t = txt(value, max);
  if (!/^https:\/\/[^\s]+$/i.test(t)) return null;
  try {
    return new URL(t).protocol === "https:" ? t : null;
  } catch {
    return null;
  }
}
function idDe(value: unknown) {
  const t = txt(value, 40).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return ID_RE.test(t) ? t : "";
}
function lista(value: unknown, max: number, maxLen: number) {
  const L = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n+/) : [];
  return L.map((x) => txt(typeof x === "string" ? x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "") : x, maxLen)).filter(Boolean).slice(0, max);
}

/** O código do quiz na URL: letras minúsculas, números e hífen (3 a 60). "" quando não dá. */
export function slugDe(value: unknown) {
  const t = txt(value, 120).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(t) ? t : "";
}

/** O mesmo código curto da página do Molde (rec131Codigo, v131r): «mo» + o resumo FNV-1a em base 36. */
export function codigoOrigem(texto: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `mo${(h >>> 0).toString(36)}`;
}

/** O código da compra de um perfil vinda de um post: muda com o quiz, o perfil e o post (o mesmo trio, o mesmo código). */
export function codigoDoPerfil(quizSlug: string, perfilId: string, origemPost: string | null) {
  return codigoOrigem(`quiz:${quizSlug}:${perfilId}:${origemPost || ""}`);
}

/**
 * O endereço da oferta do perfil: o checkout com o código no lugar da marca (ou, sem a marca, com ?src=) e ?perfil=<id>.
 * null quando o perfil não tem checkout.
 */
export function checkoutDoPerfil(perfil: Pick<QuizPerfil, "id" | "oferta">, codigo: string) {
  const base = perfil.oferta.checkout;
  if (!base) return null;
  try {
    const comCodigo = base.includes(ORIGEM_MARCA) ? base.split(ORIGEM_MARCA).join(codigo) : base;
    const url = new URL(comCodigo);
    if (!base.includes(ORIGEM_MARCA) && !url.searchParams.has("src")) url.searchParams.set("src", codigo);
    url.searchParams.set("perfil", perfil.id);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export type QuizLido = { ok: true; quiz: QuizPacote; avisos: string[] } | { ok: false; erros: string[] };

/** Confere o pacote do quiz. Erros = o quiz não pode ir ao ar; avisos = vai, mas vale olhar. */
export function lerQuiz(entrada: unknown): QuizLido {
  const erros: string[] = [];
  const avisos: string[] = [];
  const q = entrada && typeof entrada === "object" && !Array.isArray(entrada) ? (entrada as Record<string, unknown>) : {};
  const titulo = txt(q.titulo, 120);
  if (!titulo) erros.push("Falta o título do quiz.");
  const idioma: QuizIdioma = q.idioma === "en-US" || q.idioma === "es" ? q.idioma : "pt-BR";

  const perfis: QuizPerfil[] = [];
  const vistos = new Set<string>();
  (Array.isArray(q.perfis) ? q.perfis : []).slice(0, QUIZ_LIMITES.perfisMax + 2).forEach((x, i) => {
    const p = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const id = idDe(p.id) || `perfil-${i + 1}`;
    const nome = txt(p.nome, 60);
    if (!nome) return erros.push(`O perfil ${i + 1} está sem nome.`);
    if (vistos.has(id)) return erros.push(`Dois perfis com o mesmo código (${id}).`);
    vistos.add(id);
    const o = p.oferta && typeof p.oferta === "object" ? (p.oferta as Record<string, unknown>) : {};
    const precoNum = typeof o.preco === "number" ? o.preco : typeof o.preco === "string" ? Number(o.preco.replace(",", ".")) : NaN;
    const checkoutTxt = txt(o.checkout, 2000);
    const checkout = urlHttps(checkoutTxt.split(ORIGEM_MARCA).join("mo0"), 2000) ? checkoutTxt : null;
    if (checkoutTxt && !checkout) erros.push(`O link da oferta do perfil «${nome}» precisa começar com https://`);
    const perfil: QuizPerfil = {
      id,
      nome,
      causa: txt(p.causa, 500),
      miniPlano: lista(p.miniPlano, 5, 200),
      projecao: txt(p.projecao, 300),
      ofertaDegrau: txt(p.ofertaDegrau, 60),
      oferta: {
        nome: txt(o.nome, 80),
        preco: Number.isFinite(precoNum) && precoNum >= 0 ? Math.round(precoNum * 100) / 100 : null,
        moeda: txt(o.moeda, 4) || (idioma === "pt-BR" ? "R$" : "US$"),
        garantia: txt(o.garantia, 200),
        checkout,
        rotulo: txt(o.rotulo, 40),
      },
    };
    if (!perfil.causa) erros.push(`O perfil «${nome}» está sem a causa.`);
    if (!perfil.projecao) avisos.push(`O perfil «${nome}» está sem a projeção.`);
    if (!perfil.oferta.checkout) avisos.push(`O perfil «${nome}» está sem o link da oferta: o resultado mostra o plano, sem o botão de compra.`);
    perfis.push(perfil);
  });
  if (perfis.length < QUIZ_LIMITES.perfisMin) erros.push(`O quiz precisa de ${QUIZ_LIMITES.perfisMin} a ${QUIZ_LIMITES.perfisMax} perfis.`);
  if (perfis.length > QUIZ_LIMITES.perfisMax) erros.push(`No máximo ${QUIZ_LIMITES.perfisMax} perfis.`);
  const ids = new Set(perfis.map((p) => p.id));

  const perguntas: QuizPergunta[] = [];
  (Array.isArray(q.perguntas) ? q.perguntas : []).slice(0, QUIZ_LIMITES.perguntasMax + 2).forEach((x, i) => {
    const p = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const texto = txt(p.texto, 200);
    if (!texto) return erros.push(`A pergunta ${i + 1} está sem texto.`);
    const tipo: QuizTipo = QUIZ_TIPOS.includes(p.tipo as QuizTipo) ? (p.tipo as QuizTipo) : "botoes";
    const opcoes: QuizOpcao[] = (Array.isArray(p.opcoes) ? p.opcoes : []).slice(0, QUIZ_LIMITES.opcoesMax).map((y) => {
      const o = y && typeof y === "object" ? (y as Record<string, unknown>) : {};
      const pesos: Record<string, number> = {};
      const pw = o.pesos && typeof o.pesos === "object" ? (o.pesos as Record<string, unknown>) : {};
      for (const [k, v] of Object.entries(pw)) {
        const id = idDe(k);
        const n = typeof v === "number" ? v : Number(v);
        if (ids.has(id) && Number.isFinite(n) && n > 0) pesos[id] = Math.min(5, Math.round(n * 10) / 10);
      }
      return { texto: txt(o.texto, 90), imagem: urlHttps(o.imagem), pesos };
    }).filter((o) => o.texto);
    if (opcoes.length < QUIZ_LIMITES.opcoesMin) return erros.push(`A pergunta ${i + 1} precisa de pelo menos ${QUIZ_LIMITES.opcoesMin} opções.`);
    if (tipo === "imagem" && opcoes.some((o) => !o.imagem)) avisos.push(`A pergunta ${i + 1} é de imagens, mas nem toda opção tem imagem: elas aparecem como botões.`);
    perguntas.push({ texto, ajuda: txt(p.ajuda, 160), tipo: tipo === "imagem" && opcoes.some((o) => !o.imagem) ? "botoes" : tipo, opcoes });
  });
  if (perguntas.length < QUIZ_LIMITES.perguntasMin) erros.push(`O quiz precisa de ${QUIZ_LIMITES.perguntasMin} a ${QUIZ_LIMITES.perguntasMax} perguntas (o bom é de 6 a 8).`);
  if (perguntas.length > QUIZ_LIMITES.perguntasMax) erros.push(`No máximo ${QUIZ_LIMITES.perguntasMax} perguntas.`);
  // nada de resultado genérico: todo perfil tem que poder sair, e cada pergunta tem que separar os perfis
  for (const p of perfis) {
    if (!perguntas.some((pg) => pg.opcoes.some((o) => (o.pesos[p.id] ?? 0) > 0))) erros.push(`Nenhuma resposta leva ao perfil «${p.nome}».`);
  }
  perguntas.forEach((pg, i) => {
    const marcas = new Set(pg.opcoes.map((o) => JSON.stringify(Object.entries(o.pesos).sort())));
    if (marcas.size < 2 && i > 0) avisos.push(`A pergunta ${i + 1} não separa os perfis (todas as respostas pesam igual).`);
  });

  const pv = q.provaSocial && typeof q.provaSocial === "object" ? (q.provaSocial as Record<string, unknown>) : {};
  const numero = txt(pv.numero, 40);
  const provaSocial: QuizProva = pv.tipo === "numero" && numero && /\d/.test(numero)
    ? { tipo: "numero", numero, texto: txt(pv.texto, 160) }
    : { tipo: "como", passos: lista(pv.passos, 3, 140) };

  let dmPergunta: QuizDm | null = null;
  const dm = q.dmPergunta && typeof q.dmPergunta === "object" ? (q.dmPergunta as Record<string, unknown>) : null;
  if (dm) {
    const botoes = (Array.isArray(dm.botoes) ? dm.botoes : []).map((b) => {
      const r = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
      return { rotulo: txt(r.rotulo, 20), perfilId: idDe(r.perfilId) };
    }).filter((b) => b.rotulo && ids.has(b.perfilId)).slice(0, QUIZ_LIMITES.botoesDmMax);
    const texto = txt(dm.texto, 600);
    if (texto && botoes.length >= 2) dmPergunta = { texto, botoes };
    else if (texto || botoes.length) avisos.push("A pergunta da DM precisa do texto e de 2 a 4 botões, cada um com um perfil: ficou de fora.");
  }

  if (erros.length) return { ok: false, erros };
  return {
    ok: true,
    avisos,
    quiz: {
      titulo,
      subtitulo: txt(q.subtitulo, 220),
      idioma,
      minutos: Math.min(10, Math.max(1, Math.round(Number(q.minutos) || 2))),
      perfis,
      perguntas,
      provaSocial,
      provaDepois: Math.min(perguntas.length - 1, Math.max(1, Math.round(Number(q.provaDepois) || Math.ceil(perguntas.length / 2)))),
      dmPergunta,
      dmResposta: txt(q.dmResposta, 600),
      marca: lerMarca(q.marca),
      aviso: txt(q.aviso, 200),
    },
  };
}

/**
 * O perfil pelas respostas (o índice da opção de cada pergunta; -1 = pulou). A pergunta da DM (perfilDm) vale como uma
 * resposta a mais (peso 2). Empate: o perfil da DM, depois a ordem dos perfis. Nunca devolve um perfil que não existe.
 */
export function pontuar(quiz: Pick<QuizPacote, "perfis" | "perguntas">, respostas: unknown, perfilDm?: string | null) {
  const placar = new Map(quiz.perfis.map((p) => [p.id, 0]));
  const R = Array.isArray(respostas) ? respostas : [];
  quiz.perguntas.forEach((pg, i) => {
    const k = Number(R[i]);
    const op = Number.isInteger(k) && k >= 0 ? pg.opcoes[k] : undefined;
    if (!op) return;
    for (const [id, n] of Object.entries(op.pesos)) if (placar.has(id)) placar.set(id, (placar.get(id) ?? 0) + n);
  });
  if (perfilDm && placar.has(perfilDm)) placar.set(perfilDm, (placar.get(perfilDm) ?? 0) + 2);
  let melhor = quiz.perfis[0]?.id ?? "";
  for (const p of quiz.perfis) {
    const a = placar.get(p.id) ?? 0;
    const b = placar.get(melhor) ?? 0;
    if (a > b || (a === b && p.id === perfilDm && melhor !== perfilDm)) melhor = p.id;
  }
  return melhor;
}

/** As respostas guardadas: só índices válidos de cada pergunta (o resto vira -1). */
export function respostasValidas(quiz: Pick<QuizPacote, "perguntas">, respostas: unknown) {
  const R = Array.isArray(respostas) ? respostas : [];
  return quiz.perguntas.map((pg, i) => {
    const k = Number(R[i]);
    return Number.isInteger(k) && k >= 0 && k < pg.opcoes.length ? k : -1;
  });
}

/** Duas respostas da pessoa que mais puxaram para o perfil dela (o «espelho» do resultado). */
export function respostasEspelho(quiz: Pick<QuizPacote, "perguntas">, respostas: number[], perfilId: string) {
  return quiz.perguntas
    .map((pg, i) => ({ pg, op: respostas[i] >= 0 ? pg.opcoes[respostas[i]] : undefined }))
    .filter((x): x is { pg: QuizPergunta; op: QuizOpcao } => Boolean(x.op && (x.op.pesos[perfilId] ?? 0) > 0))
    .sort((a, b) => (b.op.pesos[perfilId] ?? 0) - (a.op.pesos[perfilId] ?? 0))
    .slice(0, 2)
    .map((x) => x.op.texto);
}

/** «R$ 47» / «US$ 27» (sem centavos quando é inteiro). */
export function precoTexto(oferta: Pick<QuizOferta, "preco" | "moeda">) {
  if (oferta.preco === null) return "";
  const n = Number.isInteger(oferta.preco) ? String(oferta.preco) : oferta.preco.toFixed(2).replace(".", oferta.moeda === "R$" ? "," : ".");
  return `${oferta.moeda} ${n}`;
}

/** O código de origem só se for o do contrato (mo + até 7 letras/números). */
export function origemValida(value: unknown) {
  const t = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^mo[a-z0-9]{1,7}$/.test(t) ? t : null;
}
export function deValido(value: unknown) {
  return value === "bio" || value === "dm" || value === "comentario" || value === "story" ? value : value ? "outro" : null;
}
