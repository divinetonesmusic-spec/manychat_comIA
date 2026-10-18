import "./helpers/env.mjs";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestDatabase, semBanco, type TestDatabase } from "./helpers/db.mjs";
import { installFakeMeta } from "./helpers/fake-meta.mjs";
import { request } from "./helpers/http.mjs";
import { insertPost, readPost, seedAccount } from "./helpers/seed.mjs";

/**
 * Supabase sem a 0010 (só até a 0009): o Instagram continua igual. O campo `redes` é aceito, mas não guardado
 * (aviso "Falta colar a atualização 0010"), as contas mostram as redes como não conectadas, os webhooks de venda
 * respondem 503 e o relógio não quebra.
 */
process.env.STRIPE_WEBHOOK_SECRET = "whsec_segredo-falso-da-stripe";
const meta = installFakeMeta();
const db: TestDatabase | null = semBanco ? null : await createTestDatabase({ ate: "0009" });
const moldePosts = await import("@/app/api/molde/posts/route");
const moldeAccounts = await import("@/app/api/molde/accounts/route");
const stripe = await import("@/app/api/webhooks/stripe/route");
const vendasRoute = await import("@/app/api/molde/vendas/route");
const service = await import("@/lib/content/service");
const { signStripe } = await import("@/lib/vendas/webhooks");
const { runContentCycle } = await import("@/lib/content/scheduler");
const MOLDE = { "x-molde-token": process.env.MOLDE_API_TOKEN as string };

after(async () => {
  meta.restore();
  await db?.close();
});

describe("sem a 0010", { skip: semBanco }, () => {
  test("Molde: post com redes é salvo só para o Instagram, com o aviso", async () => {
    const accountId = await seedAccount(db!);
    const response = await moldePosts.POST(request("/api/molde/posts", {
      headers: MOLDE,
      json: { accountId, publishType: "reel_video", mediaUrl: "https://midia.teste.invalid/uaiflow/r.mp4", externalRef: "s0010", redes: ["instagram", "threads"] },
    }));
    assert.equal(response.status, 201);
    const body = (await response.json()) as { data: Record<string, unknown>; warning?: string };
    assert.equal(body.warning, service.REDES_COLUMN_MISSING_WARNING);
    assert.deepEqual(body.data.redes, ["instagram"]);
    assert.deepEqual(Object.keys(body.data.redesStatus as object), ["instagram"]);

    const accounts = (await (await moldeAccounts.GET(request("/api/molde/accounts", { headers: MOLDE }))).json()) as { data: Array<{ redes: Record<string, { conectado: boolean; motivo?: string }> }> };
    assert.equal(accounts.data[0].redes.threads.conectado, false);
    assert.match(accounts.data[0].redes.threads.motivo ?? "", /0010/);
  });

  test("relógio e Instagram seguem como antes (o post sai no Instagram)", async () => {
    const accountId = (await db!.sql<{ id: string }>("select id from public.instagram_accounts limit 1"))[0].id;
    const id = await insertPost(db!, accountId);
    await runContentCycle(8000);
    await runContentCycle(8000);
    assert.equal((await readPost(db!, id)).status, "published");
  });

  test("webhook de venda válido: 503 (a plataforma tenta de novo depois); resumo do Molde: 503", async () => {
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", amount_total: 100, currency: "usd", payment_status: "paid" } } });
    const response = await stripe.POST(new NextRequest(new URL("/api/webhooks/stripe", "https://uaiflow.teste"), { method: "POST", body, headers: { "stripe-signature": signStripe(body, process.env.STRIPE_WEBHOOK_SECRET as string) } }));
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { codigo: string }).codigo, "falta_0010");
    assert.equal((await vendasRoute.GET(request("/api/molde/vendas", { headers: MOLDE }))).status, 503);
  });
});
