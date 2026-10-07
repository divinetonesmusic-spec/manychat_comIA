import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { excecoesTextosTela } from "./helpers/textos-tela-excecoes.mjs";

/**
 * U-UX-01: o texto que aparece na tela (e as mensagens do servidor que as telas mostram) precisa ter acento.
 * O teste lê os arquivos, acha cada texto de JSX e cada string e falha se sobrar uma palavra da lista abaixo sem
 * acento ("nao", "voce", "automacao"...). Caminhos ("/..."), className/href/id e nomes (identificadores) não contam.
 */
const SEM_ACENTO =
  /\b(nao|Nao|voce|Voce|automacao|Automacao|automacoes|Automacoes|configuracoes|Configuracoes|conteudo|Conteudo|conexao|botao|botoes|midia|informacoes|publicacao|comentario|comentarios|ultimas?|ultimos?|pagina|disponivel|tambem|Visao|magico|Notificacoes|reacao|acao|condicao|inscricao|instrucoes|historico|codigo)\b/;

/** Atributos JSX cujo valor é código ou endereço, nunca texto para a pessoa. */
const ATRIBUTOS_DE_CODIGO = new Set([
  "className", "href", "src", "id", "htmlFor", "key", "type", "name", "d", "viewBox", "fill", "stroke", "style",
  "role", "autoComplete", "inputMode", "method", "action", "target", "rel", "variant", "size", "side", "align",
  "accept", "render", "defaultValue",
]);

const RAIZES = ["src/app", "src/components"];
const RAIZES_SERVIDOR = ["src/app/api", "src/lib"];
const IGNORADOS = ["src/app/api/molde", "src/lib/content/molde-"];

function arquivos(dir: string, extensoes: string[]): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = path.posix.join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho, extensoes));
    else if (extensoes.some((ext) => nome.endsWith(ext)) && !nome.endsWith(".d.ts")) saida.push(caminho);
  }
  return saida;
}

type Achado = { arquivo: string; linha: number; trecho: string; palavra: string };

function achados(arquivo: string): Achado[] {
  const codigo = readFileSync(arquivo, "utf8");
  const fonte = ts.createSourceFile(arquivo, codigo, ts.ScriptTarget.Latest, true, arquivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lista: Achado[] = [];

  const olhar = (no: ts.Node, texto: string) => {
    const limpo = texto.replace(/\s+/g, " ").trim();
    if (!limpo || limpo.startsWith("/")) return; // caminho de rota ou de arquivo
    if (/^[a-z0-9_.:/#?&=-]+$/.test(limpo)) return; // valor de código em minúsculas (chave, id, tipo): "conteudo", "automacoes"
    const achou = SEM_ACENTO.exec(limpo);
    if (!achou) return;
    const excecao = excecoesTextosTela.some((item) => item.arquivo === arquivo && item.trecho === limpo);
    if (excecao) return;
    lista.push({ arquivo, linha: fonte.getLineAndCharacterOfPosition(no.getStart()).line + 1, trecho: limpo.slice(0, 120), palavra: achou[1] });
  };

  const emAtributoDeCodigo = (no: ts.Node) => {
    for (let pai = no.parent; pai; pai = pai.parent) {
      if (ts.isJsxAttribute(pai)) return ATRIBUTOS_DE_CODIGO.has(pai.name.getText());
      if (ts.isImportDeclaration(pai) || ts.isExportDeclaration(pai)) return true;
    }
    return false;
  };

  const visitar = (no: ts.Node) => {
    if (ts.isJsxText(no)) olhar(no, no.text);
    else if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) {
      if (!emAtributoDeCodigo(no)) olhar(no, no.text);
    } else if (ts.isTemplateHead(no) || ts.isTemplateMiddle(no) || ts.isTemplateTail(no)) {
      if (!emAtributoDeCodigo(no)) olhar(no, no.text);
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return lista;
}

function relatorio(lista: Achado[]) {
  return lista.map((item) => `${item.arquivo}:${item.linha}  "${item.palavra}"  →  ${item.trecho}`).join("\n");
}

describe("textos das telas e do servidor com acento", () => {
  test("telas (src/app e src/components, .tsx): nenhuma palavra da lista sem acento", () => {
    const tsx = RAIZES.flatMap((raiz) => arquivos(raiz, [".tsx"])).filter((arquivo) => !IGNORADOS.some((ignorado) => arquivo.startsWith(ignorado)));
    assert.ok(tsx.length > 30, "o teste precisa achar as telas");
    const problemas = tsx.flatMap(achados);
    assert.equal(problemas.length, 0, `texto sem acento nas telas:\n${relatorio(problemas)}`);
  });

  test("servidor (rotas e src/lib, .ts): mensagens que as telas mostram também têm acento", () => {
    const ts_ = RAIZES_SERVIDOR.flatMap((raiz) => arquivos(raiz, [".ts"])).filter((arquivo) => !IGNORADOS.some((ignorado) => arquivo.startsWith(ignorado)));
    assert.ok(ts_.length > 30, "o teste precisa achar os arquivos do servidor");
    const problemas = ts_.flatMap(achados);
    assert.equal(problemas.length, 0, `texto sem acento no servidor:\n${relatorio(problemas)}`);
  });

  test("a lista de exceções tem motivo e cada exceção ainda existe no arquivo", () => {
    for (const excecao of excecoesTextosTela) {
      assert.ok(excecao.motivo.length > 20, `exceção sem motivo: ${excecao.arquivo} / ${excecao.trecho}`);
      assert.ok(readFileSync(excecao.arquivo, "utf8").includes(excecao.trecho), `exceção que não existe mais (apague-a): ${excecao.arquivo} / ${excecao.trecho}`);
    }
  });

  test("o teste enxerga os erros de verdade (texto de exemplo sem acento é pego)", () => {
    const amostra = "const a = <p>Você não pode</p>; const b = <p>Voce nao pode</p>;";
    const fonte = ts.createSourceFile("amostra.tsx", amostra, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const textos: string[] = [];
    const visitar = (no: ts.Node) => { if (ts.isJsxText(no)) textos.push(no.text); ts.forEachChild(no, visitar); };
    visitar(fonte);
    assert.deepEqual(textos.map((texto) => SEM_ACENTO.test(texto)), [false, true]);
  });
});
