const fallbackMessage = "Não consegui entrar. Tente de novo.";

const exactMessages: Record<string, string> = {
  config: "A entrada ainda não está configurada: defina ADMIN_SESSION_SECRET (ou WORKER_SECRET) e ADMIN_PASSWORD (12 ou mais caracteres) nas variáveis do servidor.",
  "1": "Senha incorreta.",
  "user already registered": "Este e-mail já está cadastrado. Use Entrar ou peça um link de entrada por e-mail.",
  "invalid login credentials": "E-mail ou senha incorretos.",
  "email not confirmed": "Confirme seu e-mail antes de entrar.",
  "signup is disabled": "O cadastro está temporariamente desativado.",
  "email rate limit exceeded": "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  "user not found": "Não encontrei uma conta com esse e-mail.",
  "token has expired or is invalid": "O link venceu ou não é válido. Peça um novo link.",
  "otp expired": "O link de entrada venceu. Peça um novo link.",
  "invalid token": "O link de acesso não é válido. Peça um novo link.",
};

const partialMessages: Array<[string, string]> = [
  ["already registered", "Este e-mail já está cadastrado. Use Entrar ou peça um link de entrada por e-mail."],
  ["invalid login", "E-mail ou senha incorretos."],
  ["invalid credentials", "E-mail ou senha incorretos."],
  ["email not confirmed", "Confirme seu e-mail antes de entrar."],
  ["password", "A senha precisa atender aos requisitos mínimos de segurança."],
  ["rate limit", "Muitas tentativas. Aguarde alguns minutos e tente novamente."],
  ["security purposes", "Por segurança, aguarde alguns segundos antes de tentar de novo."],
  ["invalid email", "Informe um e-mail válido."],
  ["unable to validate email", "Informe um e-mail válido."],
  ["expired", "O link venceu. Peça um novo link."],
];

export function translateAuthError(error: unknown) {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const normalized = raw.trim().toLowerCase();

  if (!normalized) return fallbackMessage;
  if (Object.values(exactMessages).includes(raw) || partialMessages.some(([, message]) => message === raw)) return raw;
  if (exactMessages[normalized]) return exactMessages[normalized];

  const partial = partialMessages.find(([needle]) => normalized.includes(needle));
  if (partial) return partial[1];

  return fallbackMessage;
}
