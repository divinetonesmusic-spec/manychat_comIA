import "./helpers/env.mjs";
import { comAfter } from "./helpers/escopo-next.mjs";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { BASE_URL, request, routeParams } from "./helpers/http.mjs";
import { insertPost, seedAccount } from "./helpers/seed.mjs";

/**
 * O funil do Molde (0013): o quiz (/q/<slug>) com o pacote conferido, a pontuação no servidor, o e-mail antes do resultado na
 * Lista própria (com o consentimento que a pessoa marcou), o botão da oferta com ?perfil= e o código de compra do perfil, a
 * venda casada pelo código (compras por perfil); a pergunta do quiz na DM (botões → etiqueta do perfil e o link do quiz); a
 * página de entrega (arquivos privados no R2, publicar só com os arquivos conferidos, o download só depois do e-mail); a
 * Lista própria em CSV e o sair da lista.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const banco: TestDatabase | null = semBanco ? null : await createTestDatabase();
const CHECKOUT = "https://pay.hotmart.com/X123?src=MOQUIZORIGEM&sck=MOQUIZORIGEM";

function quizBom(extra: Record<string, unknown> = {}) {
  const op = (texto: string, pesos: Record<string, number>) => ({ texto, pesos });
  return {
    titulo: "O que está matando o seu sono?",
    subtitulo: "Descubra em 1 minuto.",
    idioma: "pt-BR",
    perfis: [
      { id: "nao-pega", nome: "A mente acelerada", causa: "Cortisol alto à noite.", miniPlano: ["Desligue a tela às 21h", "Respire 4-7-8"], projecao: "Em 2 semanas, pegar no sono mais rápido.", ofertaDegrau: "entrada", oferta: { nome: "Planner do Sono", preco: 27, moeda: "R$", garantia: "7 dias, sem perguntas", checkout: CHECKOUT } },
      { id: "acorda", nome: "O sono picado", causa: "Despertares de madrugada.", miniPlano: "Sem cafeína depois das 14h\nQuarto escuro", projecao: "Menos despertares.", oferta: { nome: "Guia Noite Inteira", preco: 47, checkout: "https://loja.teste.invalid/guia" } },
      { id: "cansado", nome: "O sono que não descansa", causa: "Sono leve.", projecao: "Acordar com energia.", oferta: { nome: "Curso Sono Profundo", preco: 97 } },
    ],
    perguntas: [
      { texto: "Qual a sua idade?", tipo: "botoes", opcoes: [op("Até 30", { "nao-pega": 1 }), op("31 a 50", { acorda: 1 }), op("Mais de 50", { cansado: 1 })] },
      { texto: "O que mais acontece?", tipo: "botoes", opcoes: [op("Demoro a pegar no sono", { "nao-pega": 3 }), op("Acordo de madrugada", { acorda: 3 }), op("Acordo cansada", { cansado: 3 })] },
      { texto: "O que você já tentou?", tipo: "botoes", opcoes: [op("Chá", { "nao-pega": 1 }), op("Remédio", { acorda: 1 }), op("Nada", { cansado: 1 })] },
      { texto: "Quanto isso te atrapalha?", tipo: "escala", opcoes: [op("1", {}), op("2", { cansado: 1 }), op("3", { acorda: 1 }), op("4", { "nao-pega": 1 })] },
      { texto: "Sua meta?", tipo: "botoes", opcoes: [op("Dormir rápido", { "nao-pega": 2 }), op("Noite inteira", { acorda: 2 }), op("Acordar bem", { cansado: 2 })] },
      { texto: "Para quando?", tipo: "botoes", opcoes: [op("Esta semana", { "nao-pega": 1 }), op("Este mês", { acorda: 1 })] },
    ],
    provaSocial: { tipo: "como", passos: ["Responda 6 perguntas", "Veja o seu perfil", "Receba o plano"] },
    dmPergunta: { texto: "O que mais te tira o sono?", botoes: [{ rotulo: "Não pego no sono", perfilId: "nao-pega" }, { rotulo: "Acordo de noite", perfilId: "acorda" }, { rotulo: "Acordo cansada", perfilId: "cansado" }] },
    marca: { nome: "Lua", cores: { fundo: "#0B0A10", texto: "#222222", primaria: "#D9B26A" }, fontes: { titulo: "Cormorant Garamond", corpo: "Atkinson Hyperlegible" } },
    aviso: "Personagem criado com IA.",
    ...extra,
  };
}

describe("funil do Molde (sem banco)", () => {
  test("lerQuiz: o quiz bom passa; sem perfil alcançável, sem perguntas e link inseguro não passam", async () => {
    const { lerQuiz } = await import("@/lib/funil/quiz");
    const bom = lerQuiz(quizBom());
    assert.ok(bom.ok, JSON.stringify(bom));
    if (!bom.ok) return;
    assert.deepEqual(bom.quiz.perfis[1].miniPlano, ["Sem cafeína depois das 14h", "Quarto escuro"]);
    assert.equal(bom.quiz.perfis[0].oferta.moeda, "R$");
    assert.ok(bom.avisos.some((a) => /sem o link da oferta/.test(a)), "o perfil sem checkout avisa");
    assert.equal(bom.quiz.provaSocial.tipo, "como");
    assert.equal(bom.quiz.dmPergunta?.botoes.length, 3);
    const semAlcance = lerQuiz(quizBom({ perguntas: quizBom().perguntas.map((p) => ({ ...p, opcoes: p.opcoes.map((o) => ({ ...o, pesos: { "nao-pega": 1 } })) })) }));
    assert.equal(semAlcance.ok, false);
    if (!semAlcance.ok) assert.ok(semAlcance.erros.some((e) => /Nenhuma resposta leva ao perfil «O sono picado»/.test(e)));
    const poucas = lerQuiz(quizBom({ perguntas: quizBom().perguntas.slice(0, 2) }));
    assert.equal(poucas.ok, false);
    const inseguro = lerQuiz(quizBom({ perfis: quizBom().perfis.map((p, i) => (i ? p : { ...p, oferta: { ...p.oferta, checkout: "http://x.teste" } })) }));
    assert.equal(inseguro.ok, false);
    // prova social só com número de verdade (tem dígito); sem número vira «como funciona»
    const semNumero = lerQuiz(quizBom({ provaSocial: { tipo: "numero", numero: "muitas", texto: "pessoas" } }));
    assert.ok(semNumero.ok && semNumero.quiz.provaSocial.tipo === "como");
  });

  test("pontuar: soma os pesos, a DM vale 2 e desempata; respostas ruins viram -1", async () => {
    const { lerQuiz, pontuar, respostasValidas, respostasEspelho } = await import("@/lib/funil/quiz");
    const r = lerQuiz(quizBom());
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(pontuar(r.quiz, [1, 1, 1, 2, 1, 1]), "acorda");
    assert.equal(pontuar(r.quiz, [0, 0, 0, 3, 0, 0]), "nao-pega");
    assert.equal(pontuar(r.quiz, [-1, -1, -1, -1, -1, -1], "cansado"), "cansado");
    assert.deepEqual(respostasValidas(r.quiz, [9, "1", -3, 2.5]), [-1, 1, -1, -1, -1, -1]);
    assert.deepEqual(respostasEspelho(r.quiz, [1, 1, 1, 2, 1, 1], "acorda"), ["Acordo de madrugada", "Noite inteira"]);
  });

  test("o código da compra: o mesmo da página do Molde (rec131Codigo) e o checkout com ?perfil=", async () => {
    const { codigoOrigem, codigoDoPerfil, checkoutDoPerfil, lerQuiz } = await import("@/lib/funil/quiz");
    // o mesmo cálculo FNV-1a da página (v131r_receita.js): conferido com o valor da página para "proj-1:reel-1"
    let h = 0x811c9dc5;
    for (const c of "proj-1:reel-1") { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    assert.equal(codigoOrigem("proj-1:reel-1"), `mo${h.toString(36)}`);
    const c = codigoDoPerfil("sono", "nao-pega", "mo123");
    assert.match(c, /^mo[a-z0-9]{1,7}$/);
    assert.notEqual(c, codigoDoPerfil("sono", "acorda", "mo123"));
    const r = lerQuiz(quizBom());
    assert.ok(r.ok);
    if (!r.ok) return;
    const url = new URL(checkoutDoPerfil(r.quiz.perfis[0], c) as string);
    assert.equal(url.searchParams.get("src"), c);
    assert.equal(url.searchParams.get("sck"), c);
    assert.equal(url.searchParams.get("perfil"), "nao-pega");
    const semMarca = new URL(checkoutDoPerfil(r.quiz.perfis[1], c) as string);
    assert.equal(semMarca.searchParams.get("src"), c, "sem a marca do lugar, o código vai em ?src=");
    assert.equal(checkoutDoPerfil(r.quiz.perfis[2], c), null);
  });

  test("a marca: cores conferidas e contraste AA garantido (texto ruim troca, botão aparece no fundo)", async () => {
    const { lerMarca, contraste, googleFontsUrl } = await import("@/lib/funil/marca");
    const m = lerMarca(quizBom().marca);
    assert.ok(contraste(m.texto, m.superficie) >= 4.5, "texto legível no cartão");
    assert.ok(contraste(m.suave, m.superficie) >= 4.5, "texto apagado legível");
    assert.ok(contraste(m.textoPrimaria, m.primaria) >= 4.5, "texto do botão legível");
    assert.ok(contraste(m.primaria, m.fundo) >= 3, "o botão aparece no fundo");
    assert.equal(m.fonteTitulo, "Cormorant Garamond");
    assert.match(String(googleFontsUrl(m)), /family=Cormorant\+Garamond/);
    const ruim = lerMarca({ cores: { fundo: "javascript:alert(1)", primaria: "red" }, fontes: { titulo: "x</style>" }, foto: "http://inseguro" });
    assert.equal(ruim.fundo, "#FBF8F3");
    assert.equal(ruim.fonteTitulo, "");
    assert.equal(ruim.foto, null);
  });

  test("o pacote do post leva a pergunta do quiz na DM (automationOptions.quizDm); errada fica de fora", async () => {
    const { parsePostPackage } = await import("@/lib/content/package");
    const { quickRepliesDoQuiz, lerPayloadQuiz } = await import("@/lib/funil/quiz-dm");
    const base = { publishType: "reel", mediaUrl: "https://midia.teste.invalid/r.mp4", keyword: "SONO", dmText: "Valeu!" };
    const quizDm = { slug: "sono", texto: "O que mais te tira o sono?", origem: "mo1abc", botoes: [{ rotulo: "Não pego no sono", perfilId: "nao-pega" }, { rotulo: "Acordo de noite", perfilId: "acorda" }] };
    const bom = parsePostPackage({ ...base, automationOptions: { quizDm } });
    assert.ok(bom.ok && bom.value.automationOptions?.quizDm);
    if (!bom.ok || !bom.value.automationOptions?.quizDm) return;
    const qr = quickRepliesDoQuiz(bom.value.automationOptions.quizDm);
    assert.deepEqual(qr[0], { title: "Não pego no sono", payload: "quiz:sono:nao-pega:mo1abc" });
    assert.deepEqual(lerPayloadQuiz(qr[1].payload), { slug: "sono", perfilId: "acorda", origem: "mo1abc" });
    const umBotao = parsePostPackage({ ...base, automationOptions: { quizDm: { ...quizDm, botoes: quizDm.botoes.slice(0, 1) } } });
    assert.ok(umBotao.ok && !umBotao.value.automationOptions?.quizDm, "com 1 botão só: fica de fora (o post sai como antes)");
  });
});

describe("funil do Molde (com banco)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let quizRota: typeof import("@/app/api/molde/quiz/route");
  let evento: typeof import("@/app/q/[slug]/evento/route");
  let ir: typeof import("@/app/q/[slug]/ir/route");
  let entregas: typeof import("@/app/api/molde/entregas/route");
  let publicar: typeof import("@/app/api/molde/entregas/[id]/publicar/route");
  let emailEntrega: typeof import("@/app/e/[slug]/email/route");
  let baixar: typeof import("@/app/e/[slug]/baixar/route");
  let leads: typeof import("@/app/api/molde/leads/route");
  let sair: typeof import("@/app/lista/sair/[codigo]/confirmar/route");
  let webhook: typeof import("@/app/api/webhook/route");
  let scheduler: typeof import("@/lib/content/scheduler");
  let repos: typeof import("@/lib/db/repositories");
  let conta: string;

  before(async () => {
    db = banco!;
    quizRota = await import("@/app/api/molde/quiz/route");
    evento = await import("@/app/q/[slug]/evento/route");
    ir = await import("@/app/q/[slug]/ir/route");
    entregas = await import("@/app/api/molde/entregas/route");
    publicar = await import("@/app/api/molde/entregas/[id]/publicar/route");
    emailEntrega = await import("@/app/e/[slug]/email/route");
    baixar = await import("@/app/e/[slug]/baixar/route");
    leads = await import("@/app/api/molde/leads/route");
    sair = await import("@/app/lista/sair/[codigo]/confirmar/route");
    webhook = await import("@/app/api/webhook/route");
    scheduler = await import("@/lib/content/scheduler");
    repos = await import("@/lib/db/repositories");
  });

  beforeEach(async () => {
    meta.reset();
    for (const t of ["formulario_limites", "compradores", "produtos", "quiz_origens", "quiz_sessoes", "leads", "entrega_eventos", "entregas", "quizzes", "vendas", "queue", "events", "contacts", "content_posts", "automations", "profile_settings", "instagram_accounts"]) await db.sql(`delete from public.${t}`);
    conta = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
  });

  after(async () => {
    meta.restore();
    await db?.close();
  });

  async function publicarQuiz(extra: Record<string, unknown> = {}) {
    const r = await quizRota.POST(request("/api/molde/quiz", { headers: MOLDE, json: { molde: "proj-1", accountId: conta, slug: "Sono Quiz", quiz: quizBom(), ...extra } }));
    const j = (await r.json()) as { data: { id: string; slug: string; url: string }; error?: string };
    return { status: r.status, ...j };
  }
  async function ev(slug: string, corpo: Record<string, unknown>) {
    const r = await evento.POST(request(`/q/${slug}/evento`, { json: corpo }), routeParams({ slug }));
    return { status: r.status, j: (await r.json()) as Record<string, unknown> };
  }

  test("o quiz: publicar (sem token = 401), atualizar no mesmo endereço, o caminho inteiro da pessoa e os números por perfil", async () => {
    const semToken = await quizRota.POST(request("/api/molde/quiz", { json: { molde: "proj-1", quiz: quizBom() } }));
    assert.equal(semToken.status, 401);
    const ruim = await quizRota.POST(request("/api/molde/quiz", { headers: MOLDE, json: { molde: "proj-1", quiz: { titulo: "x" } } }));
    assert.equal(ruim.status, 400);

    const p = await publicarQuiz();
    assert.equal(p.status, 201);
    assert.equal(p.data.slug, "sono-quiz");
    assert.equal(p.data.url, `${BASE_URL}/q/sono-quiz`);
    const de_novo = await publicarQuiz({ id: p.data.id, quiz: quizBom({ titulo: "Novo título" }) });
    assert.equal(de_novo.status, 200);
    assert.equal(de_novo.data.slug, "sono-quiz");
    // outro projeto pedindo o mesmo endereço ganha outro
    const outro = await quizRota.POST(request("/api/molde/quiz", { headers: MOLDE, json: { molde: "proj-2", slug: "sono-quiz", quiz: quizBom() } }));
    assert.equal(((await outro.json()) as { data: { slug: string } }).data.slug, "sono-quiz-2");

    // a pessoa: início (vindo da DM com o perfil e o post), respostas, fim (o servidor calcula), e-mail, oferta
    const ini = await ev("sono-quiz", { acao: "inicio", perfil: "acorda", o: "mo1abc", de: "dm" });
    const sessao = String(ini.j.sessao);
    assert.match(sessao, /^[0-9a-f-]{36}$/);
    assert.equal((await ev("sono-quiz", { acao: "respostas", sessao, respostas: [0, 0] })).j.ok, true);
    const fim = await ev("sono-quiz", { acao: "fim", sessao, respostas: [0, 0, 0, 3, 0, 0] });
    assert.equal(fim.j.perfil, "nao-pega");
    const emailRuim = await ev("sono-quiz", { acao: "email", sessao, email: "sem-arroba" });
    assert.equal(emailRuim.status, 400);
    const email = await ev("sono-quiz", { acao: "email", sessao, email: "Ana@Exemplo.com", nome: "Ana", consentimento: true });
    assert.equal(email.j.ok, true);
    const [lead] = await db.sql("select * from public.leads");
    assert.equal(lead.email, "ana@exemplo.com");
    assert.equal(lead.fonte, "quiz");
    assert.equal(lead.perfil, "nao-pega");
    assert.equal(lead.origem, "mo1abc");
    assert.equal(lead.consentimento, true);
    assert.match(String(lead.consentimento_texto), /sair da lista/);
    assert.equal(lead.sequencia, null, "o gancho dos e-mails fica desligado");

    const vai = await ir.GET(request(`/q/sono-quiz/ir?s=${sessao}`), routeParams({ slug: "sono-quiz" }));
    assert.equal(vai.status, 302);
    const destino = new URL(String(vai.headers.get("location")));
    assert.equal(destino.host, "pay.hotmart.com");
    assert.equal(destino.searchParams.get("perfil"), "nao-pega");
    const codigo = String(destino.searchParams.get("src"));
    const [origem] = await db.sql("select * from public.quiz_origens where chave = $1", [codigo]);
    assert.equal(origem.perfil, "nao-pega");
    assert.equal(origem.origem_post, "mo1abc");

    // a venda que volta com o código conta como compra do perfil (a de teste e a reembolsada não)
    await db.sql("insert into public.vendas (plataforma, raw_id, valor, moeda, origem) values ('hotmart', 'v1', 27, 'BRL', $1)", [codigo]);
    await db.sql("insert into public.vendas (plataforma, raw_id, valor, moeda, origem, teste) values ('hotmart', 'v2', 27, 'BRL', $1, true)", [codigo]);
    await db.sql("insert into public.vendas (plataforma, raw_id, valor, moeda, origem, status) values ('hotmart', 'v3', 27, 'BRL', $1, 'reembolsada')", [codigo]);
    // quem começou e parou
    await ev("sono-quiz", { acao: "inicio" });
    const nums = await quizRota.GET(request("/api/molde/quiz?molde=proj-1", { headers: MOLDE }));
    const [q] = ((await nums.json()) as { data: Array<{ slug: string; numeros: { inicios: number; fins: number; emails: number; checkouts: number; compras: number; porPerfil: Record<string, { compras: number; emails: number }> } }> }).data;
    assert.equal(q.slug, "sono-quiz");
    assert.deepEqual({ ...q.numeros, porPerfil: undefined }, { inicios: 2, fins: 1, emails: 1, checkouts: 1, compras: 1, porPerfil: undefined });
    assert.equal(q.numeros.porPerfil["nao-pega"].compras, 1);
    assert.equal(q.numeros.porPerfil["nao-pega"].emails, 1);
  });

  test("a pergunta do quiz na DM: o post cria os botões; o toque marca o perfil e manda o link do quiz com o perfil", async () => {
    await publicarQuiz();
    const MEDIA = "media-reel-q";
    const postId = await insertPost(db, conta, {
      status: "published", published_media_id: MEDIA, published_at: new Date(Date.now() - 60_000), source: "molde", external_ref: "proj-1:reel-q",
      keyword: "SONO", dm_text: "Valeu!", link_url: "", first_comment: "",
      automation_options: JSON.stringify({ quizDm: { slug: "sono-quiz", texto: "O que mais te tira o sono?", origem: "mo9zz", botoes: [{ rotulo: "Não pego no sono", perfilId: "nao-pega" }, { rotulo: "Acordo de noite", perfilId: "acorda" }] } }),
    });
    const [post] = await db.sql("select * from public.content_posts where id = $1", [postId]);
    const feito = await scheduler.afterPublish(post as never, await repos.getConfig(conta), MEDIA);
    assert.equal(feito.automation, true);
    const [auto] = await db.sql("select welcome_dm, quick_replies from public.automations");
    assert.equal(auto.welcome_dm, "O que mais te tira o sono?");
    assert.equal((auto.quick_replies as Array<{ payload: string }>)[1].payload, "quiz:sono-quiz:acorda:mo9zz");

    const corpo = JSON.stringify({ object: "instagram", entry: [{ id: "1001", time: Date.now(), messaging: [{ sender: { id: "u9", username: "u_9" }, recipient: { id: "1001" }, timestamp: Date.now(), message: { mid: "m-q-1", text: "Acordo de noite", quick_reply: { payload: "quiz:sono-quiz:acorda:mo9zz" } } }] }] });
    const assinatura = `sha256=${createHmac("sha256", process.env.INSTAGRAM_APP_SECRET as string).update(corpo).digest("hex")}`;
    const r = await comAfter(() => webhook.POST(new NextRequest(new URL("/api/webhook", BASE_URL), { method: "POST", body: corpo, headers: { "x-hub-signature-256": assinatura, "content-type": "application/json" } })));
    assert.equal(r.status, 200);
    const [contato] = await db.sql("select tags from public.contacts where instagram_user_id = 'u9'");
    assert.ok((contato.tags as string[]).includes("perfil:acorda"));
    const fila = await db.sql<{ payload: { type: string; url: string; buttonLabel: string } }>("select payload from public.queue where send_type = 'dm'");
    assert.equal(fila.length, 1);
    const url = new URL(fila[0].payload.url);
    assert.equal(url.pathname, "/q/sono-quiz");
    assert.equal(url.searchParams.get("perfil"), "acorda");
    assert.equal(url.searchParams.get("de"), "dm");
    assert.equal(url.searchParams.get("o"), "mo9zz");
    assert.equal(fila[0].payload.buttonLabel, "Fazer o quiz");
  });

  test("a página de entrega: arquivos privados no R2, publicar só com os arquivos, download só depois do e-mail, CSV e sair da lista", async () => {
    const pedir = await entregas.POST(request("/api/molde/entregas", { headers: MOLDE, json: {
      molde: "proj-1", accountId: conta,
      entrega: { titulo: "Guia do Sono", subtitulo: "7 noites", itens: ["Checklist", "Diário"], marca: { cores: { fundo: "#FFFFFF" } }, proximo: { titulo: "Planner do Sono", texto: "O próximo passo", link: `${BASE_URL}/l/abc1234?de=entrega` } },
      arquivos: [{ tipo: "pdf", nome: "Guia do Sono.pdf", contentType: "application/pdf", size: 5 }, { tipo: "capa", nome: "capa.png", contentType: "image/png", size: 3 }],
    } }));
    const pj = (await pedir.json()) as { data: { id: string; slug: string; url: string; ativo: boolean; envios: Array<{ tipo: string; uploadUrl: string; headers: Record<string, string> }> } };
    assert.equal(pj.data.slug, "guia-do-sono");
    assert.equal(pj.data.ativo, false);
    assert.equal(pj.data.envios.length, 2);
    for (const e of pj.data.envios) assert.match(new URL(e.uploadUrl).pathname, /^\/baldefalso\/uaiflow\/entregas\//);
    const tipoErrado = await entregas.POST(request("/api/molde/entregas", { headers: MOLDE, json: { molde: "proj-1", entrega: { titulo: "x" }, arquivos: [{ tipo: "pdf", contentType: "text/html", size: 3 }] } }));
    assert.equal(tipoErrado.status, 400);

    // ainda sem os arquivos: publicar recusa (409); a página ainda não abre
    const cedo = await publicar.POST(request(`/api/molde/entregas/${pj.data.id}/publicar`, { headers: MOLDE, json: { molde: "proj-1" } }), routeParams({ id: pj.data.id }));
    assert.equal(cedo.status, 409);
    // o robô do Mac manda cada arquivo (PUT no link)
    await fetch(pj.data.envios[0].uploadUrl, { method: "PUT", headers: pj.data.envios[0].headers, body: "%PDF-" });
    await fetch(pj.data.envios[1].uploadUrl, { method: "PUT", headers: pj.data.envios[1].headers, body: "png" });
    const pub = await publicar.POST(request(`/api/molde/entregas/${pj.data.id}/publicar`, { headers: MOLDE, json: { molde: "proj-1" } }), routeParams({ id: pj.data.id }));
    const pubj = (await pub.json()) as { data: { ativo: boolean; temPdf: boolean; temCapa: boolean } };
    assert.equal(pub.status, 200);
    assert.deepEqual({ ...pubj.data }, { ...pubj.data, ativo: true, temPdf: true, temCapa: true });

    // sem o e-mail, o download volta para o formulário
    const semEmail = await baixar.GET(request("/e/guia-do-sono/baixar?tipo=pdf"), routeParams({ slug: "guia-do-sono" }));
    assert.match(String(semEmail.headers.get("location")), /\?erro=acesso/);
    // o e-mail (sem marcar a caixa de ofertas): entra na lista sem consentimento e libera o download
    const form = await emailEntrega.POST(request("/e/guia-do-sono/email", { form: { email: "bia@exemplo.com", nome: "Bia", o: "mo5x", de: "bio" } }), routeParams({ slug: "guia-do-sono" }));
    assert.equal(form.status, 303);
    const cookie = String(form.headers.get("set-cookie"));
    const [nome, valor] = cookie.split(";")[0].split("=");
    assert.equal(nome, "uf_e_guia_do_sono");
    const [lead] = await db.sql("select * from public.leads where email = 'bia@exemplo.com'");
    assert.equal(lead.consentimento, false);
    assert.equal(lead.fonte, "entrega");
    assert.equal(lead.origem, "mo5x");
    const baixou = await baixar.GET(request("/e/guia-do-sono/baixar?tipo=pdf", { cookies: { [nome]: valor } }), routeParams({ slug: "guia-do-sono" }));
    assert.equal(baixou.status, 302);
    const link = new URL(String(baixou.headers.get("location")));
    assert.match(link.host, /r2\.cloudflarestorage\.com$/);
    assert.match(String(link.searchParams.get("response-content-disposition")), /attachment; filename="Guia-do-Sono\.pdf"/);
    assert.ok(link.searchParams.get("X-Amz-Signature"), "link assinado (o arquivo é privado)");

    const numeros = await entregas.GET(request("/api/molde/entregas?molde=proj-1", { headers: MOLDE }));
    const [e] = ((await numeros.json()) as { data: Array<{ numeros: Record<string, number> }> }).data;
    assert.equal(e.numeros.emails, 1);
    assert.equal(e.numeros.pdf, 1);

    // a Lista própria em CSV (com BOM) e o sair da lista
    const csv = await leads.GET(request("/api/molde/leads?molde=proj-1", { headers: MOLDE }));
    const cj = (await csv.json()) as { data: { total: number; naLista: number; csv: string } };
    assert.equal(cj.data.total, 1);
    assert.equal(cj.data.naLista, 0, "sem a caixa marcada, não está na lista de e-mails de oferta");
    assert.match(cj.data.csv, /^﻿email,nome,veio_de/);
    assert.match(cj.data.csv, /bia@exemplo\.com,Bia,entrega,mo5x,bio/);
    const saiu = await sair.POST(request(`/lista/sair/${lead.chave}/confirmar`, { method: "POST" }), routeParams({ codigo: String(lead.chave) }));
    assert.equal(saiu.status, 303);
    const [depois] = await db.sql("select descadastrado_em from public.leads where email = 'bia@exemplo.com'");
    assert.ok(depois.descadastrado_em);
  });

  test("os formulários de e-mail: limite por IP e por e-mail, a isca contra robôs e a confirmação dupla opcional", async () => {
    await publicarQuiz();
    const limite = await import("@/lib/funil/limite");
    const confirmar = await import("@/app/lista/confirmar/[codigo]/ok/route");
    const obrigado = await import("@/app/p/[slug]/obrigado/email/route");
    const ip = (n: number) => ({ "x-forwarded-for": `203.0.113.${n}` });
    const nova = async (h: Record<string, string>) => {
      const r = await evento.POST(request("/q/sono-quiz/evento", { json: { acao: "inicio" }, headers: h }), routeParams({ slug: "sono-quiz" }));
      return String(((await r.json()) as { sessao: string }).sessao);
    };
    const enviar = async (sessao: string, email: string, h: Record<string, string>, extra: Record<string, unknown> = {}) =>
      evento.POST(request("/q/sono-quiz/evento", { json: { acao: "email", sessao, email, ...extra }, headers: h }), routeParams({ slug: "sono-quiz" }));

    // a isca: o campo escondido preenchido finge que deu certo e não grava nada
    const isca = await enviar(await nova(ip(1)), "robo@exemplo.com", ip(1), { site: "http://spam" });
    assert.equal(isca.status, 200);
    assert.equal((await db.sql("select count(*)::int as n from public.leads"))[0].n, 0);

    // por e-mail: o mesmo e-mail, de IPs diferentes, passa LIMITE_EMAIL vezes; a seguinte recebe 429 e não grava
    for (let i = 0; i < limite.LIMITE_EMAIL; i += 1) assert.equal((await enviar(await nova(ip(10 + i)), "alvo@exemplo.com", ip(10 + i))).status, 200);
    const demais = await enviar(await nova(ip(30)), "alvo@exemplo.com", ip(30));
    assert.equal(demais.status, 429);
    assert.match(((await demais.json()) as { error: string }).error, /Muitas tentativas/);

    // por IP: o mesmo IP com e-mails diferentes passa LIMITE_IP vezes
    const s = await nova(ip(50));
    for (let i = 0; i < limite.LIMITE_IP; i += 1) assert.equal((await enviar(s, `p${i}@exemplo.com`, ip(50))).status, 200);
    assert.equal((await enviar(s, "mais@exemplo.com", ip(50))).status, 429);

    // a entrega e a página de obrigado da escada (0011) usam o mesmo limite: o e-mail «alvo» já passou do limite
    await db.sql(`insert into public.entregas (molde, slug, titulo, pacote, pdf_key, ativo) values ('proj-1', 'guia-x', 'Guia', '{"idioma":"pt-BR"}', 'uaiflow/entregas/a/b.pdf', true)`);
    const ent = await emailEntrega.POST(request("/e/guia-x/email", { form: { email: "alvo@exemplo.com" }, headers: ip(60) }), routeParams({ slug: "guia-x" }));
    assert.match(String(ent.headers.get("location")), /erro=limite/);
    await db.sql(`insert into public.produtos (slug, nome, preco, moeda) values ('guia-p', 'Guia', 10, 'BRL')`);
    const ob = await obrigado.POST(request("/p/guia-p/obrigado/email", { form: { email: "alvo@exemplo.com" }, headers: ip(61) }), routeParams({ slug: "guia-p" }));
    assert.match(String(ob.headers.get("location")), /erro=limite/);
    const obIsca = await obrigado.POST(request("/p/guia-p/obrigado/email", { form: { email: "outro@exemplo.com", site: "x" }, headers: ip(62) }), routeParams({ slug: "guia-p" }));
    assert.match(String(obIsca.headers.get("location")), /ok=1/);
    assert.equal((await db.sql("select count(*)::int as n from public.compradores"))[0].n, 0);

    // confirmação dupla (ligada + e-mail configurado): 1 e-mail com o link; só conta na lista depois do toque
    const enviados: string[] = [];
    const fetchAntes = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).startsWith("https://api.resend.com/")) {
        enviados.push(String(init?.body));
        return new Response(JSON.stringify({ id: "e1" }), { status: 200 });
      }
      return fetchAntes(url, init);
    }) as typeof fetch;
    Object.assign(process.env, { FUNIL_CONFIRMACAO_DUPLA: "1", RESEND_API_KEY: "re_falsa", EMAIL_REMETENTE: "Lua <oi@lua.teste>" });
    try {
      const r = await enviar(await nova(ip(70)), "dupla@exemplo.com", ip(70), { consentimento: true });
      assert.equal(((await r.json()) as { confirmar: boolean }).confirmar, true);
      assert.equal(enviados.length, 1);
      const [lead] = await db.sql("select chave, confirmado_em from public.leads where email = 'dupla@exemplo.com'");
      assert.ok(enviados[0].includes(`/lista/confirmar/${lead.chave}`));
      assert.equal(lead.confirmado_em, null);
      const antes = (await (await leads.GET(request("/api/molde/leads?molde=proj-1", { headers: MOLDE }))).json()) as { data: { naLista: number; confirmacaoDupla: boolean } };
      assert.equal(antes.data.confirmacaoDupla, true);
      assert.equal(antes.data.naLista, 0, "marcou a caixa mas ainda não confirmou");
      const ok = await confirmar.POST(request(`/lista/confirmar/${lead.chave}/ok`, { method: "POST" }), routeParams({ codigo: String(lead.chave) }));
      assert.equal(ok.status, 303);
      const depois = (await (await leads.GET(request("/api/molde/leads?molde=proj-1", { headers: MOLDE }))).json()) as { data: { naLista: number } };
      assert.equal(depois.data.naLista, 1);
    } finally {
      globalThis.fetch = fetchAntes;
      for (const k of ["FUNIL_CONFIRMACAO_DUPLA", "RESEND_API_KEY", "EMAIL_REMETENTE"]) delete process.env[k];
    }
  });
});
