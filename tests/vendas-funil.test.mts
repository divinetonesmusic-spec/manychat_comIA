import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";
import { insertPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Escada de vendas (0011): prazo REAL do desconto (gravado uma vez, nunca reinicia), sequência upsell → downsell →
 * recorrência → obrigado, recorrência só com «concordo» e link de cancelamento, lista própria de e-mails, pedido de
 * depoimento N dias depois pelo relógio, formulário com a permissão explícita, pré-venda, destino do post e foto do
 * feed na Página do Facebook.
 */
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase();
const escada = await import("@/lib/vendas/escada");
const produtoLib = await import("@/lib/vendas/produto");
const exportar = await import("@/lib/vendas/exportar");
const destinoLib = await import("@/lib/content/destino");
const redesLib = await import("@/lib/redes/redes");
const pkg = await import("@/lib/content/package");
const emailLib = await import("@/lib/vendas/email");
const produtosRoute = await import("@/app/api/vendas/produtos/route");
const produtoRoute = await import("@/app/api/vendas/produtos/[id]/route");
const ofertaRoute = await import("@/app/p/[slug]/oferta/route");
const acaoRoute = await import("@/app/p/[slug]/oferta/[sessao]/acao/route");
const comprarRoute = await import("@/app/p/[slug]/comprar/route");
const emailRoute = await import("@/app/p/[slug]/obrigado/email/route");
const enviarRoute = await import("@/app/depoimento/[token]/enviar/route");
const sairRoute = await import("@/app/depoimento/[token]/sair/route");
const depoimentosRoute = await import("@/app/api/vendas/depoimentos/route");
const compradoresRoute = await import("@/app/api/vendas/compradores/route");
const molde = await import("@/app/api/vendas/escada-molde/route");
const funil = await import("@/lib/db/funil");
const relogio = await import("@/lib/vendas/relogio");
const { cookieSessao } = await import("@/lib/vendas/funil-web");
const planner = await import("@/lib/db/content-planner");
const publisher = await import("@/lib/redes/publisher");
const redesDb = await import("@/lib/db/redes");

after(async () => {
  meta.restore();
  await db?.close();
});

const CHECKOUT = "https://buy.stripe.com/entrada";
const UPSELL = "https://buy.stripe.com/upsell-desconto";
const UPSELL_CHEIO = "https://buy.stripe.com/upsell-cheio";
const DOWNSELL = "https://buy.stripe.com/downsell";
const ASSINATURA = "https://buy.stripe.com/assinatura";
const CANCELAR = "https://billing.stripe.com/p/login/portal";

function escadaCompleta(extra: Record<string, unknown> = {}) {
  return {
    bump: { nome: "Checklist", preco: 12, texto: "Lista pronta", checkoutUrl: "https://buy.stripe.com/entrada-bump", produtoRef: "bump-ref" },
    upsell: { nome: "Curso", preco: 67, texto: "Aula a aula", checkoutUrl: UPSELL, produtoRef: "upsell-ref", prazoMinutos: 15, precoCheio: 97, checkoutUrlCheio: UPSELL_CHEIO },
    downsell: { nome: "Mini curso", preco: 27, texto: "Só o essencial", checkoutUrl: DOWNSELL, produtoRef: "down-ref", parcelas: 3 },
    recorrencia: { nome: "Clube", preco: 12, texto: "Novo material todo mês", checkoutUrl: ASSINATURA, produtoRef: "clube-ref", cancelarUrl: CANCELAR },
    ...extra,
  };
}

describe("escada (sem banco): prazo real, sequência e conferência", () => {
  test("o prazo é calculado a partir da criação da sessão e vence de verdade", () => {
    const criado = new Date("2026-10-20T12:00:00Z");
    const expira = escada.calcularExpiracao(criado, 15)!;
    assert.equal(expira.toISOString(), "2026-10-20T12:15:00.000Z");
    assert.equal(escada.calcularExpiracao(criado, 0), null, "0 = sem prazo");
    assert.equal(escada.calcularExpiracao(criado, null), null);
    assert.equal(escada.segundosRestantes(expira, new Date("2026-10-20T12:10:00Z")), 300);
    assert.equal(escada.segundosRestantes(expira, new Date("2026-10-20T12:30:00Z")), 0, "depois do prazo: zero, nunca volta");
    assert.equal(escada.calcularExpiracao(criado, 999_999)!.getTime() - criado.getTime(), escada.MAX_PRAZO_MINUTOS * 60_000, "teto de 7 dias");
  });

  test("preço atual: desconto até o prazo; depois preço cheio (se houver) ou oferta encerrada", () => {
    const { escada: config } = escada.parseEscada(escadaCompleta());
    const expira = "2026-10-20T12:15:00.000Z";
    const antes = escada.precoAtual(config, "upsell", expira, new Date("2026-10-20T12:05:00Z"));
    assert.deepEqual(antes, { situacao: "desconto", preco: 67, checkoutUrl: UPSELL, segundos: 600 });
    const depois = escada.precoAtual(config, "upsell", expira, new Date("2026-10-20T12:20:00Z"));
    assert.deepEqual(depois, { situacao: "cheio", preco: 97, checkoutUrl: UPSELL_CHEIO, segundos: 0 });
    const semCheio = escada.parseEscada(escadaCompleta({ upsell: { nome: "Curso", preco: 67, checkoutUrl: UPSELL, prazoMinutos: 15 } })).escada;
    assert.deepEqual(escada.precoAtual(semCheio, "upsell", expira, new Date("2026-10-20T12:20:00Z")), { situacao: "encerrada" });
    assert.equal(escada.precoAtual(config, "downsell", null).situacao, "sem_prazo", "o downsell não tem prazo");
  });

  test("sequência: upsell → (recusou) downsell → recorrência → obrigado; aceitar o upsell pula o downsell", () => {
    const { escada: tudo } = escada.parseEscada(escadaCompleta());
    assert.equal(escada.primeiraEtapa(tudo), "upsell");
    assert.equal(escada.proximaEtapa(tudo, "upsell", "aceitar"), "recorrencia");
    assert.equal(escada.proximaEtapa(tudo, "upsell", "recusar"), "downsell");
    assert.equal(escada.proximaEtapa(tudo, "downsell", "aceitar"), "recorrencia");
    assert.equal(escada.proximaEtapa(tudo, "downsell", "recusar"), "recorrencia");
    assert.equal(escada.proximaEtapa(tudo, "recorrencia", "recusar"), "obrigado");
    const semRecorrencia = escada.parseEscada(escadaCompleta({ recorrencia: null })).escada;
    assert.equal(escada.proximaEtapa(semRecorrencia, "upsell", "aceitar"), "obrigado");
    assert.equal(escada.proximaEtapa(semRecorrencia, "downsell", "recusar"), "obrigado");
    const soUpsell = escada.parseEscada({ upsell: escadaCompleta().upsell }).escada;
    assert.equal(escada.proximaEtapa(soUpsell, "upsell", "recusar"), "obrigado", "sem downsell: recusar vai para o obrigado");
    assert.equal(escada.primeiraEtapa({}), "obrigado");
    assert.equal(escada.primeiraEtapa({ recorrencia: tudo.recorrencia }), "recorrencia");
  });

  test("conferência: recorrência sem link de cancelamento, downsell sem upsell e preço cheio sem prazo não passam", () => {
    const semCancelar = escada.parseEscada({ recorrencia: { nome: "Clube", preco: 12, checkoutUrl: ASSINATURA } });
    assert.match(semCancelar.erros.join(" "), /link de cancelamento/);
    assert.match(escada.parseEscada({ downsell: escadaCompleta().downsell }).erros.join(" "), /Configure o upsell antes/);
    assert.match(escada.parseEscada({ upsell: { nome: "C", preco: 67, checkoutUrl: UPSELL, precoCheio: 97, checkoutUrlCheio: UPSELL_CHEIO } }).erros.join(" "), /prazo real/);
    assert.match(escada.parseEscada({ upsell: { nome: "C", preco: 67, checkoutUrl: UPSELL, prazoMinutos: 10, precoCheio: 50, checkoutUrlCheio: UPSELL_CHEIO } }).erros.join(" "), /maior que o preço com desconto/);
    assert.match(escada.parseEscada({ bump: { nome: "X", preco: 10, checkoutUrl: "javascript:alert(1)" } }).erros.join(" "), /link de pagamento/);
    assert.deepEqual(escada.parseEscada({ bump: { nome: "", preco: "", checkoutUrl: "" } }), { escada: {}, erros: [] }, "oferta vazia = desligada");
    assert.deepEqual(escada.parseEscada(escadaCompleta()).erros, []);
  });

  test("avisos de preço fora das faixas sugeridas (não impedem salvar)", () => {
    const { escada: config } = escada.parseEscada(escadaCompleta({ bump: { nome: "B", preco: 30, checkoutUrl: CHECKOUT } }));
    const avisos = escada.avisosEscada(config);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /Order bump: US\$ 30 está fora da faixa sugerida \(US\$ 9–17\)/);
  });

  test("termos da recorrência deixam claro o preço por mês e como cancelar", () => {
    const { escada: config } = escada.parseEscada(escadaCompleta());
    assert.match(escada.termosRecorrencia(config.recorrencia!, "USD"), /\$12\.00 por mês[\s\S]*até cancelar[\s\S]*link de cancelamento/);
  });

  test("valor médio por comprador: real pelas vendas e estimado pelos aceites", () => {
    const m = escada.metricasFunil({
      precoEntrada: 17,
      contagem: { entrada: { quantidade: 10, valor: 170 }, viu_upsell: { quantidade: 10, valor: 670 }, aceitou_upsell: { quantidade: 2, valor: 134 }, recusou_upsell: { quantidade: 8, valor: 0 }, viu_downsell: { quantidade: 8, valor: 216 }, aceitou_downsell: { quantidade: 2, valor: 54 } },
      receitaReal: 400,
      comprasEntrada: 10,
    });
    assert.equal(m.compradores, 10);
    assert.equal(m.upsell.taxa, 20);
    assert.equal(m.downsell.taxa, 25);
    assert.equal(m.valorMedioEstimado, 35.8);
    assert.equal(m.valorMedioReal, 40);
    assert.equal(escada.metricasFunil({ precoEntrada: 17, contagem: {} }).valorMedioReal, null);
  });

  test("pedido de depoimento: 7 dias por padrão, de 1 a 90; erro tenta em 1 h, 6 h e desiste", () => {
    const compra = new Date("2026-10-20T12:00:00Z");
    assert.equal(escada.agendarPedidoDepoimento(compra).toISOString(), "2026-10-27T12:00:00.000Z");
    assert.equal(escada.agendarPedidoDepoimento(compra, 3).toISOString(), "2026-10-23T12:00:00.000Z");
    assert.equal(escada.agendarPedidoDepoimento(compra, 500).toISOString(), new Date(compra.getTime() + 90 * 86_400_000).toISOString());
    assert.equal(escada.agendarPedidoDepoimento(compra, 0).toISOString(), "2026-10-27T12:00:00.000Z");
    assert.equal(escada.proximaTentativaDepoimento(1, compra)!.toISOString(), "2026-10-20T13:00:00.000Z");
    assert.equal(escada.proximaTentativaDepoimento(2, compra)!.toISOString(), "2026-10-20T18:00:00.000Z");
    assert.equal(escada.proximaTentativaDepoimento(3, compra), null);
  });

  test("produto: slug automático, pré-venda exige prazo, bump exige o link da entrada", () => {
    const ok = produtoLib.parseProduto({ nome: "Guia do Sono Rápido", preco: "17", checkoutUrl: CHECKOUT, oQueRecebe: "- PDF\n- Áudio\n\n" });
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.equal(ok.value.slug, "guia-do-sono-rapido");
      assert.deepEqual(ok.value.oQueRecebe, ["PDF", "Áudio"]);
      assert.equal(ok.value.depoimentoDias, 7);
    }
    const prevenda = produtoLib.parseProduto({ nome: "Livro", preco: 29, modo: "prevenda" });
    assert.ok(!prevenda.ok && /prazo de entrega/.test(prevenda.error));
    const bump = produtoLib.parseProduto({ nome: "Livro", preco: 29, escada: { bump: { nome: "B", preco: 9, checkoutUrl: CHECKOUT } } });
    assert.ok(!bump.ok && /link de pagamento da entrada/.test(bump.error));
    const slugRuim = produtoLib.parseProduto({ nome: "X", slug: "Com Espaço", preco: 1 });
    assert.ok(!slugRuim.ok);
  });

  test("importa a escada colada da página do Molde (entrada, meio, topo, obrigado)", () => {
    const json = JSON.stringify({
      entrada: { nome: "Planner Sono", preco: 17, promessa: "Durma em 20 minutos", link: CHECKOUT, itens: ["PDF", "Áudio"] },
      meio: { nome: "Curso Sono Profundo", preco: 67, descricao: "Aulas curtas", link: UPSELL },
      topo: { nome: "Mentoria", preco: 497, texto: "Acompanhamento 1:1", link: "https://exemplo.com/mentoria" },
      obrigado: { texto: "Bem-vinda!" },
    });
    const result = produtoLib.parseEscadaMolde(json);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.produto.nome, "Planner Sono");
    assert.equal(result.produto.slug, "planner-sono");
    assert.equal(result.produto.preco, 17);
    assert.equal(result.produto.checkoutUrl, CHECKOUT);
    assert.deepEqual(result.produto.oQueRecebe, ["PDF", "Áudio"]);
    assert.equal(result.produto.escada?.upsell?.nome, "Curso Sono Profundo");
    assert.equal(result.produto.escada?.upsell?.checkoutUrl, UPSELL);
    assert.equal(result.produto.obrigado?.texto, "Bem-vinda!");
    assert.deepEqual(result.produto.obrigado?.proximoPasso, { tipo: "convite", titulo: "Mentoria", texto: "Acompanhamento 1:1 A partir de US$ 497.", link: "https://exemplo.com/mentoria" });
    assert.deepEqual(result.avisos, []);
    assert.ok(!produtoLib.parseEscadaMolde("{nao é json").ok);
    assert.ok(!produtoLib.parseEscadaMolde({ meio: {} }).ok, "sem entrada não importa");
  });

  test("exportação: CSV não deixa fórmula de planilha passar; texto só com autorizados", () => {
    const linha = exportar.csv([["=HYPERLINK(\"x\")", "a,b", "normal"]]);
    assert.ok(linha.includes(`"'=HYPERLINK(""x"")"`));
    assert.ok(linha.includes(`"a,b"`));
    const base = { id: "1", produtoId: null, produtoNome: "Guia", printKey: null, autorizadoEm: null, criadoEm: "2026-10-20T12:00:00Z", depoimento: null };
    const texto = exportar.depoimentosTexto([
      { ...base, nomeExibicao: "Ana", oQueFuncionou: "Dormi melhor", autorizaUso: true },
      { ...base, id: "2", nomeExibicao: "Bia", oQueFuncionou: "Segredo", autorizaUso: false },
    ]);
    assert.match(texto, /“Dormi melhor” — Ana \(Guia\), 20\/10\/2026/);
    assert.doesNotMatch(texto, /Segredo/);
  });

  test("e-mail do pedido traz o link do formulário, o de sair e a regra da permissão", () => {
    const mensagem = emailLib.emailPedidoDepoimento({ nome: "Ana Souza", produtoNome: "Guia <Sono>", formularioUrl: "https://s.teste/depoimento/abc", descadastrarUrl: "https://s.teste/depoimento/abc/sair" });
    assert.match(mensagem.texto, /Oi, Ana!/);
    assert.match(mensagem.texto, /https:\/\/s\.teste\/depoimento\/abc\/sair/);
    assert.match(mensagem.texto, /autorizo usar/);
    assert.ok(mensagem.html.includes("Guia &lt;Sono&gt;"), "HTML escapado");
  });
});

