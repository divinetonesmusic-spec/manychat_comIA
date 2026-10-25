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
 * O desafio de 5 dias no Direct, com e-mail de reserva (Molde v134, 0017): comentou → convite com «Começar» → dia 1 na hora
 * (vídeo, pedido do e-mail, tarefa com o botão) → cada toque marca o dia seguinte para 23 h depois (dentro da janela de 24 h
 * que o toque abre) → quem não tocou em 24 h recebe o dia por e-mail (com consentimento e «sair da lista») → no fim do dia 5,
 * a oferta com o código de compra → os números por desafio e por versão (A/B só com 200 inscritos em cada).
 */
const meta = installFakeMeta();
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };
const MEDIA = "media-reel-desafio";
const VIDEO = (n: number) => `https://midia.teste.invalid/uaiflow/molde-dmvideos/2026-10/dia-${n}.mp4`;
const dias = (v: string) => [1, 2, 3, 4, 5].map((n) => ({
  titulo: `Dia ${n} ${v}`,
  texto: `Texto do dia ${n} (${v})`,
  videoUrl: VIDEO(n),
  tarefa: `Tarefa do dia ${n} (${v})`,
  emailTexto: `E-mail do dia ${n} (${v})`,
}));
const DESAFIO = {
  titulo: "5 noites de sono leve",
  idioma: "pt-BR",
  keyword: "SONO",
  oferta: { url: "https://pay.hotmart.com/X123?src=MODESAFIOORIGEM", rotulo: "Ver o método", texto: "Se quiser ir além, o método completo:" },
  variantes: { A: dias("A") },
};
const banco: TestDatabase | null = semBanco ? null : await createTestDatabase();

