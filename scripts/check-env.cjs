const path = require("node:path");
const { loadEnvFile } = require("./migration-utils.cjs");

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "APP_BASE_URL",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "WORKER_SECRET",
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_REDIRECT_URI",
  "WEBHOOK_VERIFY_TOKEN",
];

const envFile = path.join(process.cwd(), ".env.local");
const loaded = loadEnvFile(envFile);
const missing = required.filter((key) => !process.env[key]);
const placeholders = /^(SEU_|SUA_|CRIE_|GERE_|troque-|gere-|https:\/\/SEU-|postgresql:\/\/postgres\.SEU-)/i;
const placeholderKeys = required.filter((key) => placeholders.test(process.env[key] || ""));
const errors = [];
const warnings = [];

if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_URL
  && process.env.NEXT_PUBLIC_SUPABASE_URL !== process.env.SUPABASE_URL) {
  errors.push("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_URL apontam para projetos diferentes.");
}

if (process.env.APP_BASE_URL && process.env.INSTAGRAM_REDIRECT_URI) {
  const expected = `${process.env.APP_BASE_URL.replace(/\/$/, "")}/api/oauth/callback`;
  if (process.env.INSTAGRAM_REDIRECT_URI !== expected) errors.push(`INSTAGRAM_REDIRECT_URI deve ser ${expected}`);
}

for (const key of ["ADMIN_SESSION_SECRET", "WORKER_SECRET", "WEBHOOK_VERIFY_TOKEN"]) {
  const value = process.env[key] || "";
  if (value && value.length < 32) warnings.push(`${key} deve ter pelo menos 32 caracteres.`);
}

// Planner de conteúdo (opcional): envio de arquivo pelo Cloudflare R2 e a porta do Molde do Avatar.
const r2Keys = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL"];
const r2Set = r2Keys.filter((key) => process.env[key]);
if (r2Set.length && r2Set.length < r2Keys.length) warnings.push(`R2 incompleto (falta ${r2Keys.filter((key) => !process.env[key]).join(", ")}). Sem isso o botao Enviar arquivo nao funciona; links publicos colados continuam funcionando.`);
if (!r2Set.length) warnings.push("R2 nao configurado: o planner aceita so links publicos de midia (sem botao de enviar arquivo).");
if (process.env.MOLDE_API_TOKEN && process.env.MOLDE_API_TOKEN.length < 24) warnings.push("MOLDE_API_TOKEN deve ter pelo menos 24 caracteres.");
if (!process.env.MOLDE_API_TOKEN) warnings.push("MOLDE_API_TOKEN vazio: o Molde do Avatar nao consegue mandar posts para o planner.");

// Avisos pelo Telegram (opcional): as duas variáveis juntas, ou nenhuma.
const telegramKeys = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
const telegramSet = telegramKeys.filter((key) => process.env[key]);
if (telegramSet.length === 1) warnings.push(`Telegram incompleto (falta ${telegramKeys.filter((key) => !process.env[key]).join(", ")}). Sem as duas variáveis, nenhum aviso é enviado.`);
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
if (webhookSecret && !/^[A-Za-z0-9_-]{24,256}$/.test(webhookSecret)) warnings.push("TELEGRAM_WEBHOOK_SECRET deve ter de 24 a 256 letras, números, _ ou - (sem espaço).");
if (telegramSet.length === 2 && !webhookSecret) warnings.push("TELEGRAM_WEBHOOK_SECRET vazio: os avisos saem, mas sem os botões «Aprovar» e «Mandar» (veja docs/ATUALIZACAO_0008.md).");
const teto = process.env.MOLDE_TETO_USD;
if (teto && !(Number(teto.replace(",", ".")) >= 0)) warnings.push("MOLDE_TETO_USD deve ser um número (em dólares), por exemplo 50.");
if (!telegramSet.length) warnings.push("Telegram não configurado: o UaiFlow não manda avisos no celular (opcional; veja docs/AVISOS_E_COPIA.md).");

if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 12) warnings.push("ADMIN_PASSWORD deve ter pelo menos 12 caracteres.");

// Quem pode entrar pelo Supabase (e-mail, link ou Google). No site no ar a lista é obrigatória.
const allowedEmails = (process.env.ALLOWED_EMAILS || "").split(",").map((item) => item.trim()).filter(Boolean);
if (!allowedEmails.length) {
  warnings.push("ALLOWED_EMAILS está vazio: no site no ar ninguém entra com e-mail, link ou Google; só a senha de administrador (ADMIN_PASSWORD). Coloque o seu e-mail, por exemplo ALLOWED_EMAILS=voce@gmail.com, nas variáveis do Netlify.");
} else if (allowedEmails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
  warnings.push("ALLOWED_EMAILS tem um item que não parece e-mail. Use e-mails separados por vírgula, por exemplo voce@gmail.com,socia@gmail.com.");
}

console.log(loaded ? "Arquivo .env.local carregado." : ".env.local nao encontrado; usando variaveis do processo.");
if (missing.length) errors.push(`Variaveis ausentes: ${missing.join(", ")}`);
if (placeholderKeys.length) errors.push(`Substitua os valores de exemplo: ${placeholderKeys.join(", ")}`);
for (const warning of warnings) console.warn(`[aviso] ${warning}`);
for (const error of errors) console.error(`[erro] ${error}`);

if (errors.length) process.exitCode = 1;
else console.log("Ambiente configurado corretamente.");