describe("destino do post e foto na Página (sem banco)", () => {
  test("destino: tipos válidos, link obrigatório onde precisa, só valor sem link", () => {
    assert.equal(destinoLib.parseDestino({}), undefined);
    assert.deepEqual(destinoLib.parseDestino({ destinoTipo: "quiz", destinoLink: "https://quiz.teste/a" }), { tipo: "quiz", link: "https://quiz.teste/a" });
    assert.deepEqual(destinoLib.parseDestino({ destino: { tipo: "so_valor", link: "https://x.teste" } }), { tipo: "so_valor", link: null });
    assert.deepEqual(destinoLib.parseDestino({ destino: null }), { tipo: null, link: null });
    assert.deepEqual(destinoLib.parseDestino({ destinoTipo: "palavra_chave_dm" }), { tipo: "palavra_chave_dm", link: null });
    assert.deepEqual(destinoLib.parseDestino({ destinoTipo: "pagina_venda" }), { erro: destinoLib.DESTINO_SEM_LINK });
    assert.deepEqual(destinoLib.parseDestino({ destinoTipo: "outro" }), { erro: destinoLib.DESTINO_INVALIDO });
    const parsed = pkg.parsePostPackage({ publishType: "feed_image", mediaUrl: "https://midia.teste.invalid/uaiflow/a.jpg", destinoTipo: "isca_email", destinoLink: "https://isca.teste" });
    assert.ok(parsed.ok && parsed.value.destinoTipo === "isca_email" && parsed.value.destinoLink === "https://isca.teste");
  });

  test("foto do feed pode ir para a Página do Facebook; Threads e YouTube continuam só Reel", () => {
    assert.deepEqual(redesLib.redesAceitas("feed_image"), ["facebook"]);
    assert.deepEqual(redesLib.redesAceitas("reel_video"), ["facebook", "threads", "youtube"]);
    assert.deepEqual(redesLib.redesAceitas("story_image"), []);
    const img = "https://midia.teste.invalid/uaiflow/a.jpg";
    assert.ok(pkg.parsePostPackage({ publishType: "feed_image", mediaUrl: img, redes: ["instagram", "facebook"] }).ok);
    assert.deepEqual(pkg.parsePostPackage({ publishType: "feed_image", mediaUrl: img, redes: ["youtube"] }), { ok: false, error: redesLib.REDES_SO_REEL });
    assert.deepEqual(pkg.parsePostPackage({ publishType: "carousel", mediaItems: [{ url: img }, { url: img }], redes: ["facebook"] }), { ok: false, error: redesLib.REDES_SO_REEL });
  });
});

