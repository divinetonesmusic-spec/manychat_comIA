/**
 * A marca do avatar nas páginas públicas do funil (/q/ e /e/): as cores e as letras que a página do Molde manda (do DESIGN.md
 * e da marca do projeto). Toda cor é conferida (só #rrggbb) e o contraste é garantido aqui: se a cor do texto não tiver
 * contraste AA (4,5:1) com o fundo, entra a mais legível (quase preto ou quase branco). Sem nada do Node: roda em qualquer lugar.
 */
export type Marca = {
  nome: string;
  fundo: string;
  superficie: string;
  texto: string;
  suave: string;
  primaria: string;
  textoPrimaria: string;
  fonteTitulo: string;
  fonteCorpo: string;
  foto: string | null;
};

export const MARCA_PADRAO: Marca = {
  nome: "",
  fundo: "#FBF8F3",
  superficie: "#FFFFFF",
  texto: "#1F1A17",
  suave: "#5E5650",
  primaria: "#7A4E2D",
  textoPrimaria: "#FFFFFF",
  fonteTitulo: "",
  fonteCorpo: "",
  foto: null,
};

const HEX = /^#[0-9a-f]{6}$/i;
function hex(value: unknown) {
  if (typeof value !== "string") return null;
  let t = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(t)) t = `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  return HEX.test(t) ? t.toUpperCase() : null;
}

function canal(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminancia(cor: string) {
  const n = parseInt(cor.slice(1), 16);
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}
export function contraste(a: string, b: string) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** A cor de texto mais legível sobre o fundo (quase preto ou quase branco). */
export function textoSobre(fundo: string) {
  return contraste("#14110F", fundo) >= contraste("#FFFFFF", fundo) ? "#14110F" : "#FFFFFF";
}
function legivel(cor: string | null, fundo: string, minimo = 4.5) {
  return cor && contraste(cor, fundo) >= minimo ? cor : textoSobre(fundo);
}

/** Nome de fonte do Google Fonts (só letras, números e espaço); "" quando não é. */
export function fonteValida(value: unknown) {
  const t = typeof value === "string" ? value.replace(/["']/g, "").split(",")[0].trim() : "";
  return /^[A-Za-z][A-Za-z0-9 ]{1,39}$/.test(t) ? t : "";
}

export function lerMarca(value: unknown): Marca {
  const m = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const cores = m.cores && typeof m.cores === "object" ? (m.cores as Record<string, unknown>) : m;
  const fontes = m.fontes && typeof m.fontes === "object" ? (m.fontes as Record<string, unknown>) : m;
  const fundo = hex(cores.fundo) ?? MARCA_PADRAO.fundo;
  const superficie = hex(cores.superficie) ?? (luminancia(fundo) > 0.5 ? "#FFFFFF" : mistura(fundo, "#FFFFFF", 0.06));
  const texto = legivel(hex(cores.texto), superficie);
  const suave = legivel(hex(cores.suave), superficie);
  // a cor do botão: tem que aparecer no fundo (3:1, componente de interface) e ter texto legível em cima
  let primaria = hex(cores.primaria) ?? MARCA_PADRAO.primaria;
  if (contraste(primaria, fundo) < 3) primaria = texto;
  const foto = typeof m.foto === "string" && /^https:\/\/[^\s"'()<>]+$/i.test(m.foto.trim()) ? m.foto.trim() : null;
  return {
    nome: typeof m.nome === "string" ? m.nome.trim().slice(0, 60) : "",
    fundo,
    superficie,
    texto,
    suave,
    primaria,
    textoPrimaria: legivel(hex(cores.textoPrimaria), primaria),
    fonteTitulo: fonteValida(fontes.titulo ?? m.fonteTitulo),
    fonteCorpo: fonteValida(fontes.corpo ?? m.fonteCorpo),
    foto,
  };
}

function mistura(a: string, b: string, t: number) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const c = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${[16, 8, 0].map((s) => c(s).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** As variáveis de CSS da página (style do <main>). */
export function varsDaMarca(m: Marca): Record<string, string> {
  const pilha = (f: string, reserva: string) => (f ? `"${f}", ${reserva}` : reserva);
  return {
    "--f-fundo": m.fundo,
    "--f-sup": m.superficie,
    "--f-texto": m.texto,
    "--f-suave": m.suave,
    "--f-prim": m.primaria,
    "--f-prim-texto": m.textoPrimaria,
    "--f-linha": mistura(m.superficie, m.texto, 0.18),
    "--f-fonte-titulo": pilha(m.fonteTitulo || m.fonteCorpo, "Georgia, 'Times New Roman', serif"),
    "--f-fonte-corpo": pilha(m.fonteCorpo, "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"),
  };
}

/** O endereço do Google Fonts para as letras da marca (ou null). */
export function googleFontsUrl(m: Marca) {
  const fs = Array.from(new Set([m.fonteTitulo, m.fonteCorpo].filter(Boolean)));
  if (!fs.length) return null;
  return `https://fonts.googleapis.com/css2?${fs.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700`).join("&")}&display=swap`;
}
