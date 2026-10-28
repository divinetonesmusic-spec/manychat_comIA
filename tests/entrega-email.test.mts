import "./helpers/env.mjs";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request, routeParams } from "./helpers/http.mjs";

/**
 * K7 (Molde v138) · o material grátis chega a quem pediu: quem deixa o e-mail na página de entrega (/e/<slug>) recebe o
 * material por e-mail (o link /e/<slug>/m/<código> que libera o download de novo), com o link de sair da lista; sem o envio
 * configurado (RESEND_API_KEY + EMAIL_REMETENTE) nada sai, o download na tela continua na hora e as rotas do Molde dizem quais
 * variáveis faltam. Não precisa de atualização do banco.
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const banco: TestDatabase | null = semBanco ? null : await createTestDatabase();
const CHAVES = ["RESEND_API_KEY", "EMAIL_REMETENTE", "EMAIL_ENDERECO_POSTAL", "FUNIL_CONFIRMACAO_DUPLA"];

describe("o e-mail do material (sem banco)", () => {
  test("estadoEmailEntrega: diz quais variáveis faltam (só os nomes)", async () => {
    const { estadoEmailEntrega } = await import("@/lib/funil/entrega-email");
    assert.deepEqual(estadoEmailEntrega({}), { configurado: false, faltam: ["RESEND_API_KEY", "EMAIL_REMETENTE"] });
    assert.deepEqual(estadoEmailEntrega({ RESEND_API_KEY: "re_x", EMAIL_REMETENTE: "  " }), { configurado: false, faltam: ["EMAIL_REMETENTE"] });
    assert.deepEqual(estadoEmailEntrega({ RESEND_API_KEY: "re_x", EMAIL_REMETENTE: "Lua <oi@lua.teste>" }), { configurado: true, faltam: [] });
  });

  test("emailDaEntrega: o link de baixar, o que tem dentro, o próximo passo, sair da lista e nada de HTML da pessoa", async () => {
    const { emailDaEntrega } = await import("@/lib/funil/entrega-email");
    const m = emailDaEntrega({
      titulo: "Guia <do> Sono", subtitulo: "7 noites", itens: ["Checklist", "Diário", ""], idioma: "pt-BR", nome: "Bia Souza",
      baixarUrl: "https://uaiflow.teste/e/guia/m/abc", sairUrl: "https://uaiflow.teste/lista/sair/abc",
      proximo: { titulo: "Planner do Sono", texto: "30 noites", url: "https://uaiflow.teste/e/guia/proximo" }, marca: { nome: "Lua", primaria: "#7A4E2D", textoPrimaria: "#FFFFFF" },
      enderecoPostal: "Caixa Postal 1, São Paulo",
    });
    assert.equal(m.assunto, "Seu material: Guia <do> Sono");
    assert.match(m.texto, /^Oi, Bia!/);
    assert.match(m.texto, /Baixar o material: https:\/\/uaiflow\.teste\/e\/guia\/m\/abc/);
    assert.match(m.texto, /- Checklist\n- Diário\n/);
    assert.match(m.texto, /Planner do Sono \(30 noites\)\nhttps:\/\/uaiflow\.teste\/e\/guia\/proximo/);
    assert.match(m.texto, /Sair|sair/);
    assert.match(m.texto, /lista\/sair\/abc\nCaixa Postal 1, São Paulo$/);
    assert.match(m.html, /Guia &lt;do&gt; Sono/);
    assert.doesNotMatch(m.html, /<do>/);
    assert.match(m.html, /background:#7A4E2D;color:#FFFFFF/);
    assert.match(m.html, /href="https:\/\/uaiflow\.teste\/lista\/sair\/abc"/);
    const en = emailDaEntrega({ titulo: "Sleep Guide", idioma: "en-US", baixarUrl: "https://u/e/s/m/x", sairUrl: "https://u/lista/sair/x", proximo: { titulo: "x", url: "http://inseguro" }, marca: { primaria: "red" } });
    assert.equal(en.assunto, "Your material: Sleep Guide");
    assert.match(en.texto, /^Hi!/);
    assert.doesNotMatch(en.texto, /inseguro/, "o próximo passo só com https");
    assert.match(en.html, /background:#111111/, "cor que não é #rrggbb vira a padrão");
  });

  test("mandarMaterial: sem configuração não chama nada; o erro do serviço não lança", async () => {
    const { mandarMaterial } = await import("@/lib/funil/entrega-email");
    const base = { para: "bia@exemplo.com", titulo: "Guia", baixarUrl: "https://u/e/g/m/x", sairUrl: "https://u/lista/sair/x" };
    assert.equal(await mandarMaterial(base, null), "sem_config");
    const antes = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "domínio não verificado" }), { status: 403 })) as typeof fetch;
    try {
      assert.equal(await mandarMaterial(base, { apiKey: "re_x", remetente: "Lua <oi@lua.teste>", responderPara: null, enderecoPostal: null }), "erro");
    } finally {
      globalThis.fetch = antes;
    }
  });
});

describe("o e-mail do material (com banco)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let entregas: typeof import("@/app/api/molde/entregas/route");
  let publicar: typeof import("@/app/api/molde/entregas/[id]/publicar/route");
  let emailEntrega: typeof import("@/app/e/[slug]/email/route");
  let linkEmail: typeof import("@/app/e/[slug]/m/[codigo]/route");
  let baixar: typeof import("@/app/e/[slug]/baixar/route");

  before(async () => {
    db = banco!;
    entregas = await import("@/app/api/molde/entregas/route");
    publicar = await import("@/app/api/molde/entregas/[id]/publicar/route");
    emailEntrega = await import("@/app/e/[slug]/email/route");
    linkEmail = await import("@/app/e/[slug]/m/[codigo]/route");
    baixar = await import("@/app/e/[slug]/baixar/route");
  });
  after(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    meta.reset();
    for (const k of CHAVES) delete process.env[k];
    for (const t of ["formulario_limites", "leads", "entrega_eventos", "entregas"]) await db.sql(`delete from public.${t}`);
  });

  async function entregaNoAr(molde = "proj-1", titulo = "Guia do Sono") {
    const pedir = await entregas.POST(request("/api/molde/entregas", { headers: MOLDE, json: {
      molde, entrega: { titulo, subtitulo: "7 noites", itens: ["Checklist", "Diário"], idioma: "pt-BR", marca: { nome: "Lua" }, proximo: { titulo: "Planner do Sono", texto: "30 noites", link: "https://pay.hotmart.com/X1" } },
      arquivos: [{ tipo: "pdf", nome: "Guia do Sono.pdf", contentType: "application/pdf", size: 5 }],
    } }));
    const pj = (await pedir.json()) as { data: { id: string; slug: string; envios: Array<{ uploadUrl: string; headers: Record<string, string> }> } };
    await fetch(pj.data.envios[0].uploadUrl, { method: "PUT", headers: pj.data.envios[0].headers, body: "%PDF-" });
    const pub = await publicar.POST(request(`/api/molde/entregas/${pj.data.id}/publicar`, { headers: MOLDE, json: { molde } }), routeParams({ id: pj.data.id }));
    return { ...pj.data, pub: (await pub.json()) as { data: { ativo: boolean; email: { configurado: boolean; faltam: string[] } } } };
  }
  const ip = (n: number) => ({ "x-forwarded-for": `198.51.100.${n}` });

  test("sem o envio configurado: o Molde fica sabendo o que falta, o download continua na hora e nenhum e-mail sai", async () => {
    const e = await entregaNoAr();
    assert.equal(e.pub.data.ativo, true);
    assert.deepEqual(e.pub.data.email, { configurado: false, faltam: ["RESEND_API_KEY", "EMAIL_REMETENTE"] });
    const lista = (await (await entregas.GET(request("/api/molde/entregas?molde=proj-1", { headers: MOLDE }))).json()) as { data: Array<{ email: { configurado: boolean } }> };
    assert.equal(lista.data[0].email.configurado, false);
    const chamadas: string[] = [];
    const antes = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => { if (String(url).includes("resend.com")) chamadas.push(String(url)); return antes(url, init); }) as typeof fetch;
    try {
      const r = await emailEntrega.POST(request(`/e/${e.slug}/email`, { form: { email: "bia@exemplo.com" }, headers: ip(1) }), routeParams({ slug: e.slug }));
      assert.equal(r.status, 303);
      assert.match(String(r.headers.get("location")), new RegExp(`/e/${e.slug}#receber$`), "sem ?enviado=1");
      assert.match(String(r.headers.get("set-cookie")), /uf_e_guia_do_sono=/, "o download liberado na hora");
      assert.equal(chamadas.length, 0);
    } finally {
      globalThis.fetch = antes;
    }
  });

  test("com o envio configurado: o material vai por e-mail; o link do e-mail libera o download de novo; código de outra lista não", async () => {
    const enviados: Array<{ to: string[]; subject: string; text: string; html: string; headers?: Record<string, string> }> = [];
    const antes = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).startsWith("https://api.resend.com/")) {
        enviados.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
      }
      return antes(url, init);
    }) as typeof fetch;
    Object.assign(process.env, { RESEND_API_KEY: "re_falsa", EMAIL_REMETENTE: "Lua <oi@lua.teste>" });
    try {
      const e = await entregaNoAr();
      assert.deepEqual(e.pub.data.email, { configurado: true, faltam: [] });
      const r = await emailEntrega.POST(request(`/e/${e.slug}/email`, { form: { email: "Bia@Exemplo.com", nome: "Bia" }, headers: ip(2) }), routeParams({ slug: e.slug }));
      assert.match(String(r.headers.get("location")), /\?enviado=1#receber$/);
      assert.equal(enviados.length, 1);
      const m = enviados[0];
      assert.deepEqual(m.to, ["bia@exemplo.com"]);
      assert.equal(m.subject, "Seu material: Guia do Sono");
      const [lead] = await db.sql("select chave from public.leads where email = 'bia@exemplo.com'");
      assert.ok(m.text.includes(`https://uaiflow.teste/e/${e.slug}/m/${lead.chave}`), m.text);
      assert.ok(m.text.includes(`https://uaiflow.teste/e/${e.slug}/proximo`), "o próximo degrau pelo link que conta o toque");
      assert.equal(m.headers?.["List-Unsubscribe"], `<https://uaiflow.teste/lista/sair/${lead.chave}>`);
      assert.doesNotMatch(JSON.stringify(m), /hotmart/, "o checkout não vai cru no e-mail");

      // o link do e-mail: libera o download (o mesmo cookie) e leva à página
      const abrir = await linkEmail.GET(request(`/e/${e.slug}/m/${lead.chave}`), routeParams({ slug: e.slug, codigo: String(lead.chave) }));
      assert.equal(abrir.status, 302);
      assert.equal(String(abrir.headers.get("location")), `https://uaiflow.teste/e/${e.slug}#receber`);
      const cookie = String(abrir.headers.get("set-cookie"));
      const [nome, valor] = cookie.split(";")[0].split("=");
      assert.equal(nome, "uf_e_guia_do_sono");
      assert.match(cookie, new RegExp(`Path=/e/${e.slug}`, "i"));
      const baixou = await baixar.GET(request(`/e/${e.slug}/baixar?tipo=pdf`, { cookies: { [nome]: valor } }), routeParams({ slug: e.slug }));
      assert.match(new URL(String(baixou.headers.get("location"))).host, /r2\.cloudflarestorage\.com$/);

      // código inventado ou de outra lista: o formulário, sem cookie
      const falso = await linkEmail.GET(request(`/e/${e.slug}/m/naoexiste12345`), routeParams({ slug: e.slug, codigo: "naoexiste12345" }));
      assert.match(String(falso.headers.get("location")), /\?erro=acesso#receber$/);
      assert.equal(falso.headers.get("set-cookie"), null);
      const outra = await entregaNoAr("proj-2", "Outro Guia");
      await emailEntrega.POST(request(`/e/${outra.slug}/email`, { form: { email: "caio@exemplo.com" }, headers: ip(3) }), routeParams({ slug: outra.slug }));
      const [caio] = await db.sql("select chave from public.leads where email = 'caio@exemplo.com'");
      const cruzado = await linkEmail.GET(request(`/e/${e.slug}/m/${caio.chave}`), routeParams({ slug: e.slug, codigo: String(caio.chave) }));
      assert.match(String(cruzado.headers.get("location")), /\?erro=acesso/);

      // o serviço de e-mail fora do ar: o download na tela continua (sem ?enviado=1)
      globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => (String(url).startsWith("https://api.resend.com/") ? new Response("{}", { status: 500 }) : antes(url, init))) as typeof fetch;
      const caiu = await emailEntrega.POST(request(`/e/${e.slug}/email`, { form: { email: "dani@exemplo.com" }, headers: ip(4) }), routeParams({ slug: e.slug }));
      assert.match(String(caiu.headers.get("location")), new RegExp(`/e/${e.slug}#receber$`));
      assert.match(String(caiu.headers.get("set-cookie")), /uf_e_guia_do_sono=/);
    } finally {
      globalThis.fetch = antes;
      for (const k of CHAVES) delete process.env[k];
    }
  });

  test("o limite dos formulários segura o envio: o mesmo e-mail recebe no máximo LIMITE_EMAIL por hora", async () => {
    const { LIMITE_EMAIL } = await import("@/lib/funil/limite");
    let n = 0;
    const antes = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => { if (String(url).startsWith("https://api.resend.com/")) { n += 1; return new Response(JSON.stringify({ id: `m${n}` }), { status: 200 }); } return antes(url, init); }) as typeof fetch;
    Object.assign(process.env, { RESEND_API_KEY: "re_falsa", EMAIL_REMETENTE: "Lua <oi@lua.teste>" });
    try {
      const e = await entregaNoAr();
      for (let i = 0; i < LIMITE_EMAIL + 2; i += 1) await emailEntrega.POST(request(`/e/${e.slug}/email`, { form: { email: "alvo@exemplo.com" }, headers: ip(20 + i) }), routeParams({ slug: e.slug }));
      assert.equal(n, LIMITE_EMAIL);
    } finally {
      globalThis.fetch = antes;
      for (const k of CHAVES) delete process.env[k];
    }
  });
});
