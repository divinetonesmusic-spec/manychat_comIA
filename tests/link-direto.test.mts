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
