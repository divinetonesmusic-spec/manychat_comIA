import type { Config, InstagramAccount } from "@/lib/db/repositories";

/**
 * O que as telas podem saber de uma conta do Instagram. NUNCA o token: tudo o que vai para um
 * componente "use client" (ou para uma resposta lida pelo navegador) fica embutido na página.
 * Lista de campos permitidos (e não "tudo menos o token"), para um campo secreto novo não vazar por engano.
 */
export type PublicInstagramAccount = Pick<
  InstagramAccount,
  "id" | "instagram_user_id" | "instagram_username" | "instagram_name" | "instagram_profile_picture_url" | "is_default" | "token_expires_at"
>;

/** Perfil ativo sem o token (o que a tela Perfis usa). */
export type PublicConfig = Omit<Config, "instagram_access_token">;

export function toPublicInstagramAccount(account: InstagramAccount | PublicInstagramAccount): PublicInstagramAccount {
  return {
    id: account.id,
    instagram_user_id: account.instagram_user_id,
    instagram_username: account.instagram_username,
    instagram_name: account.instagram_name ?? null,
    instagram_profile_picture_url: account.instagram_profile_picture_url ?? null,
    is_default: Boolean(account.is_default),
    token_expires_at: account.token_expires_at ? new Date(account.token_expires_at).toISOString() : null,
  };
}

export function toPublicConfig(config: Config | PublicConfig): PublicConfig {
  return {
    account_id: config.account_id,
    instagram_user_id: config.instagram_user_id,
    instagram_username: config.instagram_username,
    instagram_name: config.instagram_name,
    instagram_profile_picture_url: config.instagram_profile_picture_url,
    token_expires_at: config.token_expires_at,
    webhook_subscribed_at: config.webhook_subscribed_at,
  };
}
