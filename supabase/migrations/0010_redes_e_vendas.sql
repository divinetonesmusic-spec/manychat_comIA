-- 0010 · Outras redes (Facebook Página, Threads, YouTube Shorts) e vendas por webhook
--
-- O que esta migração traz, seção por seção:
--   1 · Redes do post (public.content_posts): para onde o post vai além do Instagram (redes), a privacidade e o título
--       do YouTube. O Instagram continua sendo a rede principal: ele sai como sempre e as outras vão depois.
--   2 · Resultado de cada rede (public.content_post_redes): uma linha por post e rede (facebook, threads, youtube),
--       com a situação, o id e o link do post lá, o erro e as tentativas. O resultado do Instagram continua em
--       content_posts (status, permalink, last_error...). Uma rede que falha não mexe nas outras.
--   3 · Conexão do Threads (public.threads_connections) e do YouTube (public.youtube_connections): uma por conta do
--       Instagram, opcionais. Os tokens ficam em texto no banco, como os do Instagram e do Facebook (só o servidor lê:
--       segurança por linha ligada e nenhuma política).
--   4 · Permissões da conexão pelo Facebook (instagram_facebook_connections.granted_scopes): para saber se a conexão
--       já pode publicar Reels na Página (pages_manage_posts). Só se a 0009 já foi colada.
--   5 · Vendas (public.vendas): vendas e reembolsos que chegam por webhook (Stripe, Whop, Gumroad, Payhip, Cakto). Guarda o
--       mínimo: plataforma, produto, valor, moeda, situação e datas. Nenhum e-mail ou nome de cliente.
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- O UaiFlow funciona sem ela: o Instagram sai como sempre, as outras redes avisam "Falta colar a atualização 0010" e
-- os webhooks de venda respondem 503 (a plataforma tenta de novo mais tarde).
-- Pode ser colada antes ou depois de publicar a versão nova do site. De preferência antes.

-- 1 · Redes do post -------------------------------------------------------------------------------------------------
alter table public.content_posts add column if not exists redes text[] not null default array['instagram']::text[];
alter table public.content_posts add column if not exists youtube_privacidade text not null default 'public';
alter table public.content_posts add column if not exists youtube_titulo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_posts_youtube_privacidade_check') then
    alter table public.content_posts add constraint content_posts_youtube_privacidade_check
      check (youtube_privacidade in ('public', 'unlisted', 'private'));
  end if;
end $$;

-- 2 · Resultado de cada rede ----------------------------------------------------------------------------------------
create table if not exists public.content_post_redes (
  post_id uuid not null references public.content_posts(id) on delete cascade,
  rede text not null check (rede in ('facebook', 'threads', 'youtube')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'published', 'failed')),
  etapa text,                                       -- passo interno (ex.: container criado, enviando o vídeo)
  estado jsonb not null default '{}'::jsonb,        -- dados internos do passo (id do container, envio do YouTube...)
  external_id text,                                 -- id do post na rede
  permalink text,
  last_error text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lock_until timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, rede)
);

create index if not exists content_post_redes_fila_idx on public.content_post_redes (next_attempt_at)
  where status in ('pending', 'processing');

alter table public.content_post_redes enable row level security;

-- 3 · Conexões do Threads e do YouTube ------------------------------------------------------------------------------
create table if not exists public.threads_connections (
  account_id uuid primary key references public.instagram_accounts(id) on delete cascade,
  threads_user_id text not null,
  threads_username text,
  access_token text not null,                       -- longa duração (60 dias); renovado pelo relógio de tokens
  token_expires_at timestamptz,
  last_token_refresh_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.threads_connections enable row level security;

create table if not exists public.youtube_connections (
  account_id uuid primary key references public.instagram_accounts(id) on delete cascade,
  channel_id text,
  channel_title text,
  refresh_token text not null,                      -- não vence sozinho (a não ser com o app do Google em "Teste": 7 dias)
  access_token text,                                -- curto (1 hora); renovado na hora de publicar
  access_token_expires_at timestamptz,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.youtube_connections enable row level security;

-- 4 · Permissões da conexão pelo Facebook (só se a 0009 já foi colada) ---------------------------------------------
do $$
begin
  if to_regclass('public.instagram_facebook_connections') is not null then
    alter table public.instagram_facebook_connections add column if not exists granted_scopes text[];
  end if;
end $$;

-- 5 · Vendas --------------------------------------------------------------------------------------------------------
create table if not exists public.vendas (
  id uuid primary key default gen_random_uuid(),
  plataforma text not null check (plataforma in ('stripe', 'whop', 'gumroad', 'payhip', 'cakto')),
  raw_id text not null,                             -- id da venda na plataforma (não repete: o mesmo aviso duas vezes não duplica)
  pagamento_id text,                                -- outro id da plataforma, para achar a venda no reembolso (ex.: payment_intent)
  produto_ref text,                                 -- ?ref= / metadata / id do produto na plataforma
  produto_id text,                                  -- id do produto na plataforma, como veio
  produto_nome text,
  valor numeric(12, 2) not null default 0,          -- na unidade da moeda (ex.: 19.90)
  moeda text not null default 'USD',
  status text not null default 'paga' check (status in ('paga', 'reembolsada', 'reembolso_parcial', 'contestada')),
  valor_reembolsado numeric(12, 2) not null default 0,
  teste boolean not null default false,             -- venda de teste da plataforma
  criado_em timestamptz not null default now(),     -- hora da venda na plataforma
  recebido_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (plataforma, raw_id)
);

create index if not exists vendas_criado_em_idx on public.vendas (criado_em desc);
create index if not exists vendas_pagamento_idx on public.vendas (plataforma, pagamento_id) where pagamento_id is not null;

alter table public.vendas enable row level security;
