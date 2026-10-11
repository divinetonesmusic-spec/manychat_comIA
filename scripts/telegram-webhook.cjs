/**
 * Liga os botões do Telegram: registra no Telegram o endereço do webhook do UaiFlow (setWebhook) com o segredo.
 * Faz o mesmo que o botão "Ligar os botões do Telegram" da tela Configurações.
 *
 * Uso (no computador, com o .env.local preenchido ou as variáveis no terminal):
 *   npm run telegram:webhook            registra <APP_BASE_URL>/api/telegram/webhook
 *   npm run telegram:webhook -- --ver   só mostra o que o Telegram tem registrado agora (sem mudar nada)
 * Precisa de TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET e APP_BASE_URL (https://...). Nunca mostra o token nem o segredo.
 */
const { loadEnvFile } = require("./migration-utils.cjs");

async function main() {
  loadEnvFile();
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  const base = (process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN (o token que o @BotFather mandou).");

  const call = async (method, body) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(`O Telegram recusou ${method}: ${String(data.description || response.status).split(token).join("***")}`);
    return data.result;
  };

  if (process.argv.includes("--ver")) {
    const info = await call("getWebhookInfo");
    console.log(`Endereço registrado: ${info.url || "(nenhum)"}`);
    console.log(`Toques esperando entrega: ${info.pending_update_count ?? 0}`);
    if (info.last_error_message) console.log(`Último erro do Telegram: ${info.last_error_message}`);
    return;
  }

  if (!/^[A-Za-z0-9_-]{24,256}$/.test(secret)) throw new Error("TELEGRAM_WEBHOOK_SECRET precisa ter de 24 a 256 letras, números, _ ou - (sem espaço).");
  if (!/^https:\/\/[^\s/]+/i.test(base)) throw new Error("APP_BASE_URL precisa ser o endereço do site no ar, começando com https://.");
  const url = `${base}/api/telegram/webhook`;
  await call("setWebhook", { url, secret_token: secret, allowed_updates: ["callback_query"], max_connections: 5 });
  console.log(`Pronto: o Telegram vai avisar ${url} quando você tocar nos botões.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
