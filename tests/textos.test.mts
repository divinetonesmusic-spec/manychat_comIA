import "./helpers/env.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Rodada 1: os motivos e as notas de status do relógio aparecem para o dono (tela Conteúdo e avisos no
 * Telegram) e precisam estar em português com acentos.
 */
const { translateError } = await import("@/lib/content/scheduler");

describe("textos do relógio com acentos", () => {
  test("motivos traduzidos dos erros da Meta", () => {
    assert.equal(translateError(new Error("(#10) Application does not have permission for this action")), "Falta a permissão de publicar. Reconecte o perfil aceitando instagram_business_content_publish.");
    assert.equal(translateError(new Error("Media ID is not available")), "A mídia ainda não terminou de processar na Meta.");
    assert.equal(translateError(new Error("The video aspect ratio is invalid")), "A Meta recusou o vídeo (formato, duração ou resolução). Reels: MP4 H.264, 9:16, de 3 s a 15 min.");
    assert.equal(translateError(new Error("Invalid parameter: video_url download failed")), "A Meta não conseguiu baixar a mídia. Confira se o link é público.");
  });

  test("notas de status e motivos fixos do scheduler e da recuperação de posts presos", () => {
    const scheduler = readFileSync("src/lib/content/scheduler.ts", "utf8");
    for (const texto of [
      "A Meta está preparando os itens do carrossel.",
      "A Meta está processando a mídia.",
      "A Meta ainda está processando os itens do carrossel.",
      "A Meta não terminou de processar em ${MAX_PUBLISHING_HOURS} h. Tente agendar de novo.",
      "Publicado, mas o 1º comentário falhou: ",
      "Publicado, mas a automação da DM falhou: ",
      "Instagram não conectado para este perfil.",
    ]) assert.ok(scheduler.includes(texto), `falta: ${texto}`);
    for (const semAcento of ["esta processando", "esta preparando", "a midia", "nao terminou", "1o comentario", "automacao da DM", "Instagram nao conectado", "permissao", "duracao", "resolucao", "o video", "link e publico"]) {
      assert.ok(!scheduler.includes(semAcento), `ainda sem acento em scheduler.ts: "${semAcento}"`);
    }
    const planner = readFileSync("src/lib/db/content-planner.ts", "utf8");
    assert.ok(planner.includes("'Não consegui iniciar a publicação depois de 3 tentativas.'"));
  });
});
