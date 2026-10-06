const fallbackMessage = "Nao consegui concluir a autenticacao. Tente novamente.";

const exactMessages: Record<string, string> = {
  config: "A autenticacao ainda nao esta configurada: defina ADMIN_SESSION_SECRET (ou WORKER_SECRET) e ADMIN_PASSWORD (12+ caracteres) nas variaveis do servidor.",
  "1": "Senha incorreta.",
  "user already registered": "Este e-mail ja esta cadastrado. Use Entrar ou solicite um link magico.",
  "invalid login credentials": "E-mail ou senha incorretos.",
  "email not confirmed": "Confirme seu e-mail antes de entrar.",
  "signup is disabled": "O cadastro esta temporariamente desativado.",
  "email rate limit exceeded": "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  "user not found": "Nao encontrei uma conta com esse e-mail.",
  "token has expired or is invalid": "O link expirou ou e invalido. Solicite um novo link.",
  "otp expired": "O link magico expirou. Solicite um novo link.",
  "invalid token": "O link de acesso e invalido. Solicite um novo link.",
};

const partialMessages: Array<[string, string]> = [
  ["already registered", "Este e-mail ja esta cadastrado. Use Entrar ou solicite um link magico."],
  ["invalid login", "E-mail ou senha incorretos."],
  ["invalid credentials", "E-mail ou senha incorretos."],
  ["email not confirmed", "Confirme seu e-mail antes de entrar."],
  ["password", "A senha precisa atender aos requisitos minimos de seguranca."],
  ["rate limit", "Muitas tentativas. Aguarde alguns minutos e tente novamente."],
  ["security purposes", "Por seguranca, aguarde alguns segundos antes de tentar de novo."],
  ["invalid email", "Informe um e-mail valido."],
  ["unable to validate email", "Informe um e-mail valido."],
  ["expired", "O link expirou. Solicite um novo link."],
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
