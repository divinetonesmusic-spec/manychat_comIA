import { safeEqualSecret } from "@/lib/secrets";

/** Senha de administrador (ADMIN_PASSWORD, 12+ caracteres), comparada em tempo constante. Só a rota de login usa (Node). */
export function isValidAdminPassword(password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 12) return false;
  return safeEqualSecret(password, expected);
}
