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

// Música do Instagram (opcional): FACEBOOK_APP_ID e FACEBOOK_APP_SECRET juntas, ou nenhuma.
const facebookKeys = ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"];
const facebookSet = facebookKeys.filter((key) => process.env[key]);
if (facebookSet.length === 1) warnings.push(`Login do Facebook incompleto (falta ${facebookKeys.filter((key) => !process.env[key]).join(", ")}). Sem as duas, não dá para pôr música do Instagram nos Reels (veja docs/musica-instagram.md).`);
if (process.env.APP_BASE_URL && process.env.FACEBOOK_REDIRECT_URI) {
  const expectedFacebook = `${process.env.APP_BASE_URL.replace(/\/$/, "")}/api/oauth/facebook/callback`;
  if (process.env.FACEBOOK_REDIRECT_URI !== expectedFacebook) warnings.push(`FACEBOOK_REDIRECT_URI diferente de ${expectedFacebook}: confira se é o mesmo endereço cadastrado no Login do Facebook.`);
}

// Outras redes (opcional): Threads e YouTube, cada par junto ou nenhum (docs/redes-e-vendas.md).
for (const [nome, keys, callback] of [
  ["Threads", ["THREADS_APP_ID", "THREADS_APP_SECRET"], "THREADS_REDIRECT_URI", "/api/oauth/threads/callback"],
  ["YouTube (Google)", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], "GOOGLE_REDIRECT_URI", "/api/oauth/youtube/callback"],
].map(([nome, keys, redirect, path]) => [nome, keys, { redirect, path }])) {
  const set = keys.filter((key) => process.env[key]);
  if (set.length === 1) warnings.push(`${nome} incompleto (falta ${keys.filter((key) => !process.env[key]).join(", ")}). Sem as duas, o botão de conectar avisa que falta configurar.`);
  if (process.env.APP_BASE_URL && process.env[callback.redirect]) {
    const expected = `${process.env.APP_BASE_URL.replace(/\/$/, "")}${callback.path}`;
    if (process.env[callback.redirect] !== expected) warnings.push(`${callback.redirect} diferente de ${expected}: confira se é o mesmo endereço cadastrado no painel.`);
  }
}
const chunkMb = process.env.YOUTUBE_CHUNK_MB;
if (chunkMb && !(Number(chunkMb.replace(",", ".")) > 0)) warnings.push("YOUTUBE_CHUNK_MB deve ser um número de MB maior que zero (padrão 8).");
// Vendas por webhook (opcional): cada plataforma só liga com o seu segredo.
if (process.env.STRIPE_WEBHOOK_SECRET && !process.env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) warnings.push("STRIPE_WEBHOOK_SECRET normalmente começa com whsec_ (o segredo de assinatura do endpoint, não a chave da API).");
if (process.env.GUMROAD_WEBHOOK_KEY && process.env.GUMROAD_WEBHOOK_KEY.length < 24) warnings.push("GUMROAD_WEBHOOK_KEY deve ter pelo menos 24 caracteres (vai no endereço do ping).");
if (process.env.CAKTO_WEBHOOK_SECRET && process.env.CAKTO_WEBHOOK_SECRET.length < 8) warnings.push("CAKTO_WEBHOOK_SECRET parece curto: copie o segredo exato do webhook na Cakto.");

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