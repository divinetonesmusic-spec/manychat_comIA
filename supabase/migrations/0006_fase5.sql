-- 0006 · Fase 5 (ideias novas)
--
-- O que esta migração traz, seção por seção (cada tarefa da Fase 5 acrescenta a sua abaixo):
--   1 · Aviso de "feito com IA": uma coluna nova no post (ai_generated).
--   2 · Limite de 100 publicações em 24 h: um atalho de busca (índice) para contar os posts já publicados.
--       (O mesmo atalho serve à lista de resultados que o Molde lê em /api/molde/resultados.)
--   3 · Links rastreados: duas tabelas novas (os links curtos /l/<código> e os cliques de cada um).
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- O UaiFlow funciona sem ela (só não manda o aviso de "feito com IA" ao Instagram, conta os posts um pouco mais devagar
-- e não cria os links rastreados: eles respondem "Falta colar a atualização 0006" até a colagem).
-- Pode ser colada antes ou depois de publicar a versão nova do site. De preferência antes.
-- As duas tabelas novas (seção 3) já saem com a segurança por linha (RLS) ligada e sem nenhuma política: só o servidor do
-- UaiFlow lê e grava nelas; ninguém consegue ver os cliques por fora.
-- (Sem "concurrently" de propósito: o editor SQL do Supabase roda tudo numa transação, e a tabela ainda é pequena.)

-- 1 · Aviso de IA --------------------------------------------------------------------------------
-- true = o Instagram mostra "feito com IA" neste post (a Meta aceita is_ai_generated desde junho de 2026).
-- Posts que já existem ficam false (sem aviso), como sempre foram.
alter table public.content_posts
  add column if not exists ai_generated boolean not null default false;

comment on column public.content_posts.ai_generated is
  'true = mandar is_ai_generated=true ao criar o container na Meta (no carrossel, só no container pai).';

-- 2 · Limite de publicações em 24 h --------------------------------------------------------------
-- O UaiFlow segura em 95 posts publicados por perfil em 24 h (o Instagram aceita 100) e precisa contá-los rápido.
create index if not exists content_posts_published_window_idx
  on public.content_posts (account_id, published_at desc)
  where status = 'published';

-- 3 · Links rastreados ---------------------------------------------------------------------------
-- Cada Reel pode ter um link curto próprio (/l/<código>) que leva ao destino (a loja, por exemplo) e conta os cliques.
-- Um link por (perfil, referência do Reel no Molde): pedir de novo devolve o mesmo código e os cliques continuam.
create table if not exists public.tracked_links (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                                  -- 7 letras/números minúsculos, sorteados pelo servidor
  account_id uuid references public.instagram_accounts(id) on delete cascade,
  external_ref text not null,                                 -- o mesmo externalRef do post no Molde
  destination_url text not null,                              -- sempre https://
  label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um link por (perfil, Reel). Sem perfil (account_id vazio) também conta como um "perfil" só.
create unique index if not exists tracked_links_ref_unique
  on public.tracked_links (coalesce(account_id::text, ''), external_ref);

-- Um registro por clique. Não guarda IP, nem aparelho, nem navegador: só quando e de onde veio (bio, DM, comentário ou outro).
create table if not exists public.link_clicks (
  id bigserial primary key,
  link_id uuid not null references public.tracked_links(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  origin text not null default 'outro' check (origin in ('bio','dm','comentario','outro'))
);

create index if not exists link_clicks_link_time_idx
  on public.link_clicks (link_id, clicked_at desc);

-- Segurança por linha ligada e SEM política: o navegador (chave pública do Supabase) não enxerga nada; só o servidor
-- do UaiFlow, que usa a conexão direta do banco, lê e grava.
alter table public.tracked_links enable row level security;
alter table public.link_clicks enable row level security;
