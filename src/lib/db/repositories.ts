import { query } from "@/lib/db/client";
import { toPublicConfig, toPublicInstagramAccount, type PublicInstagramAccount } from "@/lib/instagram/public-account";

export type WorkspaceContext = {
  profile: {
    user_id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
  workspace: {
    id: string;
    name: string;
    plan: string;
  };
  role: string;
};
export type AutomationTrigger = "comments" | "story" | "dm";
export type MatchType = "contains" | "exact" | "any";
export type DelayMode = "fixed" | "random";
export type ReplyMode = "fixed" | "random";
export type SendType = "private_reply" | "dm" | "public_reply";
const defaultFollowerConfirmationGreetings = ["Oii", "Ola", "Eii", "Eae", "Opa"];

export type QuickReply = {
  title: string;
  payload: string;
};

export type FlowNodeDefinition = {
  id: string;
  kind: string;
  position: { x: number; y: number };
  config?: Record<string, unknown>;
};

export type FlowEdgeDefinition = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  condition?: Record<string, unknown>;
};
export type Automation = {
  id: string;
  account_id: string | null;
  name: string;
  active: boolean;
  triggers: AutomationTrigger[];
  keywords: string[];
  match_type: MatchType;
  post_id: string | null;
  public_replies: string[];
  public_reply_mode: ReplyMode;
  welcome_dm: string;
  quick_reply_label: string;
  quick_replies: QuickReply[];
  link_text: string;
  link_button_label: string;
  link_url: string;
  reply_delay_seconds: number;
  reply_delay_mode: DelayMode;
  reply_delay_min_seconds: number;
  reply_delay_max_seconds: number;
  reminder_text: string;
  reminder_delay_minutes: number;
  reminder_delay_seconds: number;
  reminder_delay_mode: DelayMode;
  reminder_delay_min_seconds: number;
  reminder_delay_max_seconds: number;
  require_follower: boolean;
  non_follower_dm: string;
  non_follower_button_label: string;
  follower_confirmation_text: string;
  follower_confirmation_greetings: string[];
  flow_nodes: FlowNodeDefinition[];
  flow_edges: FlowEdgeDefinition[];
  created_at: string;
  updated_at: string;
};

export type InstagramAccount = {
  id: string;
  instagram_access_token: string;
  instagram_user_id: string;
  instagram_username: string;
  instagram_name: string | null;
  instagram_profile_picture_url: string | null;
  token_expires_at: string | null;
  /** Hora da última renovação do token (vem no select *). */
  last_token_refresh_at?: string | null;
  webhook_subscribed_at: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};
export type Config = {
  account_id: string | null;
  instagram_access_token: string | null;
  instagram_user_id: string | null;
  instagram_username: string | null;
  instagram_name: string | null;
  instagram_profile_picture_url: string | null;
  token_expires_at: string | null;
  webhook_subscribed_at: string | null;
};

export type PersistentMenuItem = {
  title: string;
  type: "postback" | "web_url";
  payload?: string;
  url?: string;
};

export type IceBreakerItem = {
  question: string;
  payload: string;
};

