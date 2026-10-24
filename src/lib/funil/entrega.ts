/**
 * A página de entrega do material grátis (0013): o pacote que a página do Molde manda (POST /api/molde/entregas), conferido,
 * e os tipos de arquivo aceitos. Os arquivos ficam PRIVADOS no R2 (uaiflow/entregas/<id>/…): a pessoa baixa por link
 * assinado, com prazo, só depois de deixar o e-mail.
 */
import { lerMarca, type Marca } from "@/lib/funil/marca";
import { slugDe } from "@/lib/funil/quiz";

export const ENTREGA_TIPOS = {
  pdf: { "application/pdf": "pdf" },
  html: { "text/html": "html" },
  capa: { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" },
} as const;
export type EntregaArquivoTipo = keyof typeof ENTREGA_TIPOS;
export const ENTREGA_MAX_BYTES = { pdf: 60 * 1024 * 1024, html: 25 * 1024 * 1024, capa: 8 * 1024 * 1024 } as const;

export type EntregaProximo = { titulo: string; texto: string; link: string | null; rotulo: string };
export type EntregaPacote = {
  titulo: string;
  subtitulo: string;
  idioma: "pt-BR" | "en-US" | "es";
  itens: string[];
  marca: Marca;
  proximo: EntregaProximo | null;
  aviso: string;
};
export type ArquivoPedido = { tipo: EntregaArquivoTipo; nome: string; contentType: string; size: number };

function txt(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";
}

export type EntregaLida = { ok: true; entrega: EntregaPacote; slug: string; arquivos: ArquivoPedido[] } | { ok: false; erro: string };

export function lerEntrega(body: Record<string, unknown>): EntregaLida {
  const e = body.entrega && typeof body.entrega === "object" ? (body.entrega as Record<string, unknown>) : {};
  const titulo = txt(e.titulo, 120);
  if (!titulo) return { ok: false, erro: "Falta o título do material." };
  const p = e.proximo && typeof e.proximo === "object" ? (e.proximo as Record<string, unknown>) : null;
  const link = p ? txt(p.link, 2000) : "";
  if (link && !/^https:\/\/[^\s]+$/i.test(link)) return { ok: false, erro: "O link do próximo passo precisa começar com https://" };
  const proximo = p && txt(p.titulo, 120) ? { titulo: txt(p.titulo, 120), texto: txt(p.texto, 400), link: link || null, rotulo: txt(p.rotulo, 40) } : null;
  const arquivos: ArquivoPedido[] = [];
  for (const x of Array.isArray(body.arquivos) ? body.arquivos : []) {
    const a = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const tipo = a.tipo as EntregaArquivoTipo;
    if (!(tipo in ENTREGA_TIPOS)) return { ok: false, erro: "Arquivo de tipo desconhecido (use pdf, html ou capa)." };
    const contentType = txt(a.contentType, 60).toLowerCase();
    if (!(contentType in ENTREGA_TIPOS[tipo])) {
      return { ok: false, erro: tipo === "pdf" ? "O PDF precisa ser um arquivo .pdf." : tipo === "html" ? "A versão interativa precisa ser um arquivo .html." : "A capa precisa ser PNG, JPG ou WEBP." };
    }
    const size = Number(a.size);
    if (!Number.isSafeInteger(size) || size <= 0) return { ok: false, erro: "Falta o tamanho do arquivo." };
    if (size > ENTREGA_MAX_BYTES[tipo]) return { ok: false, erro: `O arquivo (${tipo}) passa de ${Math.round(ENTREGA_MAX_BYTES[tipo] / 1048576)} MB.` };
    if (arquivos.some((y) => y.tipo === tipo)) return { ok: false, erro: "Mande um arquivo de cada tipo." };
    arquivos.push({ tipo, nome: txt(a.nome, 120) || `material.${Object.values(ENTREGA_TIPOS[tipo])[0]}`, contentType, size });
  }
  const idioma = e.idioma === "en-US" || e.idioma === "es" ? e.idioma : "pt-BR";
  return {
    ok: true,
    slug: slugDe(body.slug) || slugDe(titulo),
    arquivos,
    entrega: {
      titulo,
      subtitulo: txt(e.subtitulo, 240),
      idioma,
      itens: (Array.isArray(e.itens) ? e.itens : []).map((x) => txt(x, 140)).filter(Boolean).slice(0, 6),
      marca: lerMarca(e.marca),
      proximo,
      aviso: txt(e.aviso, 200),
    },
  };
}

/** A extensão do arquivo pelo tipo e o content-type (já conferidos). */
export function extensao(a: Pick<ArquivoPedido, "tipo" | "contentType">) {
  return (ENTREGA_TIPOS[a.tipo] as Record<string, string>)[a.contentType] ?? "bin";
}

/** O nome do PDF para baixar (só letras, números, ponto e hífen). */
export function nomeDeArquivo(nome: string, ext: string) {
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "material";
  return `${base}.${ext}`;
}