describe("com banco: produto, oferta pós-compra, obrigado, depoimento", { skip: semBanco }, () => {

  let produtoId = "";
  const SLUG = "guia-sono";
  const COOKIE = cookieSessao(SLUG);

  async function criar(extra: Record<string, unknown> = {}) {
    const response = await produtosRoute.POST(request("/api/vendas/produtos", {
      json: { nome: "Guia do Sono", slug: SLUG, preco: 17, checkoutUrl: CHECKOUT, produtoRef: "entrada-ref", escada: escadaCompleta(), obrigado: { texto: "Valeu!", proximoPasso: { tipo: "curso_email", titulo: "Curso grátis", link: "https://curso.teste" } }, ...extra },
    }));
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    produtoId = body.data.id;
    return body;
  }

  async function abrir(query = "", cookie?: string) {
    const response = await ofertaRoute.GET(request(`/p/${SLUG}/oferta${query}`, cookie ? { cookies: { [COOKIE]: cookie } } : {}), routeParams({ slug: SLUG }));
    assert.equal(response.status, 303);
    const sessao = response.cookies.get(COOKIE)?.value ?? "";
    return { response, sessao, location: response.headers.get("location") ?? "" };
  }

  async function acao(sessao: string, etapa: string, acaoNome: string, extra: Record<string, string> = {}) {
    return acaoRoute.POST(request(`/p/${SLUG}/oferta/${sessao}/acao`, { form: { etapa, acao: acaoNome, ...extra } }), routeParams({ slug: SLUG, sessao }));
  }

  const eventos = async () => (await db!.sql<{ tipo: string }>("select tipo from public.funil_eventos order by id")).map((row) => row.tipo);
  const sessaoRow = async (id: string) => (await db!.sql<{ etapa: string; oferta_expira_em: Date; aceitou_recorrencia: boolean }>("select * from public.funil_sessoes where id = $1", [id]))[0];

  beforeEach(async () => {
    await db!.sql("delete from public.depoimentos");
    await db!.sql("delete from public.compradores");
    await db!.sql("delete from public.produtos");
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_REMETENTE;
  });

  test("a 0011 cria as tabelas com RLS e as colunas de destino; o proxy deixa /p e /depoimento públicos e /api/vendas protegido", async () => {
    const tabelas = await db!.sql<{ relname: string; rls: boolean }>(
      "select relname, relrowsecurity as rls from pg_class where relname in ('produtos','funil_sessoes','funil_eventos','compradores','depoimentos') order by relname",
    );
    assert.deepEqual(tabelas.map((t) => [t.relname, t.rls]), [["compradores", true], ["depoimentos", true], ["funil_eventos", true], ["funil_sessoes", true], ["produtos", true]]);
    const colunas = await db!.sql<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'content_posts' and column_name like 'destino_%' order by 1");
    assert.deepEqual(colunas.map((c) => c.column_name), ["destino_link", "destino_tipo"]);
    const { proxy } = await import("@/proxy");
    for (const path of ["/p/guia-sono", "/p/guia-sono/oferta", "/depoimento/abc"]) assert.equal((await proxy(request(path))).headers.get("x-middleware-next"), "1", path);
    assert.equal((await proxy(request("/api/vendas/produtos"))).status, 401);
    assert.equal((await proxy(request("/perfis"))).status, 307, "/perfis continua fechado (o prefixo /p não abre /perfis)");
  });

  test("cria, lê, edita e recusa slug repetido; recorrência sem cancelamento não salva", async () => {
    await criar();
    const repetido = await produtosRoute.POST(request("/api/vendas/produtos", { json: { nome: "Outro", slug: SLUG, preco: 5 } }));
    assert.equal(repetido.status, 409);
    const semCancelar = await produtosRoute.POST(request("/api/vendas/produtos", { json: { nome: "Outro", preco: 5, escada: { recorrencia: { nome: "C", preco: 9, checkoutUrl: ASSINATURA } } } }));
    assert.equal(semCancelar.status, 400);
    assert.match((await semCancelar.json()).error, /ROSCA/);
    const lista = await (await produtosRoute.GET(request("/api/vendas/produtos"))).json();
    assert.equal(lista.data.length, 1);
    assert.equal(lista.data[0].escada.upsell.prazoMinutos, 15);
    const patch = await produtoRoute.PATCH(request(`/api/vendas/produtos/${produtoId}`, { method: "PATCH", json: { nome: "Guia do Sono 2", slug: SLUG, preco: 19, checkoutUrl: CHECKOUT } }), routeParams({ id: produtoId }));
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).data.preco, 19);
    const importado = await (await molde.POST(request("/api/vendas/escada-molde", { json: { json: { entrada: { nome: "X", preco: 7 } } } }))).json();
    assert.equal(importado.data.nome, "X");
    assert.match(importado.warning, /sem link de pagamento/);
  });

  test("o prazo do desconto é gravado uma vez: a mesma compra ou o mesmo navegador nunca reiniciam o relógio", async () => {
    await criar();
    const primeira = await abrir("?compra=cs_test_123");
    assert.match(primeira.location, new RegExp(`/p/${SLUG}/oferta/${primeira.sessao}$`));
    const expira1 = (await sessaoRow(primeira.sessao)).oferta_expira_em;
    const criado = (await db!.sql<{ criado_em: Date }>("select criado_em from public.funil_sessoes where id = $1", [primeira.sessao]))[0].criado_em;
    assert.equal(expira1.getTime() - criado.getTime(), 15 * 60_000);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const deNovo = await abrir("?compra=cs_test_123"); // outro navegador, mesma compra
    assert.equal(deNovo.sessao, primeira.sessao);
    const peloCookie = await abrir("", primeira.sessao); // mesmo navegador, sem o id da compra
    assert.equal(peloCookie.sessao, primeira.sessao);
    assert.equal((await sessaoRow(primeira.sessao)).oferta_expira_em.getTime(), expira1.getTime(), "o prazo não mudou");
    assert.deepEqual(await eventos(), ["entrada"], "a compra da entrada conta uma vez só");
    const [sessoes] = await db!.sql<{ n: string }>("select count(*) as n from public.funil_sessoes");
    assert.equal(Number(sessoes.n), 1);
  });

  test("recusar o upsell leva ao downsell; aceitar o downsell vai ao link dele e pula para a recorrência", async () => {
    await criar();
    const { sessao } = await abrir("?compra=cs_a");
    const recusa = await acao(sessao, "upsell", "recusar");
    assert.equal(recusa.status, 303);
    assert.match(recusa.headers.get("location") ?? "", new RegExp(`/oferta/${sessao}$`));
    assert.equal((await sessaoRow(sessao)).etapa, "downsell");

    const velho = await acao(sessao, "upsell", "aceitar"); // formulário velho do upsell
    assert.match(velho.headers.get("location") ?? "", new RegExp(`/oferta/${sessao}$`), "passo velho só volta para a página");
    assert.equal((await sessaoRow(sessao)).etapa, "downsell");

    const aceite = await acao(sessao, "downsell", "aceitar");
    assert.equal(aceite.headers.get("location"), DOWNSELL);
    assert.equal((await sessaoRow(sessao)).etapa, "recorrencia");

    const semConcordo = await acao(sessao, "recorrencia", "aceitar");
    assert.match(semConcordo.headers.get("location") ?? "", /\?erro=concordo$/);
    assert.equal((await sessaoRow(sessao)).etapa, "recorrencia", "sem a caixa marcada, nada muda");
    const assinou = await acao(sessao, "recorrencia", "aceitar", { concordo: "on" });
    assert.equal(assinou.headers.get("location"), ASSINATURA);
    const row = await sessaoRow(sessao);
    assert.equal(row.etapa, "obrigado");
    assert.equal(row.aceitou_recorrencia, true);
    assert.deepEqual(await eventos(), ["entrada", "recusou_upsell", "aceitou_downsell", "aceitou_recorrencia"]);
    const voltar = await abrir("", sessao);
    assert.match(voltar.location, new RegExp(`/p/${SLUG}/obrigado$`), "depois da escada, o retorno da plataforma cai no obrigado");
  });

  test("depois do prazo o link com desconto nunca sai: preço cheio, ou oferta encerrada sem link", async () => {
    await criar();
    const { sessao } = await abrir("?compra=cs_b");
    await db!.sql("update public.funil_sessoes set oferta_expira_em = now() - interval '1 minute' where id = $1", [sessao]);
    const cheio = await acao(sessao, "upsell", "aceitar");
    assert.equal(cheio.headers.get("location"), UPSELL_CHEIO);
    const [ev] = await db!.sql<{ valor: string }>("select valor from public.funil_eventos where tipo = 'aceitou_upsell'");
    assert.equal(Number(ev.valor), 97);

    await db!.sql("delete from public.produtos");
    await criar({ escada: escadaCompleta({ upsell: { nome: "Curso", preco: 67, checkoutUrl: UPSELL, prazoMinutos: 15 } }) });
    const outra = await abrir("?compra=cs_c");
    await db!.sql("update public.funil_sessoes set oferta_expira_em = now() - interval '1 minute' where id = $1", [outra.sessao]);
    const encerrada = await acao(outra.sessao, "upsell", "aceitar");
    assert.match(encerrada.headers.get("location") ?? "", new RegExp(`/oferta/${outra.sessao}$`));
    assert.notEqual(encerrada.headers.get("location"), UPSELL);
    assert.equal((await sessaoRow(outra.sessao)).etapa, "upsell");
    const continuar = await acao(outra.sessao, "upsell", "continuar");
    assert.match(continuar.headers.get("location") ?? "", new RegExp(`/oferta/${outra.sessao}$`));
    assert.equal((await sessaoRow(outra.sessao)).etapa, "downsell");
  });

  test("comprar conta o clique e manda ao link da plataforma (com bump: o link da entrada + bump)", async () => {
    await criar();
    const normal = await comprarRoute.GET(request(`/p/${SLUG}/comprar`), routeParams({ slug: SLUG }));
    assert.equal(normal.headers.get("location"), CHECKOUT);
    const bump = await comprarRoute.GET(request(`/p/${SLUG}/comprar?bump=1`), routeParams({ slug: SLUG }));
    assert.equal(bump.headers.get("location"), "https://buy.stripe.com/entrada-bump");
    assert.deepEqual(await eventos(), ["clique_comprar", "clique_comprar_bump"]);
    await db!.sql("update public.produtos set ativo = false");
    assert.equal((await comprarRoute.GET(request(`/p/${SLUG}/comprar`), routeParams({ slug: SLUG }))).status, 404, "fora do ar = 404");
  });

  test("obrigado guarda o e-mail na lista própria e agenda o pedido de depoimento para 7 dias depois", async () => {
    await criar();
    const { sessao } = await abrir("?compra=cs_d");
    const robo = await emailRoute.POST(request(`/p/${SLUG}/obrigado/email`, { form: { email: "robo@x.com", site: "spam" } }), routeParams({ slug: SLUG }));
    assert.match(robo.headers.get("location") ?? "", /ok=1/);
    const ruim = await emailRoute.POST(request(`/p/${SLUG}/obrigado/email`, { form: { email: "sem-arroba" } }), routeParams({ slug: SLUG }));
    assert.match(ruim.headers.get("location") ?? "", /erro=email/);
    const ok = await emailRoute.POST(request(`/p/${SLUG}/obrigado/email`, { form: { email: "Ana@Exemplo.com", nome: "Ana", novidades: "on" }, cookies: { [COOKIE]: sessao } }), routeParams({ slug: SLUG }));
    assert.match(ok.headers.get("location") ?? "", /ok=1/);
    await emailRoute.POST(request(`/p/${SLUG}/obrigado/email`, { form: { email: "ana@exemplo.com" } }), routeParams({ slug: SLUG }));
    const compradores = await db!.sql<{ email: string; nome: string; aceita_novidades: boolean; compra_ref: string; depoimento_pedir_em: Date; criado_em: Date }>("select * from public.compradores");
    assert.equal(compradores.length, 1, "o mesmo e-mail não duplica (nem o do robô entra)");
    assert.equal(compradores[0].email, "ana@exemplo.com");
    assert.equal(compradores[0].aceita_novidades, true, "a caixa marcada antes não é desmarcada");
    assert.equal(compradores[0].compra_ref, "cs_d");
    assert.equal(compradores[0].depoimento_pedir_em.getTime() - compradores[0].criado_em.getTime(), 7 * 86_400_000);
  });

  test("relógio manda o pedido de depoimento só quando vence, uma vez; sem e-mail configurado não manda", async () => {
    await criar({ depoimentoDias: 3 });
    const produto = (await funil.getProduto(produtoId))!;
    const comprador = await funil.salvarComprador(produto, { email: "bia@exemplo.com", nome: "Bia Lima", aceitaNovidades: false }, new Date(Date.now() - 4 * 86_400_000));
    const enviados: Array<{ para: string; texto: string }> = [];
    const enviar = async (_config: unknown, mensagem: { para: string; texto: string }) => { enviados.push(mensagem); };

    assert.equal((await relogio.runVendasClock({ deadline: Date.now() + 9000, enviar })).motivo, "sem_email");
    Object.assign(process.env, { RESEND_API_KEY: "re_chave_falsa", EMAIL_REMETENTE: "Teste <oi@exemplo.com>" });

    const r1 = await relogio.runVendasClock({ deadline: Date.now() + 9000, enviar });
    assert.equal(r1.enviados, 1);
    assert.equal(enviados[0].para, "bia@exemplo.com");
    assert.ok(enviados[0].texto.includes(`https://uaiflow.teste/depoimento/${comprador.depoimentoToken}`));
    const r2 = await relogio.runVendasClock({ deadline: Date.now() + 9000, enviar });
    assert.equal(r2.enviados, 0, "não manda duas vezes");
    const [row] = await db!.sql<{ depoimento_pedido_em: Date; depoimento_canal: string }>("select * from public.compradores where id = $1", [comprador.id]);
    assert.ok(row.depoimento_pedido_em);
    assert.equal(row.depoimento_canal, "email");

    // ainda não venceu: não manda
    await funil.salvarComprador(produto, { email: "cris@exemplo.com", aceitaNovidades: false });
    assert.equal((await relogio.runVendasClock({ deadline: Date.now() + 9000, enviar })).enviados, 0);
  });

  test("erro no e-mail: tenta de novo em 1 h e desiste na 3ª; quem saiu da lista não recebe", async () => {
    await criar();
    const produto = (await funil.getProduto(produtoId))!;
    Object.assign(process.env, { RESEND_API_KEY: "re_chave_falsa", EMAIL_REMETENTE: "Teste <oi@exemplo.com>" });
    const c = await funil.salvarComprador(produto, { email: "dani@exemplo.com", aceitaNovidades: false }, new Date(Date.now() - 8 * 86_400_000));
    const falha = async () => { throw new emailLib.EmailError("O serviço de e-mail recusou (422)."); };
    const r = await relogio.runVendasClock({ deadline: Date.now() + 9000, enviar: falha });
    assert.equal(r.erros, 1);
    let [row] = await db!.sql<{ depoimento_tentativas: number; depoimento_pedir_em: Date | null; depoimento_erro: string }>("select * from public.compradores where id = $1", [c.id]);
    assert.equal(row.depoimento_tentativas, 1);
    assert.ok(Math.abs(row.depoimento_pedir_em!.getTime() - (Date.now() + 3600_000)) < 60_000);
    assert.match(row.depoimento_erro, /422/);
    for (let i = 0; i < 2; i += 1) {
      await db!.sql("update public.compradores set depoimento_pedir_em = now() - interval '1 minute' where id = $1", [c.id]);
      await relogio.runVendasClock({ deadline: Date.now() + 9000, enviar: falha });
    }
    [row] = await db!.sql("select * from public.compradores where id = $1", [c.id]);
    assert.equal(row.depoimento_tentativas, 3);
    assert.equal(row.depoimento_pedir_em, null, "desistiu: fica para mandar à mão pelo painel");

    const saiu = await funil.salvarComprador(produto, { email: "eva@exemplo.com", aceitaNovidades: true }, new Date(Date.now() - 8 * 86_400_000));
    const sair = await sairRoute.GET(request(`/depoimento/${saiu.depoimentoToken}/sair`), routeParams({ token: saiu.depoimentoToken! }));
    assert.match(sair.headers.get("location") ?? "", /saiu=1/);
    const enviados: unknown[] = [];
    await relogio.runVendasClock({ deadline: Date.now() + 9000, enviar: async (_c, m) => { enviados.push(m); } });
    assert.equal(enviados.length, 0);
  });

  test("formulário de depoimento guarda data e permissão; export só traz autorizados no texto", async () => {
    await criar();
    const produto = (await funil.getProduto(produtoId))!;
    const c = await funil.salvarComprador(produto, { email: "fe@exemplo.com", aceitaNovidades: false });
    const token = c.depoimentoToken!;
    const vazio = await enviarRoute.POST(request(`/depoimento/${token}/enviar`, { form: { o_que_funcionou: "" } }), routeParams({ token }));
    assert.match(vazio.headers.get("location") ?? "", /erro=texto/);
    const sim = await enviarRoute.POST(request(`/depoimento/${token}/enviar`, { form: { o_que_funcionou: "Dormi em 15 min", depoimento: "Mudou minhas noites", nome_exibicao: "Fê", autorizo: "on" } }), routeParams({ token }));
    assert.match(sim.headers.get("location") ?? "", /enviado=1/);
    await enviarRoute.POST(request(`/depoimento/${token}/enviar`, { form: { o_que_funcionou: "Só para você" } }), routeParams({ token }));
    const rows = await db!.sql<{ autoriza_uso: boolean; autorizado_em: Date | null; criado_em: Date }>("select * from public.depoimentos order by criado_em");
    assert.deepEqual(rows.map((r) => [r.autoriza_uso, Boolean(r.autorizado_em)]), [[true, true], [false, false]]);
    const texto = await (await depoimentosRoute.GET(request("/api/vendas/depoimentos?formato=texto"))).text();
    assert.match(texto, /“Mudou minhas noites” — Fê \(Guia do Sono\)/);
    assert.doesNotMatch(texto, /Só para você/);
    const csvResp = await depoimentosRoute.GET(request("/api/vendas/depoimentos?formato=csv"));
    assert.match(csvResp.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(await csvResp.text(), /Só para você/);
    assert.equal((await enviarRoute.POST(request("/depoimento/token-que-nao-existe-123/enviar", { form: { o_que_funcionou: "x" } }), routeParams({ token: "token-que-nao-existe-123" }))).status, 404);
  });

  test("pré-venda: lista de quem comprou (CSV) e marcar como avisados na entrega", async () => {
    await criar({ modo: "prevenda", prevendaEntrega: "2026-12-01" });
    const produto = (await funil.getProduto(produtoId))!;
    assert.equal(produto.prevendaEntrega, "2026-12-01");
    await funil.salvarComprador(produto, { email: "g@exemplo.com", aceitaNovidades: false });
    await funil.salvarComprador(produto, { email: "h@exemplo.com", aceitaNovidades: false });
    const csvText = await (await compradoresRoute.GET(request(`/api/vendas/compradores?produtoId=${produtoId}&prevenda=1&formato=csv`))).text();
    assert.match(csvText, /g@exemplo\.com/);
    assert.match(csvText, /h@exemplo\.com/);
    const marcar = await produtoRoute.POST(request(`/api/vendas/produtos/${produtoId}`, { json: { acao: "marcar_avisados" } }), routeParams({ id: produtoId }));
    assert.equal((await marcar.json()).marcados, 2);
    const again = await produtoRoute.POST(request(`/api/vendas/produtos/${produtoId}`, { json: { acao: "marcar_avisados" } }), routeParams({ id: produtoId }));
    assert.equal((await again.json()).marcados, 0);
  });

  test("valor médio real soma as vendas (webhook) de todos os degraus da escada", async () => {
    await criar();
    const { sessao } = await abrir("?compra=cs_m");
    await acao(sessao, "upsell", "aceitar");
    await db!.sql(
      `insert into public.vendas (plataforma, raw_id, produto_ref, valor, moeda) values
         ('stripe', 'v1', 'entrada-ref', 17, 'USD'), ('stripe', 'v2', 'entrada-ref', 17, 'USD'),
         ('stripe', 'v3', 'upsell-ref', 67, 'USD'), ('stripe', 'v4', 'outro-produto', 999, 'USD')`,
    );
    await db!.sql("insert into public.vendas (plataforma, raw_id, produto_ref, valor, moeda, status, valor_reembolsado) values ('stripe', 'v5', 'bump-ref', 12, 'USD', 'reembolsada', 12)");
    const produtos = await funil.listarProdutos();
    const m = (await funil.metricasProdutos(produtos, 30)).get(produtoId)!;
    assert.equal(m.comprasEntrada, 2);
    assert.equal(m.receitaReal, 101);
    assert.equal(m.valorMedioReal, 50.5);
    assert.equal(m.upsell.aceitaram, 1);
    assert.equal(m.valorMedioEstimado, 17 + 67);
  });
});

