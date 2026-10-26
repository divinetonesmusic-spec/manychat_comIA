/**
 * O app por assinatura do Molde (0018, /a/<slug>): o pacote que a página do Molde manda (POST /api/molde/apps), conferido aqui.
 * Um produto pronto (PDF/áudios) vira um app de 1 toque: a rotina de 30 dias (o que tocar e fazer em cada dia), de 2 a 8 áudios
 * (cada dia aponta para um), o preço por mês (abaixo do teto de entrada), o link de pagamento da assinatura e o texto do lembrete.
 * Tudo puro (sem banco e sem Node): os testes e as páginas usam o mesmo leitor.
 */
import { lerMarca, type Marca } from "@/lib/funil/marca";
import { slugDe } from "@/lib/funil/quiz";

export const APP_DIAS = 30;
export const APP_AUDIOS = [2, 8] as const;
/** O teto do preço de entrada por mês (decisão do dono, 25/10/2026: abaixo de US$ 27/mês). No Brasil, o teto da faixa de entrada. */
export const APP_TETO = { USD: 26.99, BRL: 47 } as const;
export const APP_AUDIO_TIPOS: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg" };
/** Cada áudio até 25 MB (uns 25 minutos em mp3 de 128 kbps): o celular guarda para tocar sem internet. */
export const APP_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
/** A marca da origem no link de pagamento (a página do Molde põe, como no quiz): o UaiFlow troca pelo código do post. */
export const APP_ORIGEM_MARCA = "MOAPPORIGEM";

export type AppIdioma = "pt-BR" | "en-US";
export type AppDia = { n: number; titulo: string; fazer: string; audio: string; minutos: number };
export type AppAudio = { id: string; titulo: string; minutos: number };
export type AppPacote = {
  titulo: string;
  nomeCurto: string;
  promessa: string;
  idioma: AppIdioma;
  marca: Marca;
  dias: AppDia[];
  audios: AppAudio[];
  preco: { valor: number; moeda: "BRL" | "USD"; porque: string };
  checkout: string | null;
  convite: string;
  lembrete: { assunto: string; texto: string; hora: number };
  aviso: string;
};
export type AudioPedido = { id: string; contentType: string; size: number };

function txt(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";
}
function audioId(value: unknown) {
  const t = txt(value, 24).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,23}$/.test(t) ? t : "";
}

/**
 * A trava do servidor (a página do Molde já passou tudo pelo revisor de promessa, trava131Checar): nada de cura, tratamento,
 * remédio ou resultado garantido de saúde nos textos que a pessoa lê e ouve. Português e inglês, sem acento e em minúsculas.
 */
