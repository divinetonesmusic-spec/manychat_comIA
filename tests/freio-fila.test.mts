import "./helpers/env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { enviosPausados } from "@/lib/queue/drain";

test("freio da fila: vazio desliga, data futura segura, data passada libera", () => {
  const antes = process.env.ENVIOS_PAUSADOS_ATE;
  try {
    process.env.ENVIOS_PAUSADOS_ATE = "";
    assert.equal(enviosPausados(), false);
    process.env.ENVIOS_PAUSADOS_ATE = "2026-12-01T00:00:00-03:00";
    assert.equal(enviosPausados(new Date("2026-10-31T12:00:00Z")), true);
    assert.equal(enviosPausados(new Date("2026-12-02T12:00:00Z")), false);
    delete process.env.ENVIOS_PAUSADOS_ATE;
    assert.equal(enviosPausados(new Date("2026-10-31T12:00:00Z")), true);
  } finally {
    process.env.ENVIOS_PAUSADOS_ATE = antes;
  }
});