describe("desafio de 5 dias (sem banco)", () => {
  test("lerDesafio: 5 dias, limites da Meta, vídeo, oferta e os textos padrão do idioma", async () => {
    const { lerDesafio } = await import("@/lib/desafio/desafio");
    const ok = lerDesafio(DESAFIO);
    assert.ok(ok.ok);
    if (!ok.ok) return;
    assert.equal(ok.pacote.variantes.A.length, 5);
    assert.equal(ok.pacote.variantes.A[0].botao, "Quero o dia 2 amanhã");
    assert.equal(ok.pacote.variantes.A[4].botao, "", "o dia 5 não tem o botão do dia seguinte: tem a oferta");
    assert.equal(ok.pacote.botaoComecar, "Começar o dia 1");
    assert.match(ok.pacote.pedidoEmail, /não perder nenhum dia/);
    assert.equal(ok.pacote.variantes.B, null);
    const erros = (x: unknown) => { const r = lerDesafio(x); return r.ok ? "" : r.erros.join(" "); };
    assert.match(erros({ ...DESAFIO, variantes: { A: dias("A").slice(0, 4) } }), /exatamente 5 dias/);
    assert.match(erros({ ...DESAFIO, oferta: { url: "http://x.teste" } }), /checkout \(https\)/);
    assert.match(erros({ ...DESAFIO, variantes: { A: dias("A").map((d, i) => (i === 2 ? { ...d, videoUrl: "https://x.teste/v.avi" } : d)) } }), /\.mp4 ou \.mov/);
    assert.match(erros({ ...DESAFIO, variantes: { A: dias("A").map((d, i) => (i === 0 ? { ...d, tamanho: 26 * 1024 * 1024 } : d)) } }), /25 MB/);
    assert.match(erros({ ...DESAFIO, variantes: { A: dias("A").map((d, i) => (i === 0 ? { ...d, botao: "Um botão longo demais aqui" } : d)) } }), /20 letras/);
    assert.match(erros({ ...DESAFIO, variantes: { A: dias("A").map((d, i) => (i === 1 ? { ...d, tarefa: "" } : d)) } }), /dia 2 está sem a tarefa/);
    const en = lerDesafio({ ...DESAFIO, idioma: "en-US" });
    assert.ok(en.ok && en.pacote.variantes.A[0].botao === "Send day 2 tomorrow" && en.pacote.botaoComecar === "Start day 1");
  });

  test("payload, e-mail no texto, versão sorteada e checkout com o código", async () => {
    const d = await import("@/lib/desafio/desafio");
    assert.equal(d.payloadDesafio("sono-leve", "prox"), "desafio:sono-leve:prox");
    assert.deepEqual(d.lerPayloadDesafio("desafio:sono-leve:comecar"), { slug: "sono-leve", acao: "comecar" });
    assert.equal(d.lerPayloadDesafio("desafio:sono-leve:outro"), null);
    assert.equal(d.emailNoTexto("claro! é Maria.Souza@Exemplo.com.br."), "maria.souza@exemplo.com.br");
    assert.equal(d.emailNoTexto("não tenho e-mail"), null);
    assert.equal(d.sortearVariante(false, { A: 0, B: 0 }), "A");
    assert.equal(d.sortearVariante(true, { A: 3, B: 2 }), "B");
    assert.equal(d.sortearVariante(true, { A: 3, B: 3 }), "A");
    assert.equal(d.checkoutComCodigo("https://pay.hotmart.com/X?src=MODESAFIOORIGEM", "mo1abc"), "https://pay.hotmart.com/X?src=mo1abc");
    assert.equal(d.checkoutComCodigo("https://loja.teste/checkout", "mo1abc"), "https://loja.teste/checkout?src=mo1abc");
    assert.equal(d.HORAS_PROXIMO_DIA < 24, true, "o dia seguinte sai antes de a janela de 24 h fechar");
  });

  test("compararVariantes: vencedora só com 200 inscritos em cada versão e diferença clara de compras", async () => {
    const { compararVariantes } = await import("@/lib/desafio/desafio");
    const pouco = compararVariantes({ inscritos: 150, dia5: 60, compras: 15 }, { inscritos: 210, dia5: 50, compras: 2 });
    assert.equal(pouco.vencedora, null);
    assert.match(pouco.frase, /200 inscritos.*A tem 150, B tem 210; faltam 50/);
    const empate = compararVariantes({ inscritos: 220, dia5: 80, compras: 10 }, { inscritos: 230, dia5: 70, compras: 9 });
    assert.equal(empate.vencedora, null);
    assert.match(empate.frase, /Empate/);
    const claro = compararVariantes({ inscritos: 250, dia5: 90, compras: 25 }, { inscritos: 240, dia5: 60, compras: 6 });
    assert.equal(claro.vencedora, "A");
    assert.ok((claro.p ?? 1) < 0.05);
    assert.equal(compararVariantes({ inscritos: 10, dia5: 1, compras: 0 }, null).vencedora, null);
  });

  test("emailDoDia: o texto, o vídeo, a oferta no dia 5 e o «sair da lista»", async () => {
    const { lerDesafio, emailDoDia } = await import("@/lib/desafio/desafio");
    const r = lerDesafio(DESAFIO);
    assert.ok(r.ok);
    if (!r.ok) return;
    const e2 = emailDoDia({ pacote: r.pacote, dia: r.pacote.variantes.A[1], n: 2, ofertaUrl: "https://uaiflow.teste/d/x/ir?i=abc", descadastrarUrl: "https://uaiflow.teste/lista/sair/abc" });
    assert.equal(e2.assunto, "Dia 2 do desafio: Dia 2 A");
    assert.match(e2.texto, /Ver o vídeo do dia 2: https:\/\/midia/);
    assert.match(e2.texto, /Sair|sair/);
    assert.doesNotMatch(e2.texto, /Ver o método/, "a oferta só no dia 5");
    const e5 = emailDoDia({ pacote: r.pacote, dia: r.pacote.variantes.A[4], n: 5, ofertaUrl: "https://uaiflow.teste/d/x/ir?i=abc", descadastrarUrl: "https://uaiflow.teste/lista/sair/abc" });
    assert.match(e5.html, /Ver o método/);
    assert.match(e5.html, /lista\/sair\/abc/);
  });

  test("Umami: só com UMAMI_WEBSITE_ID (um id de verdade) e endereço https", async () => {
    const { umamiConfig, UMAMI_SRC_PADRAO } = await import("@/lib/visitas/umami");
    assert.equal(umamiConfig({}), null);
    assert.equal(umamiConfig({ UMAMI_WEBSITE_ID: "abc" }), null);
    const id = "94db1cb1-74f4-4a40-ad6c-962362670409";
    assert.deepEqual(umamiConfig({ UMAMI_WEBSITE_ID: id }), { src: UMAMI_SRC_PADRAO, websiteId: id });
    assert.equal(umamiConfig({ UMAMI_WEBSITE_ID: id, UMAMI_SRC: "http://x.teste/s.js" }), null);
    assert.equal(umamiConfig({ UMAMI_WEBSITE_ID: id, UMAMI_SRC: "https://umami.meusite.teste/script.js" })?.src, "https://umami.meusite.teste/script.js");
  });
});