export const PROMESSA_PROIBIDA: Array<{ re: RegExp; porque: string }> = [
  { re: /\b(?:cura|curar|curou|cure[sd]?|curing|heal(?:s|ed|ing)?)\b/, porque: "promete cura" },
  { re: /(?<!\bse )\b(?:trata|tratar|tratamento|tratamentos|treats|treatment|treating)\b(?!-se)/, porque: "fala em tratamento" },
  { re: /\b(?:substitui|substituir|dispensa|pare de tomar|replaces?|stop taking)\b[^.!?\n]{0,30}\b(?:remedios?|medicamentos?|medicac|meds|medications?|pills)\b/, porque: "manda trocar remédio" },
  { re: /\b(?:garantid[oa]s?|guaranteed)\b[^.!?\n]{0,40}\b(?:sono|dormir|resultado|sleep|results?)\b|\b(?:sono|dormir|sleep)\b[^.!?\n]{0,25}\b(?:garantid[oa]|guaranteed)\b/, porque: "garante resultado" },
  { re: /\b(?:insonia cronica|disturbio do sono|chronic insomnia|sleep disorder|apneia|apnea)\b/, porque: "fala de doença do sono" },
];
function semAcento(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
/** Os trechos proibidos de um texto: [{trecho, porque}] (vazio = passa). */
export function promessaProibida(texto: string) {
  const n = semAcento(texto);
  const achados: Array<{ trecho: string; porque: string }> = [];
  for (const r of PROMESSA_PROIBIDA) {
    const m = n.match(r.re);
    if (m && m.index !== undefined) achados.push({ trecho: texto.slice(m.index, m.index + m[0].length), porque: r.porque });
  }
  return achados;
}

export type AppLido = { ok: true; app: AppPacote; slug: string; audios: AudioPedido[]; produtoRefs: string[] | null; carenciaDias: number | null; avisos: string[] } | { ok: false; erro: string };

/** Lê e confere o pacote do Molde. `body.app` = o pacote; `body.audios` = os arquivos a mandar (pode vir vazio numa atualização). */
export function lerApp(body: Record<string, unknown>): AppLido {
  const a = body.app && typeof body.app === "object" && !Array.isArray(body.app) ? (body.app as Record<string, unknown>) : {};
  const titulo = txt(a.titulo, 80);
  if (!titulo) return { ok: false, erro: "Falta o nome do app." };
  const idioma: AppIdioma = a.idioma === "en-US" ? "en-US" : "pt-BR";
  const avisos: string[] = [];

  const audios: AppAudio[] = [];
  for (const x of Array.isArray(a.audios) ? a.audios : []) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const id = audioId(o.id);
    if (!id || audios.some((y) => y.id === id)) return { ok: false, erro: "Cada áudio precisa de um código diferente (letras, números e hífen)." };
    const t = txt(o.titulo, 80);
    if (!t) return { ok: false, erro: `O áudio ${id} está sem nome.` };
    audios.push({ id, titulo: t, minutos: Math.max(1, Math.min(60, Math.round(Number(o.minutos) || 10))) });
  }
  if (audios.length < APP_AUDIOS[0] || audios.length > APP_AUDIOS[1]) return { ok: false, erro: `O app precisa de ${APP_AUDIOS[0]} a ${APP_AUDIOS[1]} áudios.` };

  const diasIn = Array.isArray(a.dias) ? a.dias : [];
  if (diasIn.length !== APP_DIAS) return { ok: false, erro: `A rotina precisa de ${APP_DIAS} dias (veio com ${diasIn.length}).` };
  const dias: AppDia[] = [];
  for (let i = 0; i < diasIn.length; i += 1) {
    const o = diasIn[i] && typeof diasIn[i] === "object" ? (diasIn[i] as Record<string, unknown>) : {};
    const audio = audioId(o.audio);
    const d = { n: i + 1, titulo: txt(o.titulo, 80), fazer: txt(o.fazer, 280), audio, minutos: Math.max(1, Math.min(60, Math.round(Number(o.minutos) || 0) || (audios.find((y) => y.id === audio)?.minutos ?? 10))) };
    if (!d.titulo || !d.fazer) return { ok: false, erro: `O dia ${i + 1} está sem o título ou sem o que fazer.` };
    if (!audios.some((y) => y.id === audio)) return { ok: false, erro: `O dia ${i + 1} aponta para um áudio que não existe.` };
    dias.push(d);
  }
  const semUso = audios.filter((y) => !dias.some((d) => d.audio === y.id));
  if (semUso.length) avisos.push(`Nenhum dia toca ${semUso.map((y) => `«${y.titulo}»`).join(", ")}.`);

  const p = a.preco && typeof a.preco === "object" ? (a.preco as Record<string, unknown>) : {};
  const moeda = p.moeda === "USD" || p.moeda === "US$" ? "USD" : "BRL";
  const valor = Math.round((typeof p.valor === "string" ? Number(p.valor.replace(",", ".")) : Number(p.valor)) * 100) / 100;
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, erro: "Falta o preço por mês." };
  if (valor > APP_TETO[moeda]) return { ok: false, erro: `O preço de entrada do app fica abaixo de ${moeda === "USD" ? "US$ 27" : "R$ 47"} por mês.` };
  const porque = txt(p.porque, 200);
  if (!porque) avisos.push("O preço veio sem o porquê.");

  const checkoutTxt = txt(a.checkout, 2000);
  if (checkoutTxt && !/^https:\/\/[^\s]+$/i.test(checkoutTxt)) return { ok: false, erro: "O link de pagamento da assinatura precisa começar com https://" };
  const l = a.lembrete && typeof a.lembrete === "object" ? (a.lembrete as Record<string, unknown>) : {};
  const lembrete = { assunto: txt(l.assunto, 90), texto: txt(l.texto, 400), hora: Math.max(0, Math.min(23, Math.round(Number(l.hora ?? 21)) || 0)) };
  if (!lembrete.texto) return { ok: false, erro: "Falta o texto do lembrete." };
  if (!lembrete.assunto) lembrete.assunto = idioma === "pt-BR" ? "Sua noite de hoje está pronta" : "Tonight's session is ready";

  const app: AppPacote = {
    titulo,
    nomeCurto: txt(a.nomeCurto, 12) || titulo.slice(0, 12).trim(),
    promessa: txt(a.promessa, 200),
    idioma,
    marca: lerMarca(a.marca),
    dias,
    audios,
    preco: { valor, moeda, porque },
    checkout: checkoutTxt || null,
    convite: txt(a.convite, 400),
    lembrete,
    aviso: txt(a.aviso, 200),
  };
  // a trava do servidor: o que a pessoa lê e o que o lembrete diz
  const textos = [app.titulo, app.promessa, app.convite, app.lembrete.assunto, app.lembrete.texto, ...app.audios.map((y) => y.titulo), ...app.dias.flatMap((d) => [d.titulo, d.fazer])];
  for (const t of textos) {
    const achado = promessaProibida(t)[0];
    if (achado) return { ok: false, erro: `Promessa que não pode (${achado.porque}): «${achado.trecho}». Ajuste na página do Molde e mande de novo.` };
  }

  const pedidos: AudioPedido[] = [];
  for (const x of Array.isArray(body.audios) ? body.audios : []) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const id = audioId(o.id);
    if (!audios.some((y) => y.id === id)) return { ok: false, erro: "Um arquivo de áudio não é de nenhum áudio do app." };
    if (pedidos.some((y) => y.id === id)) return { ok: false, erro: "Mande um arquivo por áudio." };
    const contentType = txt(o.contentType, 40).toLowerCase();
    if (!(contentType in APP_AUDIO_TIPOS)) return { ok: false, erro: "O áudio precisa ser mp3, m4a, aac, wav ou ogg." };
    const size = Number(o.size);
    if (!Number.isSafeInteger(size) || size <= 0) return { ok: false, erro: "Falta o tamanho do áudio." };
    if (size > APP_AUDIO_MAX_BYTES) return { ok: false, erro: `O áudio «${audios.find((y) => y.id === id)?.titulo}» passa de 25 MB.` };
    pedidos.push({ id, contentType, size });
  }

  const refsIn = body.produtoRefs ?? a.produtoRefs;
  const produtoRefs = Array.isArray(refsIn) ? Array.from(new Set(refsIn.map((r) => txt(r, 120)).filter((r) => /^[A-Za-z0-9_.:-]{2,120}$/.test(r)))).slice(0, 10) : null;
  const car = body.carenciaDias ?? a.carenciaDias;
  const carenciaDias = car === undefined || car === null || car === "" ? null : Math.max(0, Math.min(15, Math.round(Number(car)) || 0));
  return { ok: true, app, slug: slugDe(body.slug) || slugDe(titulo), audios: pedidos, produtoRefs, carenciaDias, avisos };
}

/** O link de pagamento com o código do post no lugar da marca (ou no src/utm_content, se a página não pôs a marca). */
export function checkoutComOrigem(checkout: string | null, origem: string | null) {
  if (!checkout) return null;
  try {
    const comCodigo = checkout.includes(APP_ORIGEM_MARCA) ? checkout.split(APP_ORIGEM_MARCA).join(origem ?? "") : checkout;
    const url = new URL(comCodigo);
    if (!checkout.includes(APP_ORIGEM_MARCA) && origem && !url.searchParams.has("src")) url.searchParams.set("src", origem);
    // a marca sem código vira parâmetro vazio: tira
    for (const [k, v] of Array.from(url.searchParams.entries())) if (!v) url.searchParams.delete(k);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A extensão do áudio pelo tipo. */
export function extensaoAudio(contentType: string) {
  return APP_AUDIO_TIPOS[contentType] ?? "bin";
}
