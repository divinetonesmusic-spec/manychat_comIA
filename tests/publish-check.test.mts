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
});