describe("desafio de 5 dias (com banco)", { skip: semBanco }, () => {
  let db: TestDatabase;
  let webhook: typeof import("@/app/api/webhook/route");
  let drain: typeof import("@/lib/queue/drain");
  let repos: typeof import("@/lib/db/repositories");
  let rota: typeof import("@/app/api/molde/desafio/route");
  let ir: typeof import("@/app/d/[slug]/ir/route");
  let scheduler: typeof import("@/lib/content/scheduler");
  let lib: typeof import("@/lib/db/desafios");
  let conta: string;
  let desafioId: string;
  let slug: string;
  let n = 0;

  before(async () => {
    db = banco!;
    webhook = await import("@/app/api/webhook/route");
    drain = await import("@/lib/queue/drain");
    repos = await import("@/lib/db/repositories");
    rota = await import("@/app/api/molde/desafio/route");
    ir = await import("@/app/d/[slug]/ir/route");
    scheduler = await import("@/lib/content/scheduler");
    lib = await import("@/lib/db/desafios");
  });

  async function publicarPost(desafio: Record<string, unknown>) {
    const r = await rota.POST(request("/api/molde/desafio", { headers: MOLDE, json: { molde: "proj-1", accountId: conta, desafio } }));
    assert.equal(r.status, 201, await r.clone().text());
    const j = ((await r.json()) as { data: { id: string; slug: string; emailLigado: boolean } }).data;
    desafioId = j.id;
    slug = j.slug;
    const postId = await insertPost(db, conta, {
      status: "published", published_media_id: MEDIA, published_at: new Date(Date.now() - 60_000), source: "molde", external_ref: "proj-1:reel-desafio", title: "Durma melhor",
      keyword: "SONO", dm_text: "Oi!", link_url: "", first_comment: "",
      automation_options: JSON.stringify({ desafio: { id: desafioId } }),
    });
    const [post] = await db.sql("select * from public.content_posts where id = $1", [postId]);
    const feito = await scheduler.afterPublish(post as never, await repos.getConfig(conta), MEDIA);
    assert.equal(feito.automation, true);
    return j;
  }

  beforeEach(async () => {
    meta.reset();
    n = 0;
    process.env.RESEND_API_KEY = "re_falsa";
    process.env.EMAIL_REMETENTE = "Desafio <desafio@uaiflow.teste>";
    for (const tabela of ["vendas", "desafio_origens", "desafio_envios", "desafio_inscricoes", "leads", "desafios", "queue", "events", "contacts", "content_posts", "automations", "profile_settings", "instagram_accounts"]) await db.sql(`delete from public.${tabela}`);
    conta = await seedAccount(db, { username: "conta_a", userId: "1001", token: "IGAA-TESTE-A" });
  });

  after(async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_REMETENTE;
    meta.restore();
    await db?.close();
  });

  async function webhookPost(entry: Record<string, unknown>) {
    const corpo = JSON.stringify({ object: "instagram", entry: [{ id: "1001", time: Date.now(), ...entry }] });
    const assinatura = `sha256=${createHmac("sha256", process.env.INSTAGRAM_APP_SECRET as string).update(corpo).digest("hex")}`;
    const pedido = new NextRequest(new URL("/api/webhook", BASE_URL), { method: "POST", body: corpo, headers: { "x-hub-signature-256": assinatura, "content-type": "application/json" } });
    assert.equal((await comAfter(() => webhook.POST(pedido))).status, 200);
  }
  const comentar = (de: string) => webhookPost({ changes: [{ field: "comments", value: { id: `c-${de}-${++n}`, text: "SONO", from: { id: de, username: `u_${de}` }, media: { id: MEDIA } } }] });
  const tocar = (de: string, payload: string, titulo = "x") => webhookPost({ messaging: [{ sender: { id: de, username: `u_${de}` }, recipient: { id: "1001" }, timestamp: Date.now(), message: { mid: `m-${de}-${++n}`, text: titulo, quick_reply: { payload } } }] });
  const escrever = (de: string, texto: string) => webhookPost({ messaging: [{ sender: { id: de, username: `u_${de}` }, recipient: { id: "1001" }, timestamp: Date.now(), message: { mid: `m-${de}-${++n}`, text: texto } }] });
  const fila = (de: string) => db.sql<{ id: string; send_type: string; status: string; available_at: Date; payload: Record<string, unknown> }>(
    "select q.id, q.send_type, q.status, q.available_at, q.payload from public.queue q join public.contacts c on c.id = q.contact_id where c.instagram_user_id = $1 order by q.available_at, q.created_at",
    [de],
  );
  /** A fila manda o que já está marcado para os próximos minutos (o dia sai em mensagens de 20 em 20 s). */
  const mandarAgora = async () => {
    await db.sql("update public.queue set available_at = now() - interval '1 second' where status = 'pending' and available_at < now() + interval '5 minutes'");
    await drain.drainQueue(40, 20_000);
  };
  const inscricao = (de: string) => db.sql<{ dia: number; canal: string; dia_em: Date; variante: string; chave: string; lead_id: string | null }>(
    "select i.* from public.desafio_inscricoes i join public.contacts c on c.id = i.contact_id where c.instagram_user_id = $1",
    [de],
  ).then((r) => r[0]);

  test("POST/GET /api/molde/desafio: exige o token, confere o pacote, guarda e lê os números", async () => {
    assert.equal((await rota.GET(request("/api/molde/desafio?molde=proj-1"))).status, 401);
    const ruim = await rota.POST(request("/api/molde/desafio", { headers: MOLDE, json: { molde: "proj-1", desafio: { ...DESAFIO, variantes: { A: dias("A").slice(0, 3) } } } }));
    assert.equal(ruim.status, 400);
    const j = await publicarPost(DESAFIO);
    assert.equal(j.emailLigado, true);
    assert.equal(j.slug, "5-noites-de-sono-leve");
    const gasto = await rota.POST(request("/api/molde/desafio", { headers: MOLDE, json: { molde: "proj-1", id: desafioId, gastoAnuncio: 120.5, moeda: "BRL" } }));
    assert.equal(gasto.status, 200);
    const lista = ((await (await rota.GET(request("/api/molde/desafio?molde=proj-1", { headers: MOLDE }))).json()) as { data: { desafios: Array<{ gastoAnuncio: number; numeros: { inscritos: number } }>; emailLigado: boolean } }).data;
    assert.equal(lista.desafios[0].gastoAnuncio, 120.5);
    assert.equal(lista.desafios[0].numeros.inscritos, 0);
    delete process.env.RESEND_API_KEY;
    const sem = ((await (await rota.GET(request("/api/molde/desafio?molde=proj-1", { headers: MOLDE }))).json()) as { data: { emailLigado: boolean; aviso: string } }).data;
    assert.equal(sem.emailLigado, false);
    assert.match(sem.aviso, /e-mail de reserva está desligado/);
  });

  test("comentou → convite com «Começar»; o toque manda o dia 1 na hora: vídeo, pedido do e-mail e a tarefa com o botão por último", async () => {
    await publicarPost(DESAFIO);
    await comentar("p1");
    const [convite] = (await fila("p1")).filter((j) => j.send_type === "private_reply");
    assert.match(String(convite.payload.text), /desafio de 5 dias/);
    assert.deepEqual(convite.payload.quickReplies, [{ title: "Começar o dia 1", payload: `desafio:${slug}:comecar` }]);
    assert.equal((await inscricao("p1")).dia, 0, "comentou: ainda não começou");

    await tocar("p1", `desafio:${slug}:comecar`, "Começar o dia 1");
    const dms = (await fila("p1")).filter((j) => j.send_type === "dm");
    assert.deepEqual(dms.map((j) => j.payload.parte), ["video", "pedido_email", "tarefa"]);
    assert.equal(dms[0].payload.type, "media");
    assert.equal(dms[0].payload.mediaUrl, VIDEO(1));
    assert.equal(dms[0].payload.text, "Texto do dia 1 (A)");
    assert.deepEqual(dms[2].payload.quickReplies, [{ title: "Quero o dia 2 amanhã", payload: `desafio:${slug}:prox` }]);
    assert.ok(Date.now() - new Date(dms[0].available_at).getTime() < 60_000, "o dia 1 sai na hora");
    const ins = await inscricao("p1");
    assert.deepEqual([ins.dia, ins.canal], [1, "dm"]);

    // a fila manda: o dia 1 conta como entregue quando a última mensagem sai
    await mandarAgora();
    const [envio] = await db.sql<{ dia: number; enviado_em: Date | null }>("select dia, enviado_em from public.desafio_envios");
    assert.equal(envio.dia, 1);
    assert.ok(envio.enviado_em, "o dia 1 saiu");
  });

  test("o e-mail no Direct vai para a Lista própria com o consentimento e volta o botão do dia; o toque marca o dia 2 para 23 h depois", async () => {
    await publicarPost(DESAFIO);
    await comentar("p2");
    await tocar("p2", `desafio:${slug}:comecar`);
    await escrever("p2", "maria@exemplo.com");
    const [lead] = await db.sql<{ email: string; fonte: string; consentimento: boolean; consentimento_texto: string }>("select email, fonte, consentimento, consentimento_texto from public.leads");
    assert.deepEqual([lead.email, lead.fonte, lead.consentimento], ["maria@exemplo.com", "desafio", true]);
    assert.match(lead.consentimento_texto, /não perder nenhum dia/);
    const anotado = (await fila("p2")).find((j) => j.payload.parte === "email_anotado");
    assert.deepEqual(anotado?.payload.quickReplies, [{ title: "Quero o dia 2 amanhã", payload: `desafio:${slug}:prox` }], "a resposta dela apagou o botão: ele volta");
    assert.equal((await db.sql("select * from public.dm_pending")).length, 0, "o e-mail não vira DM sem resposta");

    const antes = Date.now();
    await tocar("p2", `desafio:${slug}:prox`, "Quero o dia 2 amanhã");
    const depois = (await fila("p2")).filter((j) => j.payload.dia === 2);
    assert.deepEqual(depois.map((j) => j.payload.parte), ["video", "tarefa"]);
    const horas = (new Date(depois[0].available_at).getTime() - antes) / 3_600_000;
    assert.ok(horas > 22.9 && horas < 23.1, `o dia 2 sai 23 h depois do toque (${horas})`);
    assert.ok((await fila("p2")).some((j) => j.payload.parte === "combinado" && /dia 2 chega amanhã/.test(String(j.payload.text))));
    await tocar("p2", `desafio:${slug}:prox`);
    assert.equal((await fila("p2")).filter((j) => j.payload.dia === 2).length, 2, "toque repetido não marca outro dia 2");
    assert.ok((await fila("p2")).some((j) => /Já está combinado/.test(String(j.payload.text))));
  });

  test("sem tocar em 24 h: o dia seguinte por e-mail (com o sair da lista), 1 por dia até o 5 com a oferta; quem saiu da lista não recebe", async () => {
    await publicarPost(DESAFIO);
    await comentar("p3");
    await tocar("p3", `desafio:${slug}:comecar`);
    await escrever("p3", "ana@exemplo.com");
    await mandarAgora();
    const enviados: Array<{ para: string; assunto: string; texto: string; descadastrarUrl?: string | null }> = [];
    const enviar = async (_c: unknown, m: { para: string; assunto: string; texto: string; descadastrarUrl?: string | null }) => { enviados.push(m); return "id"; };
    const relogio = (horas: number) => lib.runDesafioClock({ deadline: Date.now() + 20_000, now: new Date(Date.now() + horas * 3_600_000), enviar });

    assert.deepEqual(await relogio(23), { enviados: 0, erros: 0 }, "antes de 24 h, nada");
    assert.equal((await relogio(25)).enviados, 1);
    assert.equal(enviados[0].para, "ana@exemplo.com");
    assert.equal(enviados[0].assunto, "Dia 2 do desafio: Dia 2 A");
    assert.match(String(enviados[0].descadastrarUrl), /\/lista\/sair\//);
    assert.deepEqual([(await inscricao("p3")).dia, (await inscricao("p3")).canal], [2, "email"]);
    assert.equal((await relogio(26)).enviados, 0, "por e-mail, 1 dia a cada 24 h");
    for (const h of [50, 75, 100]) assert.equal((await relogio(h)).enviados, 1);
    assert.match(enviados[3].texto, /Ver o método: https:\/\/uaiflow\.teste\/d\//, "o dia 5 leva a oferta");
    assert.equal((await relogio(130)).enviados, 0, "acabou no dia 5");

    // quem saiu da lista não recebe mais
    await comentar("p4");
    await tocar("p4", `desafio:${slug}:comecar`);
    await escrever("p4", "rui@exemplo.com");
    await mandarAgora();
    await db.sql("update public.leads set descadastrado_em = now(), consentimento = false where email = 'rui@exemplo.com'");
    enviados.length = 0;
    await relogio(25);
    assert.equal(enviados.filter((e) => e.para === "rui@exemplo.com").length, 0);

    // sem o envio de e-mail configurado: nada sai
    delete process.env.RESEND_API_KEY;
    assert.equal((await relogio(200)).motivo, "sem_email");
  });

  test("dia 5 → oferta com o código do desafio; a venda casa pelo código; números, funil dia a dia e custo por venda", async () => {
    await publicarPost(DESAFIO);
    await comentar("p5");
    await tocar("p5", `desafio:${slug}:comecar`);
    await mandarAgora();
    for (let d = 2; d <= 5; d += 1) {
      await db.sql("update public.desafio_inscricoes set dia_em = now() - interval '1 minute'");
      await tocar("p5", `desafio:${slug}:prox`);
      await db.sql("update public.queue set available_at = now() - interval '1 second' where status = 'pending'");
      await drain.drainQueue(40, 20_000);
    }
    const oferta = (await fila("p5")).find((j) => j.payload.parte === "oferta");
    assert.equal(oferta?.payload.type, "link");
    const ins = await inscricao("p5");
    assert.equal(oferta?.payload.url, `${BASE_URL}/d/${slug}/ir?i=${ins.chave}&de=dm`);
    const ida = await ir.GET(request(`/d/${slug}/ir?i=${ins.chave}&de=dm`), routeParams({ slug }));
    assert.equal(ida.status, 302);
    const destino = new URL(String(ida.headers.get("location")));
    const codigo = String(destino.searchParams.get("src"));
    assert.match(codigo, /^mo[a-z0-9]{1,7}$/);
    await db.sql(`insert into public.vendas (plataforma, raw_id, valor, moeda, status, origem, teste) values ('hotmart', 'v1', 97, 'BRL', 'paga', $1, false), ('hotmart', 'v2', 97, 'BRL', 'paga', $1, true)`, [codigo]);
    await rota.POST(request("/api/molde/desafio", { headers: MOLDE, json: { molde: "proj-1", id: desafioId, gastoAnuncio: 150 } }));
    const [d] = ((await (await rota.GET(request("/api/molde/desafio?molde=proj-1", { headers: MOLDE }))).json()) as { data: { desafios: Array<{ numeros: { comentaram: number; inscritos: number; porDia: number[]; cliques: number; compras: number; receita: number }; custoPorVenda: number } > } }).data.desafios;
    assert.deepEqual(d.numeros.porDia, [1, 1, 1, 1, 1]);
    assert.deepEqual([d.numeros.comentaram, d.numeros.inscritos, d.numeros.cliques, d.numeros.compras, d.numeros.receita], [1, 1, 1, 1, 97]);
    assert.equal(d.custoPorVenda, 150);
    assert.ok((await db.sql("select concluido_em from public.desafio_inscricoes"))[0].concluido_em);
  });

  test("versões A e B: quem entra se reveza; os números saem por versão; sem vencedora antes de 200 em cada", async () => {
    await publicarPost({ ...DESAFIO, variantes: { A: dias("A"), B: dias("B") } });
    for (const p of ["a1", "a2", "a3", "a4"]) {
      await comentar(p);
      await tocar(p, `desafio:${slug}:comecar`);
    }
    const vs = await db.sql<{ variante: string }>("select variante from public.desafio_inscricoes order by comentou_em");
    assert.deepEqual(vs.map((v) => v.variante), ["A", "B", "A", "B"]);
    const textoB = (await fila("a2")).find((j) => j.payload.parte === "video");
    assert.equal(textoB?.payload.text, "Texto do dia 1 (B)");
    const [d] = ((await (await rota.GET(request("/api/molde/desafio?molde=proj-1", { headers: MOLDE }))).json()) as { data: { desafios: Array<{ temB: boolean; porVariante: { A: { inscritos: number }; B: { inscritos: number } }; comparacao: { vencedora: string | null; frase: string } }> } }).data.desafios;
    assert.equal(d.temB, true);
    assert.deepEqual([d.porVariante.A.inscritos, d.porVariante.B.inscritos], [2, 2]);
    assert.equal(d.comparacao.vencedora, null);
    assert.match(d.comparacao.frase, /200 inscritos/);
  });

  test("regra da Meta: o dia marcado não sai fora das 24 h do último gesto (a fila pula); o e-mail manda esse dia de novo", async () => {
    await publicarPost(DESAFIO);
    await comentar("p6");
    await tocar("p6", `desafio:${slug}:comecar`);
    await escrever("p6", "bia@exemplo.com");
    await mandarAgora();
    await tocar("p6", `desafio:${slug}:prox`);
    // a pessoa sumiu: o último gesto dela fica 25 h para trás quando o dia 2 vence
    await db.sql("update public.contacts set last_response_at = now() - interval '25 hours' where instagram_user_id = 'p6'");
    await db.sql("update public.queue set available_at = now() - interval '1 second' where status = 'pending'");
    await drain.drainQueue(40, 20_000);
    const dia2 = (await fila("p6")).filter((j) => j.payload.dia === 2);
    assert.ok(dia2.every((j) => j.status === "skipped"), "nada sai fora da janela");
    const enviados: Array<{ assunto: string }> = [];
    await db.sql("update public.desafio_inscricoes set dia_em = now() - interval '25 hours'");
    await lib.runDesafioClock({ deadline: Date.now() + 20_000, enviar: async (_c, m) => { enviados.push(m); return "id"; } });
    assert.equal(enviados[0]?.assunto, "Dia 2 do desafio: Dia 2 A", "o dia 2 não chegou pelo Direct: vai o dia 2 por e-mail");
  });
});