export type ProfileSettings = {
  id: boolean;
  account_id: string | null;
  channel_active: boolean;
  default_automation_id: string | null;
  opt_in_automation_id: string | null;
  opt_out_automation_id: string | null;
  story_mention_automation_id: string | null;
  persistent_menu_items: PersistentMenuItem[];
  ice_breakers: IceBreakerItem[];
  persistent_menu_synced_at: string | null;
  ice_breakers_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type QueueJob = {
  id: string;
  account_id: string | null;
  contact_id: string | null;
  automation_id: string | null;
  instagram_recipient_id: string | null;
  instagram_comment_id: string | null;
  send_type: SendType;
  payload: Record<string, unknown>;
};

export type RecentEvent = {
  id: string;
  event_type: string;
  instagram_username: string | null;
  instagram_media_id: string | null;
  received_at: string;
};

export type FlowLog = {
  id: string;
  automation_id: string | null;
  automation_name: string | null;
  instagram_username: string | null;
  instagram_user_id: string | null;
  send_type: SendType;
  status: string;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export type TemplateContext = {
  username: string;
  name: string;
  first_name: string;
  instagram_user_id: string;
  is_follower: string;
  automation_name: string;
  profile_url: string;
};

export type ContactSummary = {
  id: string;
  account_id: string | null;
  account_username: string | null;
  instagram_user_id: string;
  instagram_username: string | null;
  instagram_name: string | null;
  instagram_profile_picture_url: string | null;
  tags: string[];
  instagram_follower_count: number | null;
  is_user_follow_business: boolean | null;
  is_business_follow_user: boolean | null;
  follower_checked_at: string | null;
  first_contact_at: string;
  last_response_at: string | null;
  updated_at: string;
  last_automation_name: string | null;
  event_count: number;
  sent_count: number;
  pending_count: number;
  failed_count: number;
  last_event_at: string | null;
  last_event_type: string | null;
  last_event_text: string | null;
  last_queue_at: string | null;
  last_queue_status: string | null;
  last_queue_error: string | null;
  human_paused_at: string | null;
  human_paused_until: string | null;
  human_pause_reason: string | null;
};

export type ContentPublishType = "feed_image" | "feed_video" | "reel_video" | "story_image" | "story_video" | "carousel";

export type ContentMediaItem = {
  type: "image" | "video";
  url: string;
  cover_url?: string | null;
  container_id?: string | null;
  status?: "pending" | "processing" | "finished" | "failed";
  error?: string | null;
};

export type ContentPost = {
  id: string;
  account_id: string | null;
  account_username: string | null;
  publish_type: ContentPublishType;
  caption: string;
  media_url: string;
  cover_url: string | null;
  media_items: ContentMediaItem[];
  container_id: string | null;
  published_media_id: string | null;
  permalink: string | null;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed" | "canceled";
  last_error: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  title?: string;
  scheduled_at?: string | null;
  first_comment?: string;
  first_comment_id?: string | null;
  keyword?: string;
  dm_text?: string;
  link_url?: string;
  link_label?: string;
  public_reply?: string;
  automation_options?: { quickReplyLabel?: string; linkText?: string; reminderText?: string; publicReplies?: string[]; requireFollower?: boolean };
  automation_id?: string | null;
  source?: string;
  external_ref?: string | null;
  media_keys?: string[];
  media_deleted_at?: string | null;
  attempts?: number;
  insights?: Record<string, number>;
  insights_at?: string | null;
  publishing_started_at?: string | null;
  lock_until?: string | null;
  /** Hora do pedido de publicação à Meta (migração 0003; ausente se ela ainda não foi aplicada). */
  publish_requested_at?: string | null;
};
export type InboxConversationMessage = {
  id: string;
  direction: "inbound" | "outbound";
  label: string;
  body: string;
  status: string | null;
  created_at: string;
  comment_id: string | null;
  media_id: string | null;
  payload: Record<string, unknown>;
};
export type InboxEvent = RecentEvent & {
  instagram_user_id: string | null;
  instagram_comment_id: string | null;
  payload: Record<string, unknown>;
};
export async function ensureUserWorkspace(input: {
  userId: string;
  email: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}): Promise<WorkspaceContext> {
  const displayName = input.fullName || input.email.split("@")[0] || "UaiFlow";

  await query(
    `insert into public.profiles (user_id, email, full_name, avatar_url)
     values ($1, $2, $3, $4)
     on conflict (user_id) do update set
       email = excluded.email,
       full_name = coalesce(excluded.full_name, public.profiles.full_name),
       avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url)`,
    [input.userId, input.email, input.fullName ?? null, input.avatarUrl ?? null],
  );

  const { rows: workspaceRows } = await query<{ id: string; name: string; plan: string }>(
    `insert into public.workspaces (owner_user_id, name)
     values ($1, $2)
     on conflict (owner_user_id) do update set updated_at = now()
     returning id, name, plan`,
    [input.userId, `${displayName} - Espaco de trabalho`],
  );

  const workspace = workspaceRows[0];

  await query(
    `insert into public.workspace_members (workspace_id, user_id, role)
     values ($1, $2, 'owner')
     on conflict (workspace_id, user_id) do nothing`,
    [workspace.id, input.userId],
  );

  const { rows: profileRows } = await query<WorkspaceContext["profile"]>(
    "select user_id, email, full_name, avatar_url from public.profiles where user_id = $1",
    [input.userId],
  );

  return {
    profile: profileRows[0],
    workspace,
    role: "owner",
  };
}
const EMPTY_CONFIG: Config = {
  account_id: null,
  instagram_access_token: null,
  instagram_user_id: null,
  instagram_username: null,
  instagram_name: null,
  instagram_profile_picture_url: null,
  token_expires_at: null,
  webhook_subscribed_at: null,
};

export async function listInstagramAccounts(): Promise<InstagramAccount[]> {
  const { rows } = await query<InstagramAccount>(
    "select * from public.instagram_accounts order by is_default desc, created_at asc",
  );
  return rows;
}

/** Contas para as telas e para o navegador: sem token (U-SEG-01). Use esta, nunca a de cima, em página ou resposta de API. */
export async function listPublicInstagramAccounts(): Promise<PublicInstagramAccount[]> {
  return (await listInstagramAccounts()).map(toPublicInstagramAccount);
}

export async function getDefaultInstagramAccount(): Promise<InstagramAccount | null> {
  const { rows } = await query<InstagramAccount>(
    "select * from public.instagram_accounts order by is_default desc, created_at asc limit 1",
  );
  return rows[0] ?? null;
}

export async function getInstagramAccountById(accountId?: string | null): Promise<InstagramAccount | null> {
  if (!accountId) return getDefaultInstagramAccount();
  const { rows } = await query<InstagramAccount>("select * from public.instagram_accounts where id = $1", [accountId]);
  return rows[0] ?? null;
}

export async function getInstagramAccountByInstagramUserId(instagramUserId?: string | null): Promise<InstagramAccount | null> {
  if (!instagramUserId) return null;
  const { rows } = await query<InstagramAccount>(
    "select * from public.instagram_accounts where instagram_user_id = $1",
    [instagramUserId],
  );
  return rows[0] ?? null;
}

export async function setDefaultInstagramAccount(accountId: string) {
  await query("update public.instagram_accounts set is_default = false where id <> $1", [accountId]);
  const { rows } = await query<InstagramAccount>(
    "update public.instagram_accounts set is_default = true where id = $1 returning *",
    [accountId],
  );

  const account = rows[0] ?? null;
  if (account) await mirrorConfig(account);
  return account;
}

export async function getConfig(accountId?: string | null): Promise<Config> {
  const account = await getInstagramAccountById(accountId);
  if (account) return accountToConfig(account);

  const { rows } = await query<Omit<Config, "account_id">>(
    "select instagram_access_token, instagram_user_id, instagram_username, instagram_name, instagram_profile_picture_url, token_expires_at, webhook_subscribed_at from public.config where id = true",
  );

  return rows[0] ? { account_id: null, ...rows[0] } : EMPTY_CONFIG;
}

function accountToConfig(account: InstagramAccount): Config {
  return {
    account_id: account.id,
    instagram_access_token: account.instagram_access_token,
    instagram_user_id: account.instagram_user_id,
    instagram_username: account.instagram_username,
    instagram_name: account.instagram_name,
    instagram_profile_picture_url: account.instagram_profile_picture_url,
    token_expires_at: account.token_expires_at,
    webhook_subscribed_at: account.webhook_subscribed_at,
  };
}

async function mirrorConfig(account: InstagramAccount) {
  await query(
    `insert into public.config (
      id, instagram_access_token, instagram_user_id, instagram_username,
      instagram_name, instagram_profile_picture_url, token_expires_at, webhook_subscribed_at
    ) values (true, $1, $2, $3, $4, $5, $6, $7)
    on conflict (id) do update set
      instagram_access_token = excluded.instagram_access_token,
      instagram_user_id = excluded.instagram_user_id,
      instagram_username = excluded.instagram_username,
      instagram_name = excluded.instagram_name,
      instagram_profile_picture_url = excluded.instagram_profile_picture_url,
      token_expires_at = excluded.token_expires_at,
      webhook_subscribed_at = excluded.webhook_subscribed_at`,
    [
      account.instagram_access_token,
      account.instagram_user_id,
      account.instagram_username,
      account.instagram_name,
      account.instagram_profile_picture_url,
      account.token_expires_at,
      account.webhook_subscribed_at,
    ],
  );
}
export async function getProfileSettings(accountId?: string | null): Promise<ProfileSettings> {
  const resolvedAccountId = accountId ?? (await getDefaultInstagramAccount())?.id ?? null;

  if (resolvedAccountId) {
    const { rows } = await query<ProfileSettings>(
      "select * from public.profile_settings where account_id = $1",
      [resolvedAccountId],
    );

    if (rows[0]) return normalizeProfileSettings(rows[0]);

    const { rows: created } = await query<ProfileSettings>(
      "insert into public.profile_settings (id, account_id) values (true, $1) on conflict (account_id) do update set updated_at = now() returning *",
      [resolvedAccountId],
    );

    return normalizeProfileSettings(created[0]);
  }

  const { rows } = await query<ProfileSettings>(
    "select * from public.profile_settings where account_id is null limit 1",
  );

  if (rows[0]) return normalizeProfileSettings(rows[0]);

  const { rows: created } = await query<ProfileSettings>(
    "insert into public.profile_settings (id, account_id) values (true, null) returning *",
  );

  return normalizeProfileSettings(created[0]);
}

export async function updateProfileSettings(input: Partial<ProfileSettings>, accountId?: string | null) {
  const current = await getProfileSettings(accountId);
  const next = {
    ...current,
    ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
  } as ProfileSettings;

  const { rows } = await query<ProfileSettings>(
    `insert into public.profile_settings (
      id, account_id, channel_active, default_automation_id, opt_in_automation_id,
      opt_out_automation_id, story_mention_automation_id, persistent_menu_items, ice_breakers
    ) values (true, $1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (account_id) do update set
      channel_active = excluded.channel_active,
      default_automation_id = excluded.default_automation_id,
      opt_in_automation_id = excluded.opt_in_automation_id,
      opt_out_automation_id = excluded.opt_out_automation_id,
      story_mention_automation_id = excluded.story_mention_automation_id,
      persistent_menu_items = excluded.persistent_menu_items,
      ice_breakers = excluded.ice_breakers
    returning *`,
    [
      next.account_id,
      next.channel_active,
      next.default_automation_id,
      next.opt_in_automation_id,
      next.opt_out_automation_id,
      next.story_mention_automation_id,
      JSON.stringify(next.persistent_menu_items ?? []),
      JSON.stringify(next.ice_breakers ?? []),
    ],
  );

  return normalizeProfileSettings(rows[0]);
}

export async function markProfileSettingSynced(kind: "persistent_menu" | "ice_breakers", accountId?: string | null) {
  const settings = await getProfileSettings(accountId);
  const column = kind === "persistent_menu" ? "persistent_menu_synced_at" : "ice_breakers_synced_at";
  await query(`update public.profile_settings set ${column} = now() where account_id is not distinct from $1`, [settings.account_id]);
}
export async function saveInstagramConfig(input: {
  accessToken: string;
  userId: string;
  username: string;
  name?: string | null;
  profilePictureUrl?: string | null;
  expiresAt?: Date | null;
  webhookSubscribedAt?: Date | null;
}) {
  // Conectar uma conta NÃO tira a conta padrão atual: a nova só vira padrão se ainda não houver nenhuma.
  // (Para trocar a principal, use o botão da tela Perfis.)
  const { rows: otherDefault } = await query<{ exists: boolean }>(
    "select exists (select 1 from public.instagram_accounts where is_default and instagram_user_id <> $1) as exists",
    [input.userId],
  );
  const becomesDefault = !otherDefault[0]?.exists;

  const { rows } = await query<InstagramAccount>(
    `insert into public.instagram_accounts (
      instagram_access_token, instagram_user_id, instagram_username,
      instagram_name, instagram_profile_picture_url, token_expires_at,
      webhook_subscribed_at, is_default
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (instagram_user_id) do update set
      instagram_access_token = excluded.instagram_access_token,
      instagram_username = excluded.instagram_username,
      instagram_name = excluded.instagram_name,
      instagram_profile_picture_url = excluded.instagram_profile_picture_url,
      token_expires_at = excluded.token_expires_at,
      webhook_subscribed_at = excluded.webhook_subscribed_at,
      is_default = public.instagram_accounts.is_default or excluded.is_default
    returning *`,
    [
      input.accessToken,
      input.userId,
      input.username,
      input.name ?? null,
      input.profilePictureUrl ?? null,
      input.expiresAt ?? null,
      input.webhookSubscribedAt ?? null,
      becomesDefault,
    ],
  );

  const account = rows[0];
  if (account.is_default) await mirrorConfig(account);
  await getProfileSettings(account.id);
  return account;
}

export async function updateToken(input: { accessToken: string; expiresAt: Date; accountId?: string | null }) {
  const account = await getInstagramAccountById(input.accountId);
  if (account) {
    const { rows } = await query<InstagramAccount>(
      `update public.instagram_accounts
       set instagram_access_token = $1, token_expires_at = $2, last_token_refresh_at = now()
       where id = $3
       returning *`,
      [input.accessToken, input.expiresAt, account.id],
    );

    if (rows[0]?.is_default) await mirrorConfig(rows[0]);
    return;
  }

  await query(
    `update public.config
     set instagram_access_token = $1, token_expires_at = $2, last_token_refresh_at = now()
     where id = true`,
    [input.accessToken, input.expiresAt],
  );
}
export async function listAutomations(accountId?: string | null): Promise<Automation[]> {
  if (accountId) {
    const { rows } = await query<Automation>(
      "select * from public.automations where account_id = $1 order by created_at desc",
      [accountId],
    );
    return rows;
  }

  const { rows } = await query<Automation>(
    "select * from public.automations order by created_at desc",
  );
  return rows;
}

export async function getAutomation(id: string, accountId?: string | null): Promise<Automation | null> {
  const { rows } = await query<Automation>(
    accountId ? "select * from public.automations where id = $1 and account_id = $2" : "select * from public.automations where id = $1",
    accountId ? [id, accountId] : [id],
  );
  return rows[0] ?? null;
}

export async function createAutomation(input: Partial<Automation>) {
  const accountId = input.account_id ?? (await getDefaultInstagramAccount())?.id ?? null;
  const replyDelaySeconds = positiveInteger(input.reply_delay_seconds ?? 0);
  const replyDelayRange = normalizeDelayRange(
    input.reply_delay_min_seconds ?? replyDelaySeconds,
    input.reply_delay_max_seconds ?? replyDelaySeconds,
  );
  const reminderDelaySeconds = positiveInteger(input.reminder_delay_seconds ?? (input.reminder_delay_minutes ?? 1440) * 60);
  const reminderDelayRange = normalizeDelayRange(
    input.reminder_delay_min_seconds ?? reminderDelaySeconds,
    input.reminder_delay_max_seconds ?? reminderDelaySeconds,
  );

  const { rows } = await query<Automation>(
    `insert into public.automations (
      account_id, name, active, triggers, keywords, match_type, post_id, public_replies,
      public_reply_mode, welcome_dm, quick_reply_label, quick_replies, link_text, link_button_label,
      link_url, reply_delay_seconds, reply_delay_mode, reply_delay_min_seconds, reply_delay_max_seconds,
      reminder_text, reminder_delay_minutes, reminder_delay_seconds, reminder_delay_mode,
      reminder_delay_min_seconds, reminder_delay_max_seconds, require_follower, non_follower_dm,
      non_follower_button_label, follower_confirmation_text, follower_confirmation_greetings, flow_nodes, flow_edges
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
    returning *`,
    [
      accountId,
      input.name || "Nova automacao",
      input.active ?? true,
      input.triggers?.length ? input.triggers : ["comments"],
      input.keywords ?? [],
      input.match_type || "contains",
      input.post_id || null,
      input.public_replies ?? [],
      input.public_reply_mode || "random",
      input.welcome_dm || "Oi! Toque no botao abaixo para receber o link.",
      input.quick_reply_label || "Quero receber",
      JSON.stringify(input.quick_replies ?? []),
      input.link_text || "Aqui esta o link que voce pediu:",
      input.link_button_label || "Abrir link",
      input.link_url || "",
      replyDelaySeconds,
      input.reply_delay_mode || "fixed",
      replyDelayRange.min,
      replyDelayRange.max,
      input.reminder_text || "Passando para lembrar do link que te enviei.",
      Math.floor(reminderDelaySeconds / 60),
      reminderDelaySeconds,
      input.reminder_delay_mode || "fixed",
      reminderDelayRange.min,
      reminderDelayRange.max,
      input.require_follower ?? false,
      input.non_follower_dm || "Primeiro precisa me seguir para receber o acesso, depois que me seguir digite novamente a palavra que enviou acima.",
      input.non_follower_button_label || "Seguir no Insta",
      input.follower_confirmation_text || "Digite Eu Quero aqui em baixo para liberar.",
      normalizeStringList(input.follower_confirmation_greetings, defaultFollowerConfirmationGreetings),
      JSON.stringify(input.flow_nodes ?? []),
      JSON.stringify(input.flow_edges ?? []),
    ],
  );

  await syncFollowups(rows[0]);
  return rows[0];
}

export async function updateAutomation(id: string, input: Partial<Automation>) {
  const current = await getAutomation(id);
  if (!current) return null;

  const cleanInput = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<Automation>;

  const next: Automation = {
    ...current,
    ...cleanInput,
    triggers: cleanInput.triggers?.length ? cleanInput.triggers : current.triggers,
    keywords: cleanInput.keywords ?? current.keywords,
    public_replies: cleanInput.public_replies ?? current.public_replies,
    public_reply_mode: cleanInput.public_reply_mode ?? current.public_reply_mode ?? "random",
    reply_delay_mode: cleanInput.reply_delay_mode ?? current.reply_delay_mode ?? "fixed",
    reminder_delay_mode: cleanInput.reminder_delay_mode ?? current.reminder_delay_mode ?? "fixed",
    post_id: cleanInput.post_id === undefined ? current.post_id : cleanInput.post_id,
  };
  next.reply_delay_seconds = positiveInteger(next.reply_delay_seconds ?? 0);
  const replyDelayRange = normalizeDelayRange(next.reply_delay_min_seconds ?? next.reply_delay_seconds, next.reply_delay_max_seconds ?? next.reply_delay_seconds);
  next.reply_delay_min_seconds = replyDelayRange.min;
  next.reply_delay_max_seconds = replyDelayRange.max;
  next.reminder_delay_seconds = positiveInteger(next.reminder_delay_seconds ?? next.reminder_delay_minutes * 60);
  next.reminder_delay_minutes = Math.floor(next.reminder_delay_seconds / 60);
  const reminderDelayRange = normalizeDelayRange(next.reminder_delay_min_seconds ?? next.reminder_delay_seconds, next.reminder_delay_max_seconds ?? next.reminder_delay_seconds);
  next.reminder_delay_min_seconds = reminderDelayRange.min;
  next.reminder_delay_max_seconds = reminderDelayRange.max;

  const { rows } = await query<Automation>(
    `update public.automations set
      name = $2,
      active = $3,
      triggers = $4,
      keywords = $5,
      match_type = $6,
      post_id = $7,
      public_replies = $8,
      public_reply_mode = $9,
      welcome_dm = $10,
      quick_reply_label = $11,
      quick_replies = $12,
      link_text = $13,
      link_button_label = $14,
      link_url = $15,
      reply_delay_seconds = $16,
      reply_delay_mode = $17,
      reply_delay_min_seconds = $18,
      reply_delay_max_seconds = $19,
      reminder_text = $20,
      reminder_delay_minutes = $21,
      reminder_delay_seconds = $22,
      reminder_delay_mode = $23,
      reminder_delay_min_seconds = $24,
      reminder_delay_max_seconds = $25,
      require_follower = $26,
      non_follower_dm = $27,
      non_follower_button_label = $28,
      follower_confirmation_text = $29,
      follower_confirmation_greetings = $30,
      flow_nodes = $31,
      flow_edges = $32
     where id = $1
     returning *`,
    [
      id,
      next.name,
      next.active,
      next.triggers,
      next.keywords,
      next.match_type,
      next.post_id,
      next.public_replies,
      next.public_reply_mode,
      next.welcome_dm,
      next.quick_reply_label,
      JSON.stringify(next.quick_replies ?? []),
      next.link_text,
      next.link_button_label,
      next.link_url,
      next.reply_delay_seconds,
      next.reply_delay_mode,
      next.reply_delay_min_seconds,
      next.reply_delay_max_seconds,
      next.reminder_text,
      next.reminder_delay_minutes,
      next.reminder_delay_seconds,
      next.reminder_delay_mode,
      next.reminder_delay_min_seconds,
      next.reminder_delay_max_seconds,
      next.require_follower,
      next.non_follower_dm,
      next.non_follower_button_label,
      next.follower_confirmation_text,
      normalizeStringList(next.follower_confirmation_greetings, defaultFollowerConfirmationGreetings),
      JSON.stringify(next.flow_nodes ?? []),
      JSON.stringify(next.flow_edges ?? []),
    ],
  );

  if (rows[0]) await syncFollowups(rows[0]);
  return rows[0] ?? null;
}

export async function deleteAutomation(id: string) {
  await query("delete from public.automations where id = $1", [id]);
}

export async function syncFollowups(automation: Automation) {
  await query("delete from public.followups where automation_id = $1", [automation.id]);

  if (automation.link_text || automation.link_url) {
    await query(
      `insert into public.followups (automation_id, step_order, message_type, body, button_label, url, delay_minutes, delay_seconds, delay_mode, delay_min_seconds, delay_max_seconds)
       values ($1, 1, 'link', $2, $3, $4, 0, 0, 'fixed', 0, 0)`,
      [automation.id, automation.link_text, automation.link_button_label, automation.link_url],
    );
  }

  if (automation.reminder_text) {
    const reminderDelaySeconds = positiveInteger(automation.reminder_delay_seconds ?? automation.reminder_delay_minutes * 60);
    const reminderDelayRange = normalizeDelayRange(
      automation.reminder_delay_min_seconds ?? reminderDelaySeconds,
      automation.reminder_delay_max_seconds ?? reminderDelaySeconds,
    );
    await query(
      `insert into public.followups (automation_id, step_order, message_type, body, delay_minutes, delay_seconds, delay_mode, delay_min_seconds, delay_max_seconds)
       values ($1, 2, 'reminder', $2, $3, $4, $5, $6, $7)`,
      [
        automation.id,
        automation.reminder_text,
        Math.floor(reminderDelaySeconds / 60),
        reminderDelaySeconds,
        automation.reminder_delay_mode || "fixed",
        reminderDelayRange.min,
        reminderDelayRange.max,
      ],
    );
  }
}

function normalizeStringList(value: string[] | null | undefined, fallback: string[]) {
  const items = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  return items.length ? items : fallback;
}
function positiveInteger(value: number | null | undefined) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function normalizeDelayRange(minValue: number | null | undefined, maxValue: number | null | undefined) {
  const min = positiveInteger(minValue);
  const max = positiveInteger(maxValue);
  return min <= max ? { min, max } : { min: max, max: min };
}
function parseAutomationPostIds(value: string | null | undefined) {
  return Array.from(new Set(String(value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)));
}

export async function findMatchingAutomations(input: {
  accountId?: string | null;
  trigger: AutomationTrigger;
  text: string;
  postId?: string | null;
}): Promise<Automation[]> {
  const automations = await listAutomations(input.accountId);
  const text = normalize(input.text);

  return automations.filter((automation) => {
    if (!automation.active || !automation.triggers.includes(input.trigger)) return false;
    if (input.accountId && automation.account_id !== input.accountId) return false;
    const configuredPostIds = parseAutomationPostIds(automation.post_id);
    if (configuredPostIds.length && (!input.postId || !configuredPostIds.includes(input.postId))) return false;
    if (automation.match_type === "any") return true;

    const keywords = automation.keywords.map(normalize).filter(Boolean);
    if (!keywords.length) return false;

    if (automation.match_type === "exact") {
      return keywords.some((keyword) => text === keyword);
    }

    return keywords.some((keyword) => text.includes(keyword));
  });
}
export async function upsertContact(input: {
  accountId?: string | null;
  instagramUserId: string;
  instagramUsername?: string | null;
  instagramName?: string | null;
  instagramProfilePictureUrl?: string | null;
  instagramFollowerCount?: number | null;
  isUserFollowBusiness?: boolean | null;
  isBusinessFollowUser?: boolean | null;
  followerCheckedAt?: Date | null;
  lastAutomationId?: string | null;
  markResponse?: boolean;
}) {
  const accountId = input.accountId ?? (await getDefaultInstagramAccount())?.id ?? null;
  const { rows } = await query<{ id: string }>(
    `insert into public.contacts (
      account_id, instagram_user_id, instagram_username, instagram_name, instagram_profile_picture_url,
      instagram_follower_count, is_user_follow_business, is_business_follow_user,
      follower_checked_at, last_response_at, last_automation_id
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    on conflict (account_id, instagram_user_id) do update set
      instagram_username = coalesce(excluded.instagram_username, public.contacts.instagram_username),
      instagram_name = coalesce(excluded.instagram_name, public.contacts.instagram_name),
      instagram_profile_picture_url = coalesce(excluded.instagram_profile_picture_url, public.contacts.instagram_profile_picture_url),
      instagram_follower_count = coalesce(excluded.instagram_follower_count, public.contacts.instagram_follower_count),
      is_user_follow_business = coalesce(excluded.is_user_follow_business, public.contacts.is_user_follow_business),
      is_business_follow_user = coalesce(excluded.is_business_follow_user, public.contacts.is_business_follow_user),
      follower_checked_at = coalesce(excluded.follower_checked_at, public.contacts.follower_checked_at),
      last_response_at = coalesce(excluded.last_response_at, public.contacts.last_response_at),
      last_automation_id = coalesce(excluded.last_automation_id, public.contacts.last_automation_id)
    returning id`,
    [
      accountId,
      input.instagramUserId,
      input.instagramUsername ?? null,
      input.instagramName ?? null,
      input.instagramProfilePictureUrl ?? null,
      input.instagramFollowerCount ?? null,
      input.isUserFollowBusiness ?? null,
      input.isBusinessFollowUser ?? null,
      input.followerCheckedAt ?? null,
      input.markResponse ? new Date() : null,
      input.lastAutomationId ?? null,
    ],
  );

  return rows[0].id;
}

export async function getContactAutomationState(contactId: string): Promise<{ last_automation_id: string | null; is_user_follow_business: boolean | null } | null> {
  const { rows } = await query<{ last_automation_id: string | null; is_user_follow_business: boolean | null }>(
    "select last_automation_id, is_user_follow_business from public.contacts where id = $1",
    [contactId],
  );

  return rows[0] ?? null;
}

export async function setContactOptOut(contactId: string, optedOut: boolean) {
  await query(
    "update public.contacts set opted_out_at = $2, updated_at = now() where id = $1",
    [contactId, optedOut ? new Date() : null],
  );
}

export async function setContactHumanPause(input: { contactId: string; paused: boolean; until?: Date | null; reason?: string | null }) {
  await query(
    `update public.contacts
     set human_paused_at = $2,
         human_paused_until = $3,
         human_pause_reason = $4,
         updated_at = now()
     where id = $1`,
    [input.contactId, input.paused ? new Date() : null, input.paused ? input.until ?? null : null, input.paused ? input.reason ?? "Atendimento humano" : null],
  );
}

export type ManualMessageTarget = {
  contact_id: string;
  account_id: string | null;
  recipient_id: string;
  sender_id: string | null;
  access_token: string | null;
};

export async function getManualMessageTarget(contactId: string): Promise<ManualMessageTarget | null> {
  const { rows } = await query<ManualMessageTarget>(
    `select
       c.id as contact_id,
       ia.id as account_id,
       c.instagram_user_id as recipient_id,
       ia.instagram_user_id as sender_id,
       ia.instagram_access_token as access_token
     from public.contacts c
     left join lateral (
       select *
       from public.instagram_accounts ia
       where ia.id = c.account_id or (c.account_id is null and ia.is_default = true)
       order by (ia.id = c.account_id) desc, ia.is_default desc, ia.created_at asc
       limit 1
     ) ia on true
     where c.id = $1`,
    [contactId],
  );

  return rows[0] ?? null;
}

export async function recordManualOutboundMessage(input: {
  accountId?: string | null;
  contactId: string;
  instagramRecipientId: string;
  text: string;
  graphResponse?: unknown;
}) {
  const { rows } = await query<{ id: string }>(
    `insert into public.queue (
      account_id, contact_id, instagram_recipient_id, send_type, payload,
      available_at, status, attempts, sent_at
    ) values ($1,$2,$3,'dm',$4,now(),'sent',1,now())
    returning id`,
    [
      input.accountId ?? null,
      input.contactId,
      input.instagramRecipientId,
      JSON.stringify({
        text: input.text,
        source: "manual",
        graphResponse: input.graphResponse ?? null,
      }),
    ],
  );

  return rows[0].id;
}
export async function isContactAutomationPaused(contactId: string) {
  const { rows } = await query<{ paused: boolean }>(
    `select human_paused_at is not null
       and (human_paused_until is null or human_paused_until > now()) as paused
     from public.contacts
     where id = $1`,
    [contactId],
  );

  return rows[0]?.paused === true;
}
export async function recordEvent(input: {
  accountId?: string | null;
  eventType: string;
  instagramEventId?: string | null;
  instagramUserId?: string | null;
  instagramUsername?: string | null;
  instagramCommentId?: string | null;
  instagramMediaId?: string | null;
  payload: unknown;
}) {
  const { rows } = await query<{ id: string }>(
    `insert into public.events (
      account_id, event_type, instagram_event_id, instagram_user_id, instagram_username,
      instagram_comment_id, instagram_media_id, payload
    ) values ($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict (account_id, instagram_event_id) where instagram_event_id is not null
    do update set payload = excluded.payload
    returning id`,
    [
      input.accountId ?? null,
      input.eventType,
      input.instagramEventId ?? null,
      input.instagramUserId ?? null,
      input.instagramUsername ?? null,
      input.instagramCommentId ?? null,
      input.instagramMediaId ?? null,
      JSON.stringify(input.payload),
    ],
  );

  return rows[0].id;
}
export async function enqueueJob(input: {
  accountId?: string | null;
  eventId?: string | null;
  contactId?: string | null;
  automationId?: string | null;
  instagramRecipientId?: string | null;
  instagramCommentId?: string | null;
  sendType: SendType;
  payload: Record<string, unknown>;
  availableAt?: Date;
}) {
  const contactPaused = input.contactId ? await isContactAutomationPaused(input.contactId) : false;
  const blockedByHumanPause = contactPaused && input.sendType !== "public_reply";

  await query(
    `insert into public.queue (
      account_id, event_id, contact_id, automation_id, instagram_recipient_id,
      instagram_comment_id, send_type, payload, available_at, status, last_error
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    on conflict do nothing`,
    [
      input.accountId ?? null,
      input.eventId ?? null,
      input.contactId ?? null,
      input.automationId ?? null,
      input.instagramRecipientId ?? null,
      input.instagramCommentId ?? null,
      input.sendType,
      JSON.stringify(input.payload),
      input.availableAt ?? new Date(),
      blockedByHumanPause ? "skipped" : "pending",
      blockedByHumanPause ? "Contato pausado para atendimento humano" : null,
    ],
  );
}

export async function enqueueFollowups(input: {
  accountId?: string | null;
  automationId: string;
  contactId: string;
  instagramRecipientId: string;
  eventId?: string | null;
}) {
  const { rows } = await query<{
    message_type: string;
    body: string;
    button_label: string | null;
    url: string | null;
    delay_minutes: number;
    delay_seconds: number;
    delay_mode: DelayMode;
    delay_min_seconds: number;
    delay_max_seconds: number;
  }>(
    `select message_type, body, button_label, url, delay_minutes, delay_seconds, delay_mode, delay_min_seconds, delay_max_seconds
     from public.followups
     where automation_id = $1 and active = true
     order by step_order asc`,
    [input.automationId],
  );

  for (const followup of rows) {
    const delaySeconds = resolveDelaySeconds({
      mode: followup.delay_mode,
      fixedSeconds: followup.delay_seconds || followup.delay_minutes * 60,
      minSeconds: followup.delay_min_seconds,
      maxSeconds: followup.delay_max_seconds,
    });
    const availableAt = new Date(Date.now() + delaySeconds * 1000);
    await enqueueJob({
      accountId: input.accountId,
      eventId: input.eventId,
      contactId: input.contactId,
      automationId: input.automationId,
      instagramRecipientId: input.instagramRecipientId,
      sendType: "dm",
      availableAt,
      payload: {
        type: followup.message_type,
        text: followup.body,
        buttonLabel: followup.button_label,
        url: followup.url,
      },
    });
  }
}
function resolveDelaySeconds(input: {
  mode?: DelayMode | null;
  fixedSeconds?: number | null;
  minSeconds?: number | null;
  maxSeconds?: number | null;
}) {
  const fixedSeconds = positiveInteger(input.fixedSeconds ?? 0);
  if (input.mode !== "random") return fixedSeconds;
  const range = normalizeDelayRange(input.minSeconds ?? fixedSeconds, input.maxSeconds ?? fixedSeconds);
  if (range.max <= range.min) return range.min;
  return range.min + Math.floor(Math.random() * (range.max - range.min + 1));
}
export async function getTemplateContext(input: {
  contactId?: string | null;
  automationId?: string | null;
}): Promise<TemplateContext> {
  const { rows } = await query<{
    instagram_user_id: string | null;
    instagram_username: string | null;
    instagram_name: string | null;
    is_user_follow_business: boolean | null;
    automation_name: string | null;
  }>(
    `select c.instagram_user_id, c.instagram_username, c.instagram_name,
            c.is_user_follow_business, a.name as automation_name
     from (select $1::uuid as contact_id, $2::uuid as automation_id) input
     left join public.contacts c on c.id = input.contact_id
     left join public.automations a on a.id = input.automation_id`,
    [input.contactId ?? null, input.automationId ?? null],
  );

  const row = rows[0];
  const username = row?.instagram_username ?? "";
  const name = row?.instagram_name || username;

  return {
    username,
    name,
    first_name: name.split(/\s+/)[0] || username,
    instagram_user_id: row?.instagram_user_id ?? "",
    is_follower: row?.is_user_follow_business === true ? "sim" : row?.is_user_follow_business === false ? "nao" : "desconhecido",
    automation_name: row?.automation_name ?? "",
    profile_url: username ? `https://www.instagram.com/${username}` : "https://www.instagram.com/",
  };
}

export async function listContentPosts(limit = 50, accountId?: string | null): Promise<ContentPost[]> {
  const { rows } = await query<ContentPost>(
    `select cp.*, ia.instagram_username as account_username
     from public.content_posts cp
     left join public.instagram_accounts ia on ia.id = cp.account_id
     where ($2::uuid is null or cp.account_id = $2)
     order by coalesce(cp.scheduled_at, cp.published_at, cp.created_at) desc
     limit $1`,
    [limit, accountId ?? null],
  );

  return rows;
}

export async function createContentPost(input: {
  accountId?: string | null;
  publishType: ContentPublishType;
  caption: string;
  mediaUrl: string;
  coverUrl?: string | null;
  mediaItems?: ContentMediaItem[];
}) {
  const accountId = input.accountId ?? (await getDefaultInstagramAccount())?.id ?? null;
  const { rows } = await query<ContentPost>(
    `insert into public.content_posts (account_id, publish_type, caption, media_url, cover_url, media_items, status)
     values ($1, $2, $3, $4, $5, $6, 'publishing')
     returning *`,
    [accountId, input.publishType, input.caption, input.mediaUrl, input.coverUrl ?? null, JSON.stringify(input.mediaItems ?? [])],
  );

  return rows[0];
}

export async function updateContentPostStatus(input: {
  id: string;
  status: ContentPost["status"];
  containerId?: string | null;
  publishedMediaId?: string | null;
  permalink?: string | null;
  lastError?: string | null;
  publishedAt?: Date | null;
}) {
  const { rows } = await query<ContentPost>(
    `update public.content_posts
     set status = $2,
         container_id = coalesce($3, container_id),
         published_media_id = coalesce($4, published_media_id),
         permalink = coalesce($5, permalink),
         last_error = $6,
         published_at = coalesce($7, published_at)
     where id = $1
     returning *`,
    [
      input.id,
      input.status,
      input.containerId ?? null,
      input.publishedMediaId ?? null,
      input.permalink ?? null,
      input.lastError ?? null,
      input.publishedAt ?? null,
    ],
  );

  return rows[0] ?? null;
}
export async function updateContentPostMediaItems(id: string, mediaItems: ContentMediaItem[]) {
  const { rows } = await query<ContentPost>(
    `update public.content_posts
     set media_items = $2, updated_at = now()
     where id = $1
     returning *`,
    [id, JSON.stringify(mediaItems)],
  );

  return rows[0] ?? null;
}
export async function listFlowLogs(limit = 80, accountId?: string | null): Promise<FlowLog[]> {
  const { rows } = await query<FlowLog>(
    `select q.id, q.automation_id, a.name as automation_name,
            c.instagram_username, c.instagram_user_id, q.send_type, q.status,
            q.last_error, q.created_at, q.sent_at
     from public.queue q
     left join public.automations a on a.id = q.automation_id
     left join public.contacts c on c.id = q.contact_id
     where ($2::uuid is null or q.account_id = $2)
     order by q.created_at desc
     limit $1`,
    [limit, accountId ?? null],
  );

  return rows;
}export async function claimQueueJobs(limit = 20): Promise<QueueJob[]> {
  const { rows } = await query<QueueJob>("select * from public.claim_queue_jobs($1)", [limit]);
  return rows;
}

/** Jobs que ficaram em "sending" (a função caiu no meio) voltam para a fila depois de 10 min. */
export async function recoverStaleQueueJobs() {
  await query(
    `update public.queue
     set status = case when attempts >= 3 then 'failed' else 'pending' end,
         claimed_at = null,
         last_error = coalesce(last_error, 'Envio interrompido; tentando de novo')
     where status = 'sending' and claimed_at < now() - interval '10 minutes'`,
  );
}

/** Devolve jobs pegos mas não enviados (faltou tempo), sem contar como tentativa. */
export async function releaseQueueJobs(ids: string[]) {
  if (!ids.length) return;
  await query(
    "update public.queue set status = 'pending', claimed_at = null, attempts = greatest(attempts - 1, 0) where id = any($1::uuid[]) and status = 'sending'",
    [ids],
  );
}

export async function markJobSent(id: string) {
  await query("update public.queue set status = 'sent', sent_at = now(), last_error = null where id = $1", [id]);
}

export async function markJobFailed(id: string, error: string) {
  await query(
    `update public.queue
     set status = case when attempts >= 3 then 'failed' else 'pending' end,
         claimed_at = null,
         last_error = $2,
         available_at = now() + interval '5 minutes'
     where id = $1`,
    [id, error.slice(0, 500)],
  );
}

export async function markExpiredDmsSkipped() {
  await query(
    `update public.queue q
     set status = 'skipped', last_error = '24h window expired'
     from public.contacts c
     where q.contact_id = c.id
       and q.status = 'pending'
       and q.send_type = 'dm'
       and (c.last_response_at is null or c.last_response_at < now() - interval '24 hours')`,
  );

  await query(
    `update public.queue q
     set status = 'skipped', last_error = 'Contato pausado para atendimento humano'
     from public.contacts c
     where q.contact_id = c.id
       and q.status = 'pending'
       and q.send_type in ('dm', 'private_reply')
       and c.human_paused_at is not null
       and (c.human_paused_until is null or c.human_paused_until > now())`,
  );
}

export async function sentDmCountLastHour(accountId?: string | null) {
  const { rows } = await query<{ count: string }>(
    accountId
      ? "select count(*) from public.queue where account_id = $1 and status = 'sent' and send_type in ('dm', 'private_reply') and sent_at >= now() - interval '1 hour'"
      : "select count(*) from public.queue where status = 'sent' and send_type in ('dm', 'private_reply') and sent_at >= now() - interval '1 hour'",
    accountId ? [accountId] : [],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listContacts(limit = 50, accountId?: string | null): Promise<ContactSummary[]> {
  const { rows } = await query<ContactSummary>(
    `select c.id, c.account_id, ia.instagram_username as account_username,
            c.instagram_user_id, c.instagram_username, c.instagram_name,
            c.instagram_profile_picture_url, c.tags, c.instagram_follower_count,
            c.is_user_follow_business, c.is_business_follow_user, c.follower_checked_at,
            c.first_contact_at, c.last_response_at, c.updated_at,
            c.human_paused_at, c.human_paused_until, c.human_pause_reason,
            a.name as last_automation_name,
            coalesce(ev.event_count, 0)::int as event_count,
            coalesce(q.sent_count, 0)::int as sent_count,
            coalesce(q.pending_count, 0)::int as pending_count,
            coalesce(q.failed_count, 0)::int as failed_count,
            ev.last_event_at, ev.last_event_type, ev.last_event_text,
            q.last_queue_at, q.last_queue_status, q.last_queue_error
     from public.contacts c
     left join public.instagram_accounts ia on ia.id = c.account_id
     left join public.automations a on a.id = c.last_automation_id
     left join lateral (
       select count(*) as event_count,
              max(e.received_at) as last_event_at,
              (array_agg(e.event_type order by e.received_at desc))[1] as last_event_type,
              (array_agg(coalesce(e.payload #>> '{change,value,text}', e.payload #>> '{event,message,text}', e.payload #>> '{event,postback,title}') order by e.received_at desc))[1] as last_event_text
       from public.events e
       where e.account_id is not distinct from c.account_id
         and e.instagram_user_id = c.instagram_user_id
     ) ev on true
     left join lateral (
       select count(*) filter (where q.status = 'sent') as sent_count,
              count(*) filter (where q.status = 'pending') as pending_count,
              count(*) filter (where q.status = 'failed') as failed_count,
              max(q.created_at) as last_queue_at,
              (array_agg(q.status order by q.created_at desc))[1] as last_queue_status,
              (array_agg(q.last_error order by q.created_at desc))[1] as last_queue_error
       from public.queue q
       where q.account_id is not distinct from c.account_id
         and q.contact_id = c.id
     ) q on true
     where ($2::uuid is null or c.account_id = $2)
     order by greatest(coalesce(ev.last_event_at, c.first_contact_at), coalesce(q.last_queue_at, c.first_contact_at), c.updated_at) desc
     limit $1`,
    [limit, accountId ?? null],
  );

  return rows;
}


export async function addContactTag(contactId: string, tag: string) {
  const cleanTag = normalizeContactTag(tag);
  if (!cleanTag) return;

  const { rows } = await query<{ tags: string[] | null }>("select tags from public.contacts where id = $1", [contactId]);
  const tags = normalizeTags(rows[0]?.tags);
  if (!tags.some((value) => value.toLowerCase() === cleanTag.toLowerCase())) {
    tags.push(cleanTag);
  }

  await query("update public.contacts set tags = $2, updated_at = now() where id = $1", [contactId, tags]);
}

export async function removeContactTag(contactId: string, tag: string) {
  const cleanTag = normalizeContactTag(tag);
  if (!cleanTag) return;

  const { rows } = await query<{ tags: string[] | null }>("select tags from public.contacts where id = $1", [contactId]);
  const tags = normalizeTags(rows[0]?.tags).filter((value) => value.toLowerCase() !== cleanTag.toLowerCase());
  await query("update public.contacts set tags = $2, updated_at = now() where id = $1", [contactId, tags]);
}

export async function getInboxConversation(contactId: string | null | undefined, accountId?: string | null): Promise<{ contact: ContactSummary | null; messages: InboxConversationMessage[] }> {
  if (!contactId) return { contact: null, messages: [] };

  const contacts = await listContacts(250, accountId);
  const contact = contacts.find((item) => item.id === contactId) ?? null;
  if (!contact) return { contact: null, messages: [] };

  const [events, jobs] = await Promise.all([
    query<InboxEvent>(
      `select id, event_type, instagram_user_id, instagram_username, instagram_comment_id,
              instagram_media_id, payload, received_at
       from public.events
       where account_id is not distinct from $1
         and instagram_user_id = $2
       order by received_at desc
       limit 140`,
      [contact.account_id, contact.instagram_user_id],
    ),
    query<{
      id: string;
      send_type: SendType;
      status: string;
      instagram_comment_id: string | null;
      payload: Record<string, unknown>;
      created_at: string;
      sent_at: string | null;
      last_error: string | null;
    }>(
      `select id, send_type, status, instagram_comment_id, payload, created_at, sent_at, last_error
       from public.queue
       where contact_id = $1
       order by coalesce(sent_at, created_at) desc
       limit 140`,
      [contact.id],
    ),
  ]);

  const inboundMessages = events.rows.map<InboxConversationMessage>((event) => ({
    id: event.id,
    direction: "inbound",
    label: event.event_type,
    body: payloadText(event.payload) || "Evento recebido sem texto.",
    status: null,
    created_at: event.received_at,
    comment_id: event.instagram_comment_id,
    media_id: event.instagram_media_id,
    payload: event.payload,
  }));

  const outboundMessages = jobs.rows.map<InboxConversationMessage>((job) => ({
    id: job.id,
    direction: "outbound",
    label: job.send_type,
    body: payloadText(job.payload) || job.last_error || "Resposta preparada pelo UaiFlow.",
    status: job.status,
    created_at: job.sent_at ?? job.created_at,
    comment_id: job.instagram_comment_id,
    media_id: null,
    payload: job.payload,
  }));

  return {
    contact,
    messages: [...inboundMessages, ...outboundMessages].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
  };
}
export async function listInboxEvents(limit = 50, accountId?: string | null): Promise<InboxEvent[]> {
  const { rows } = await query<InboxEvent>(
    `select id, event_type, instagram_user_id, instagram_username, instagram_comment_id,
            instagram_media_id, payload, received_at
     from public.events
     where ($2::uuid is null or account_id = $2)
     order by received_at desc
     limit $1`,
    [limit, accountId ?? null],
  );

  return rows;
}
export async function getDashboardStats(accountId?: string | null) {
  const [automations, config, accounts, events, queue, contacts, recentEvents] = await Promise.all([
    listAutomations(accountId),
    getConfig(accountId),
    listInstagramAccounts(),
    query<{ count: string }>("select count(*) from public.events where ($1::uuid is null or account_id = $1)", [accountId ?? null]),
    query<{ status: string; count: string }>("select status, count(*) from public.queue where ($1::uuid is null or account_id = $1) group by status", [accountId ?? null]),
    query<{ count: string }>("select count(*) from public.contacts where ($1::uuid is null or account_id = $1)", [accountId ?? null]),
    query<RecentEvent>(
      `select id, event_type, instagram_username, instagram_media_id, received_at
       from public.events
       where ($1::uuid is null or account_id = $1)
       order by received_at desc
       limit 6`,
      [accountId ?? null],
    ),
  ]);

  return {
    automations,
    // as telas só usam @, id e foto: nada de token aqui (U-SEG-01)
    config: toPublicConfig(config),
    accounts: accounts.map(toPublicInstagramAccount),
    eventCount: Number(events.rows[0]?.count ?? 0),
    contactCount: Number(contacts.rows[0]?.count ?? 0),
    queue: queue.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    recentEvents: recentEvents.rows,
  };
}

export async function copyProfileConfiguration(input: {
  sourceAccountId: string;
  targetAccountId: string;
  includeAutomations?: boolean;
}) {
  if (input.sourceAccountId === input.targetAccountId) {
    throw new Error("Escolha perfis diferentes para copiar configuracoes.");
  }

  const [sourceAccount, targetAccount, sourceSettings, sourceAutomations] = await Promise.all([
    getInstagramAccountById(input.sourceAccountId),
    getInstagramAccountById(input.targetAccountId),
    getProfileSettings(input.sourceAccountId),
    input.includeAutomations ? listAutomations(input.sourceAccountId) : Promise.resolve([]),
  ]);

  if (!sourceAccount || !targetAccount) throw new Error("Perfil de origem ou destino nao encontrado.");

  const automationIdMap = new Map<string, string>();

  for (const automation of sourceAutomations) {
    const cloned = await createAutomation({
      ...automation,
      id: undefined,
      account_id: input.targetAccountId,
      name: `${automation.name} (copia)`,
      created_at: undefined,
      updated_at: undefined,
    });
    automationIdMap.set(automation.id, cloned.id);
  }

  const mapAutomationId = (id: string | null) => id ? automationIdMap.get(id) ?? null : null;

  const copiedSettings = await updateProfileSettings({
    channel_active: sourceSettings.channel_active,
    default_automation_id: mapAutomationId(sourceSettings.default_automation_id),
    opt_in_automation_id: mapAutomationId(sourceSettings.opt_in_automation_id),
    opt_out_automation_id: mapAutomationId(sourceSettings.opt_out_automation_id),
    story_mention_automation_id: mapAutomationId(sourceSettings.story_mention_automation_id),
    persistent_menu_items: remapPersistentMenuPayloads(sourceSettings.persistent_menu_items, automationIdMap),
    ice_breakers: remapIceBreakerPayloads(sourceSettings.ice_breakers, automationIdMap),
  }, input.targetAccountId);

  return {
    settings: copiedSettings,
    clonedAutomations: automationIdMap.size,
  };
}

function remapPersistentMenuPayloads(items: PersistentMenuItem[], idMap: Map<string, string>): PersistentMenuItem[] {
  return items.map((item) => item.payload ? { ...item, payload: remapPayload(item.payload, idMap) } : item);
}

function remapIceBreakerPayloads(items: IceBreakerItem[], idMap: Map<string, string>): IceBreakerItem[] {
  return items.map((item) => ({ ...item, payload: remapPayload(item.payload, idMap) }));
}

function remapPayload(payload: string, idMap: Map<string, string>) {
  let next = payload;
  for (const [sourceId, targetId] of idMap.entries()) {
    next = next.replaceAll(sourceId, targetId);
  }
  return next;
}
function normalizeProfileSettings(settings: ProfileSettings): ProfileSettings {
  return {
    ...settings,
    persistent_menu_items: Array.isArray(settings.persistent_menu_items) ? settings.persistent_menu_items : [],
    ice_breakers: Array.isArray(settings.ice_breakers) ? settings.ice_breakers : [],
  };
}

function normalizeContactTag(tag: string) {
  return tag.trim().replace(/\s+/g, " ").slice(0, 28);
}

function normalizeTags(tags: string[] | null | undefined) {
  return Array.isArray(tags) ? tags.filter(Boolean).map((tag) => normalizeContactTag(String(tag))).filter(Boolean) : [];
}

function payloadText(payload: Record<string, unknown>) {
  const reaction = reactionPayloadText(payload);
  if (reaction) return reaction;

  const direct = findPayloadString(payload, ["text", "message", "comment", "body", "title"]);
  if (direct) return direct;
  const serialized = JSON.stringify(payload);
  return serialized.length > 220 ? `${serialized.slice(0, 220)}...` : serialized;
}

function reactionPayloadText(payload: Record<string, unknown>) {
  const event = objectChild(payload, "event");
  const reaction = objectChild(event, "reaction") ?? objectChild(payload, "reaction");
  if (!reaction) return null;

  const action = findPayloadString(reaction, ["action"]);
  if (action && ["remove", "removed", "unreact", "delete", "deleted"].includes(action.toLowerCase())) {
    return "Removeu a reacao";
  }

  const value = findPayloadString(reaction, ["emoji", "reaction", "type"]);
  return value ? `Reagiu com ${formatReactionValue(value)}` : "Reagiu a uma mensagem";
}

function objectChild(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === "object" && !Array.isArray(child) ? child as Record<string, unknown> : null;
}

function formatReactionValue(value: string) {
  const cleanValue = value.trim();
  const labels: Record<string, string> = {
    angry: "raiva",
    haha: "risada",
    heart: "coracao",
    like: "curtida",
    love: "coracao",
    sad: "tristeza",
    wow: "surpresa",
  };

  return labels[cleanValue.toLowerCase()] ?? cleanValue;
}

function findPayloadString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;

  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key.toLowerCase()) && typeof child === "string" && child.trim()) {
      return child;
    }
    const nested = findPayloadString(child, keys);
    if (nested) return nested;
  }

  return null;
}
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
