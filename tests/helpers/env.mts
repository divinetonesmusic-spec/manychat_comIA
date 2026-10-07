/**
 * Variáveis falsas usadas em todos os testes. Nada aqui é segredo de verdade.
 * Importe este arquivo ANTES de qualquer módulo do app (src/), porque alguns leem o ambiente ao carregar.
 */
const falsas: Record<string, string> = {
  APP_BASE_URL: "https://uaiflow.teste",
  INSTAGRAM_APP_ID: "123456789",
  INSTAGRAM_APP_SECRET: "segredo-falso-do-app-da-meta",
  INSTAGRAM_REDIRECT_URI: "https://uaiflow.teste/api/oauth/callback",
  WORKER_SECRET: "segredo-falso-do-relogio-com-mais-de-32-caracteres",
  ADMIN_SESSION_SECRET: "segredo-falso-da-sessao-com-mais-de-32-caracteres",
  MOLDE_API_TOKEN: "token-falso-do-molde-0123456789abcdef",
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.teste.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "chave-anon-falsa",
  R2_ACCOUNT_ID: "contafalsa",
  R2_ACCESS_KEY_ID: "chavefalsa",
  R2_SECRET_ACCESS_KEY: "segredofalso",
  R2_BUCKET: "baldefalso",
  R2_PUBLIC_BASE_URL: "https://midia.teste.invalid",
  // Sem banco de teste, o pool é criado mas nunca conecta (os testes de banco ficam pulados).
  DATABASE_URL: "postgresql://sem-banco@127.0.0.1:1/sem_banco?sslmode=disable",
  DATABASE_POOL_MAX: "2",
  NEXT_TELEMETRY_DISABLED: "1",
};

for (const [nome, valor] of Object.entries(falsas)) process.env[nome] = valor;

// Avisos do Telegram começam desligados; cada teste que precisa liga com valores falsos.
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

export {};