describe("com banco: destino guardado e foto do feed na Página", { skip: semBanco }, () => {
  let accountId = "";
  const IMG = "https://midia.teste.invalid/uaiflow/foto.jpg";

  before(async () => {
    accountId = await seedAccount(db!, { username: "conta_destino", userId: "17840000000000077" });
    await db!.sql(
      `insert into public.instagram_facebook_connections (account_id, instagram_user_id, page_id, page_name, user_access_token, user_token_expires_at, page_access_token, granted_scopes)
       values ($1, '17840000000000077', 'page-1', 'Página', 'FB-TESTE-USUARIO', now() + interval '50 days', 'FB-TESTE-PAGINA', $2)`,
      [accountId, ["pages_show_list", "pages_read_engagement", "pages_manage_posts"]],
    );
  });

  beforeEach(() => meta.reset());

  test("destino do post é guardado ao criar e ao editar (null tira)", async () => {
    const parsed = pkg.parsePostPackage({ accountId, publishType: "feed_image", mediaUrl: IMG, destinoTipo: "quiz", destinoLink: "https://quiz.teste/sono" });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const post = await planner.createPlannedPost(parsed.value);
    assert.equal(post.destino_tipo, "quiz");
    assert.equal(post.destino_link, "https://quiz.teste/sono");
    const edited = await planner.updatePlannedPost(post.id, { destinoTipo: null, destinoLink: null });
    assert.equal(edited?.destino_tipo, null);
    assert.equal(edited?.destino_link, null);
    const keep = await planner.updatePlannedPost(post.id, { caption: "nova" });
    assert.equal(keep?.destino_tipo, null);
  });

  test("foto do feed sai na Página do Facebook (POST /photos) com a legenda; o link vem do post", async () => {
    const id = await insertPost(db!, accountId, { publish_type: "feed_image", media_url: IMG, status: "published", published_at: new Date(), redes: ["instagram", "facebook"], caption: "Foto com legenda" });
    await db!.sql("insert into public.content_post_redes (post_id, rede) values ($1, 'facebook')", [id]);
    await publisher.runRedesCycle(Date.now() + 20_000);
    const [row] = await db!.sql<{ status: string; external_id: string; permalink: string; etapa: string }>("select * from public.content_post_redes where post_id = $1", [id]);
    assert.equal(row.status, "published", JSON.stringify(row));
    assert.match(row.external_id, /^page-1_\d+$/);
    assert.match(row.permalink, /^https:\/\/www\.facebook\.com\//);
    const call = meta.calls.find((item) => item.path.endsWith("/photos"));
    assert.equal(call?.body.url, IMG);
    assert.equal(call?.body.caption, "Foto com legenda");
    assert.equal(call?.body.published, true);
    assert.equal(meta.calls.filter((item) => item.path.endsWith("/video_reels")).length, 0, "não tenta Reel para foto");
  });

  test("rodada cortada no meio da foto não publica de novo às cegas; Threads em foto fica com erro na hora", async () => {
    const id = await insertPost(db!, accountId, { publish_type: "feed_image", media_url: IMG, status: "published", published_at: new Date(), redes: ["instagram", "facebook", "threads"] });
    await db!.sql("insert into public.content_post_redes (post_id, rede, status, etapa) values ($1, 'facebook', 'processing', 'photo_requested'), ($1, 'threads', 'pending', null)", [id]);
    await publisher.runRedesCycle(Date.now() + 20_000);
    const rows = await db!.sql<{ rede: string; status: string; last_error: string }>("select * from public.content_post_redes where post_id = $1 order by rede", [id]);
    assert.deepEqual(rows.map((r) => [r.rede, r.status]), [["facebook", "failed"], ["threads", "failed"]]);
    assert.match(rows[0].last_error, /Confira na Página/);
    assert.match(rows[1].last_error, /só recebe Reel/);
    assert.equal(meta.calls.filter((item) => item.path.endsWith("/photos")).length, 0);
    assert.ok(await redesDb.retryRede(id, "facebook"), "«Tentar de novo» volta a Página");
  });
});
