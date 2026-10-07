import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const { findMatchingMedia, parseMetaTimestamp } = await import("@/lib/content/publish-check");

describe("conferência do feed (achar o Reel que já saiu)", () => {
  const since = new Date("2026-10-07T12:00:00Z");

  test("lê a data no formato da Meta (+0000)", () => {
    assert.equal(parseMetaTimestamp("2026-10-07T12:01:02+0000")?.toISOString(), "2026-10-07T12:01:02.000Z");
    assert.equal(parseMetaTimestamp("lixo"), null);
    assert.equal(parseMetaTimestamp(null), null);
  });

  test("acha pela legenda, ignorando quebras de linha e espaços diferentes", () => {
    const found = findMatchingMedia(
      [{ id: "m1", caption: "Legenda  do Reel\r\nComente EBOOK ", timestamp: "2026-10-07T12:00:30+0000" }],
      { caption: "Legenda do Reel\nComente EBOOK", since },
    );
    assert.equal(found?.id, "m1");
  });

  test("não aceita legenda diferente nem post bem anterior ao pedido", () => {
    const feed = [
      { id: "outra", caption: "Outra legenda", timestamp: "2026-10-07T12:00:30+0000" },
      { id: "antiga", caption: "Legenda", timestamp: "2026-10-06T12:00:00+0000" },
    ];
    assert.equal(findMatchingMedia(feed, { caption: "Legenda", since }), null);
  });

  test("com duas iguais, fica com a mais antiga depois do pedido (a primeira que saiu)", () => {
    const feed = [
      { id: "nova", caption: "Legenda", timestamp: "2026-10-07T12:05:00+0000" },
      { id: "primeira", caption: "Legenda", timestamp: "2026-10-07T12:01:00+0000" },
    ];
    assert.equal(findMatchingMedia(feed, { caption: "Legenda", since })?.id, "primeira");
  });

  // Onda final: nunca pegar o post de outro (1º comentário e automação cairiam nele).
  test("legenda vazia nunca casa (Stories e posts sem legenda não aparecem como 'já saiu')", () => {
    const feed = [
      { id: "sem-legenda", caption: "", timestamp: "2026-10-07T12:01:00+0000" },
      { id: "sem-campo", timestamp: "2026-10-07T12:02:00+0000" },
    ];
    assert.equal(findMatchingMedia(feed, { caption: "", since }), null);
    assert.equal(findMatchingMedia(feed, { caption: "  \n ", since }), null);
  });

  test("ignora mídias que já são de outro post do UaiFlow", () => {
    const feed = [
      { id: "de-outro-post", caption: "Legenda", timestamp: "2026-10-07T12:01:00+0000" },
      { id: "desta-vez", caption: "Legenda", timestamp: "2026-10-07T12:03:00+0000" },
    ];
    assert.equal(findMatchingMedia(feed, { caption: "Legenda", since, excludeIds: new Set(["de-outro-post"]) })?.id, "desta-vez");
    assert.equal(findMatchingMedia(feed, { caption: "Legenda", since, excludeIds: new Set(["de-outro-post", "desta-vez"]) }), null);
  });

  test("prefere a mídia do horário do pedido em diante; a folga de 10 min antes é só reserva", () => {
    const antes = { id: "antes", caption: "Legenda", timestamp: "2026-10-07T11:55:00+0000" };
    const depois = { id: "depois", caption: "Legenda", timestamp: "2026-10-07T12:04:00+0000" };
    assert.equal(findMatchingMedia([antes, depois], { caption: "Legenda", since })?.id, "depois");
    // sem nada depois do pedido: usa a folga, e fica com a mais perto do pedido
    const maisAntes = { id: "mais-antes", caption: "Legenda", timestamp: "2026-10-07T11:52:00+0000" };
    assert.equal(findMatchingMedia([maisAntes, antes], { caption: "Legenda", since })?.id, "antes");
    // a Meta corta os milissegundos: o mesmo segundo do pedido conta como "depois"
    const mesmoSegundo = { id: "mesmo-segundo", caption: "Legenda", timestamp: "2026-10-07T12:00:00+0000" };
    assert.equal(findMatchingMedia([antes, mesmoSegundo], { caption: "Legenda", since: new Date("2026-10-07T12:00:00.700Z") })?.id, "mesmo-segundo");
  });
});
