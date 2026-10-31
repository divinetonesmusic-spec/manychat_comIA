import "./helpers/env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkDireto } from "@/lib/comment-automation";

test("sem resposta rápida e com link: a 1ª mensagem leva o botão do link", () => {
  assert.equal(linkDireto({ quick_reply_label: "", quick_replies: [], link_url: "https://pay.cakto.com.br/x" }), true);
});
test("com resposta rápida: segue o passo do botão «Quero ver»", () => {
  assert.equal(linkDireto({ quick_reply_label: "Quero ver", quick_replies: [], link_url: "https://pay.cakto.com.br/x" }), false);
});
test("sem link: não manda botão vazio", () => {
  assert.equal(linkDireto({ quick_reply_label: "", quick_replies: [], link_url: "" }), false);
});

import { escolhidoUmEm } from "@/lib/comment-automation";

test("post viral: 1 em 3 comentários ganha resposta pública, sempre o mesmo para o mesmo comentário", () => {
  const ids = Array.from({ length: 3000 }, (_, i) => `1789${String(i).padStart(10, "0")}`);
  const escolhidos = ids.filter((id) => escolhidoUmEm(id, 3)).length;
  assert.ok(escolhidos > 850 && escolhidos < 1150, `~1/3, veio ${escolhidos}`);
  assert.equal(escolhidoUmEm("17890000000042", 3), escolhidoUmEm("17890000000042", 3));
  assert.equal(escolhidoUmEm("qualquer", 1), true);
});

import { lerUsoMeta } from "@/lib/instagram/client";

test("lerUsoMeta: lê o maior uso e o tempo para liberar dos cabeçalhos da Meta", () => {
  const h = new Headers({
    "x-business-use-case-usage": JSON.stringify({ "1789": [{ type: "instagram", call_count: 93, total_cputime: 12, total_time: 40, estimated_time_to_regain_access: 17 }] }),
    "x-app-usage": JSON.stringify({ call_count: 20, total_time: 5, total_cputime: 3 }),
  });
  assert.deepEqual(lerUsoMeta(h), { pct: 93, liberaEmMin: 17 });
  assert.equal(lerUsoMeta(new Headers()), null);
  assert.equal(lerUsoMeta(new Headers({ "x-app-usage": "isso não é json" })), null);
});
