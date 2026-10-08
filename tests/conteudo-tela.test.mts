import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

/** Tela Conteúdo: nota de post publicado não pode aparecer como erro (Rodada 1, achado 4). */
const { lastErrorClass } = await import("@/app/conteudo/conteudo-client");

describe("cor da nota no detalhe do post", () => {
  test("post publicado: nota neutra (ex.: 'Publicado; não consegui buscar o link'), não vermelha", () => {
    assert.doesNotMatch(lastErrorClass("published"), /red/);
    assert.match(lastErrorClass("published"), /ms-muted/);
  });

  test("publicando continua neutro; com erro continua vermelho", () => {
    assert.match(lastErrorClass("publishing"), /ms-muted/);
    assert.match(lastErrorClass("failed"), /text-red-500/);
  });
});

describe("cor da nota na LISTA de posts (onda final)", () => {
  test("notas de 'publicando' saem neutras; só a de post com erro sai em vermelho", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { PostList } = await import("@/app/conteudo/conteudo-client");
    const base = { account_id: "a", account_username: "c", publish_type: "reel_video", caption: "x", media_url: "", cover_url: null, media_items: [], container_id: null, published_media_id: null, permalink: null, published_at: null, created_at: "2026-10-07T12:00:00Z", updated_at: "2026-10-07T12:00:00Z", scheduled_at: "2026-10-07T12:00:00Z" };
    const posts = [
      { ...base, id: "p1", title: "Um", status: "publishing", last_error: "A Meta publicou. Buscando o link do post." },
      { ...base, id: "p2", title: "Dois", status: "publishing", last_error: "Conferindo se a Meta já publicou." },
      { ...base, id: "p3", title: "Três", status: "failed", last_error: "A Meta recusou o vídeo." },
    ];
    const html = renderToStaticMarkup(createElement(PostList, { posts: posts as never, onOpenPost: () => undefined }));
    const classeDa = (texto: string) => html.match(new RegExp(`<p class="([^"]*)">${texto}</p>`))?.[1] ?? "";
    for (const nota of ["A Meta publicou. Buscando o link do post.", "Conferindo se a Meta já publicou."]) {
      assert.ok(classeDa(nota), `nota não encontrada: ${nota}`);
      assert.doesNotMatch(classeDa(nota), /red/, nota);
      assert.match(classeDa(nota), /ms-muted/, nota);
    }
    assert.match(classeDa("A Meta recusou o vídeo."), /text-red-500/);
  });
});

describe("nota do último envio em Contatos (onda final)", () => {
  test("DM adiada pelo limite por hora é só informação (neutra); só envio com erro fica vermelho", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { QueueNote, queueNoteClass } = await import("@/app/contatos/nota-fila");
    const nota = "Limite de 200 mensagens por hora deste perfil: sai às 14:05.";
    const classeDe = (status: string | null, texto: string) => {
      const html = renderToStaticMarkup(createElement(QueueNote, { status, text: texto }));
      return html.match(new RegExp(`<p class="([^"]*)">${texto.replace(/[.]/g, "\\.")}</p>`))?.[1] ?? "";
    };
    assert.ok(classeDe("pending", nota), "nota não encontrada");
    assert.doesNotMatch(classeDe("pending", nota), /red/);
    assert.match(classeDe("pending", nota), /ms-muted/);
    assert.doesNotMatch(classeDe("sending", nota), /red/);
    assert.match(classeDe("failed", "A Meta recusou a mensagem."), /text-red-500/);
    assert.equal(queueNoteClass("sent"), queueNoteClass(null));
    assert.equal(renderToStaticMarkup(createElement(QueueNote, { status: "failed", text: null })), "");
  });
});
