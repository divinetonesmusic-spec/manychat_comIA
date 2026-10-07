import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * U-UX-03: o aviso que aparece depois da volta do login do Instagram (função pura) e os botões que
 * não faziam nada (busca e sino do topo, "Criar conta" no login). O menu agrupado também é conferido aqui.
 */
const { mensagemRetornoInstagram, INVALID_STATE_MESSAGE, PARAMETROS_RETORNO_INSTAGRAM } = await import("@/lib/instagram-retorno");

const params = (texto: string) => new URLSearchParams(texto);

describe("mensagemRetornoInstagram", () => {
  test("sem parâmetros do Instagram: nenhum aviso (outros parâmetros, como accountId, são ignorados)", () => {
    assert.equal(mensagemRetornoInstagram(params("")), null);
    assert.equal(mensagemRetornoInstagram(params("accountId=abc")), null);
    assert.equal(mensagemRetornoInstagram(params("instagram_error=")), null);
    assert.equal(mensagemRetornoInstagram(params("instagram_connected=0")), null);
  });

  test("conectado: verde", () => {
    assert.deepEqual(mensagemRetornoInstagram(params("instagram_connected=1")), { tom: "sucesso", texto: "Pronto! O Instagram foi conectado." });
  });

  test("a pessoa não autorizou (access_denied, user_denied, 'denied' no texto)", () => {
    const esperado = { tom: "erro", texto: "Você não autorizou o Instagram. Nada mudou; tente de novo quando quiser." };
    assert.deepEqual(mensagemRetornoInstagram(params("instagram_error=access_denied")), esperado);
    assert.deepEqual(mensagemRetornoInstagram(params("instagram_error=user_denied")), esperado);
    assert.deepEqual(mensagemRetornoInstagram(params("instagram_error=" + encodeURIComponent("The user denied your request."))), esperado);
    assert.deepEqual(mensagemRetornoInstagram(params("instagram_error=ACCESS_DENIED")), esperado);
  });

  test("missing_code", () => {
    assert.deepEqual(mensagemRetornoInstagram(params("instagram_error=missing_code")), { tom: "erro", texto: "O Instagram não devolveu a autorização. Tente conectar de novo." });
  });

  test("link vencido: mostra a própria mensagem (já em português)", () => {
    assert.deepEqual(mensagemRetornoInstagram(params("instagram_error=" + encodeURIComponent(INVALID_STATE_MESSAGE))), { tom: "erro", texto: INVALID_STATE_MESSAGE });
    assert.match(INVALID_STATE_MESSAGE, /venceu/);
  });

  test("outro motivo: mensagem simples e o motivo (até 200 caracteres) numa linha menor", () => {
    assert.deepEqual(mensagemRetornoInstagram(params("instagram_error=" + encodeURIComponent("Invalid OAuth redirect uri"))), {
      tom: "erro",
      texto: "Não consegui conectar o Instagram.",
      detalhe: "Invalid OAuth redirect uri",
    });
    const longo = "x".repeat(500);
    const resultado = mensagemRetornoInstagram(params(`instagram_error=${longo}`));
    assert.equal(resultado?.detalhe?.length, 200);
  });

  test("funciona também com um objeto que tem get() (ReadonlyURLSearchParams)", () => {
    const objeto = { get: (nome: string) => (nome === "instagram_connected" ? "1" : null) };
    assert.equal(mensagemRetornoInstagram(objeto)?.tom, "sucesso");
    assert.equal(mensagemRetornoInstagram(null), null);
  });

  test("os nomes dos parâmetros que o 'Fechar' tira", () => {
    assert.deepEqual([...PARAMETROS_RETORNO_INSTAGRAM].sort(), ["instagram_connected", "instagram_error"]);
  });

  test("a rota de volta usa a mesma mensagem de link vencido", () => {
    const rota = readFileSync("src/app/api/oauth/callback/route.ts", "utf8");
    assert.ok(rota.includes("INVALID_STATE_MESSAGE"));
    assert.ok(!rota.includes("const INVALID_STATE_MESSAGE"), "a constante deve vir de @/lib/instagram-retorno");
  });
});

describe("botões que não faziam nada saíram; menu agrupado", () => {
  const shell = readFileSync("src/app/app-shell.tsx", "utf8");

  test("app-shell.tsx: sem busca e sem sino", () => {
    assert.ok(!shell.includes("search-input"));
    assert.ok(!/\bBell\b/.test(shell));
    assert.ok(!shell.includes("Notificacoes"));
    assert.ok(!/\bSearch\b/.test(shell));
  });

  test("auth-form.tsx: sem 'Criar conta' (a rota /cadastro continua existindo)", () => {
    const form = readFileSync("src/app/auth-form.tsx", "utf8");
    assert.ok(!form.includes("Criar conta"));
    assert.ok(!form.includes("Nao tem uma conta"));
    assert.ok(readFileSync("src/app/cadastro/page.tsx", "utf8").length > 0);
  });

  test("menu: grupo principal e grupo 'Avançado', com acentos, na ordem pedida", () => {
    const rotulos = (trecho: string) => [...trecho.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    const principal = shell.match(/const navigation = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
    const avancado = shell.match(/const advancedNavigation = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
    assert.deepEqual(rotulos(principal), ["Início", "Caixa de entrada", "Conteúdo", "Contatos", "Automações", "Perfis"]);
    assert.deepEqual(rotulos(avancado), ["Fluxos", "Assistente UaiFlow", "Configurações"]);
    assert.ok(/<SidebarGroupLabel>Avançado<\/SidebarGroupLabel>/.test(shell));
  });

  test("Perfis: passo a passo da Meta recolhido e barra de salvar fixa só no computador", () => {
    const perfis = readFileSync("src/app/perfis/perfis-client.tsx", "utf8");
    assert.ok(/<details(?![^>]*\bopen\b)[^>]*>/.test(perfis));
    assert.ok(perfis.includes("Avançado: configuração na Meta"));
    assert.ok(/className="md:sticky md:bottom-4 /.test(perfis));
    assert.ok(!/className="sticky bottom-4 /.test(perfis));
  });
});
