-- 0009 · Música do Instagram nos Reels (Audio API da Meta)
--
-- O que esta migração traz, seção por seção:
--   1 · Conexão pelo Facebook (public.instagram_facebook_connections): uma segunda conexão, opcional, de cada conta do
--       Instagram, feita pelo «Login do Facebook» (a Página do Facebook ligada à conta). Só ela deixa pôr música da
--       biblioteca do Instagram num Reel: a Meta só oferece a Audio API pelo «Instagram API with Facebook Login».
--       Guarda o token da pessoa (longa duração, 60 dias), o token da Página e a Página escolhida. Uma linha por conta.
--   2 · Música do post (public.content_posts): a música escolhida (id e nome) e os dois volumes (música e voz/vídeo).
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- O UaiFlow funciona sem ela: a busca de música responde "Falta colar a atualização 0009", o botão «Conectar pelo
-- Facebook» avisa o mesmo e os posts continuam saindo como sempre (sem música).
-- Pode ser colada antes ou depois de publicar a versão nova do site. De preferência antes.
-- A tabela nova já sai com a segurança por linha (RLS) ligada e sem nenhuma política: só o servidor do UaiFlow lê e grava.

-- 1 · Conexão pelo Facebook -----------------------------------------------------------------------------------------
create table if not exists public.instagram_facebook_connections (
  account_id uuid primary key references public.instagram_accounts(id) on delete cascade,
  instagram_user_id text not null,                  -- o mesmo id da conta (instagram_business_account da Página)
  facebook_user_id text,                            -- quem fez o login do Facebook
  page_id text not null,                            -- a Página do Facebook ligada à conta do Instagram
  page_name text,
  user_access_token text not null,                  -- token da pessoa, longa duração (60 dias); renovado pelo relógio
  user_token_expires_at timestamptz,
  page_access_token text,                           -- token da Página (tirado do token de longa duração; não vence)
  last_token_refresh_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.instagram_facebook_connections enable row level security;

-- 2 · Música do post ------------------------------------------------------------------------------------------------
-- musica_audio_id vazio = sem música (o post sai como sempre). Só vale para Reel.
alter table public.content_posts add column if not exists musica_audio_id text;
alter table public.content_posts add column if not exists musica_titulo text;
alter table public.content_posts add column if not exists musica_volume integer not null default 20
  check (musica_volume between 0 and 100);
alter table public.content_posts add column if not exists video_volume integer not null default 100
  check (video_volume between 0 and 100);
