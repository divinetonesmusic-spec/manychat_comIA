const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { getMigrations } = require("./migration-utils.cjs");

const requiredFiles = [
  ".env.example",
  "README.md",
  "docs/GUIA_COMPLETO_NOVO_PROPRIETARIO.md",
  "docs/RELEASE_CHECKLIST.md",
  "supabase/cron.sql",
  "supabase/migrations/0001_initial_schema.sql",
];
const forbiddenTracked = [
  /^\.env(?:\.|$)(?!example$)/,
  /^\.vercel\//,
  /^\.next\//,
  /^node_modules\//,
  /^instagram-skill\//,
  /^logo\//,
  /^referencia\//,
  /\.tsbuildinfo$/,
];
const requiredEnvKeys = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "DATABASE_POOL_MAX", "APP_BASE_URL",
  "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET", "ALLOWED_EMAILS", "WORKER_SECRET", "META_API_VERSION",
  "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI", "WEBHOOK_VERIFY_TOKEN",
];
const secretPatterns = [
  { name: "chave secreta Supabase", pattern: /sb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: "token Meta/Instagram", pattern: /\b(?:IGQV|EAA)[A-Za-z0-9_-]{30,}/ },
  { name: "token OIDC/JWT", pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
];

const errors = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(process.cwd(), file))) errors.push(`Arquivo obrigatorio ausente: ${file}`);
}

const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
for (const file of tracked) {
  if (forbiddenTracked.some((pattern) => pattern.test(file))) errors.push(`Arquivo proibido versionado: ${file}`);
  const fullPath = path.join(process.cwd(), file);
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size > 2_000_000) continue;
  const content = fs.readFileSync(fullPath, "utf8");
  for (const secret of secretPatterns) {
    if (secret.pattern.test(content)) errors.push(`Possivel ${secret.name} em ${file}`);
  }
}

const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
for (const key of requiredEnvKeys) {
  if (!new RegExp(`^${key}=`, "m").test(envExample)) errors.push(`Variavel ausente em .env.example: ${key}`);
}

try {
  const migrations = getMigrations();
  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) errors.push(`Versao de migration duplicada: ${migration.version}`);
    versions.add(migration.version);
    if (!migration.sql.trim()) errors.push(`Migration vazia: ${migration.name}`);
  }
  console.log(`${migrations.length} migration(s) encontrada(s).`);
} catch (error) {
  errors.push(error.message);
}

// Lembrete: o site no ar só deixa entrar por e-mail quem está em ALLOWED_EMAILS (vazio = só a senha de administrador).
console.warn("[aviso] Antes de publicar: confira ALLOWED_EMAILS nas variáveis do Netlify. Vazio, no site no ar ninguém entra com e-mail, link ou Google; só a senha de administrador.");

if (errors.length) {
  for (const error of errors) console.error(`[erro] ${error}`);
  process.exitCode = 1;
} else {
  console.log("Pacote pronto para a verificacao tecnica final.");
}