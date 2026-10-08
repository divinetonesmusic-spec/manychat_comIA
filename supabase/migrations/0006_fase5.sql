-- 0006 · Fase 5 (ideias novas)
--
-- O que esta migração traz, seção por seção (cada tarefa da Fase 5 acrescenta a sua abaixo):
--   1 · Aviso de "feito com IA": uma coluna nova no post (ai_generated).
--   2 · Limite de 100 publicações em 24 h: um atalho de busca (índice) para contar os posts já publicados.
--       (O mesmo atalho serve à lista de resultados que o Molde lê em /api/molde/resultados.)
--   3 · Links rastreados: duas tabelas novas (os links curtos /l/<código> e os cliques de cada um).
--   4 · DMs para o Molde: uma tabela nova (as mensagens diretas que ninguém respondeu, esperando a resposta aprovada pela dona).
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- O UaiFlow funciona sem ela (só não manda o aviso de "feito com IA" ao Instagram, conta os posts um pouco mais devagar
-- e não cria os links rastreados nem guarda as DMs sem resposta: as rotas novas respondem "Falta colar a atualização 0006" até a colagem).
-- Pode ser colada antes ou depois de publicar a versão nova do site. De preferência antes.
-- As tabelas novas (seções 3 e 4) já saem com a segurança por linha (RLS) ligada e sem nenhuma política: só o servidor do
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

-- 4 · DMs para o Molde ---------------------------------------------------------------------------
-- Quando alguém manda uma DM e NADA a responde (nenhuma palavra-chave serviu, não há automação padrão ligada), o UaiFlow
-- guarda a conversa aqui. O Molde lê a fila (/api/molde/dms), escreve um rascunho com a IA e a dona aprova; só então a
-- resposta entra na fila normal de envios (com o limite de 200 por hora e o prazo de 24 h do Instagram).
-- Uma linha "aguardando" por contato: as mensagens seguintes da mesma pessoa entram na mesma linha (as 10 mais novas).
create table if not exists public.dm_pending (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.instagram_accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  instagram_user_id text not null,
  username text,
  messages jsonb not null default '[]'::jsonb,      -- [{texto, em, eventId}] (até 10, as mais novas)
  last_message_at timestamptz not null default now(),
  status text not null default 'aguardando' check (status in ('aguardando','na_fila','enviada','nao_enviada','expirada','descartada')),
  reply_text text,                                  -- a resposta que a dona aprovou, do jeito que ela aprovou
  queue_id uuid references public.queue(id) on delete set null,
  status_note text,                                 -- frase em português para a tela (por que não saiu, por exemplo)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Só pode existir uma linha "aguardando" por contato.
create unique index if not exists dm_pending_open_contact
  on public.dm_pending (contact_id)
  where status = 'aguardando';

create index if not exists dm_pending_account_status_idx
  on public.dm_pending (account_id, status, last_message_at desc);

-- Achar depressa as linhas de um contato (a mesma mensagem reentregue não vira outro item; limpeza dos itens velhos).
create index if not exists dm_pending_contact_idx
  on public.dm_pending (contact_id);

-- Segurança por linha ligada e SEM política: só o servidor do UaiFlow (conexão direta do banco) lê e grava.
alter table public.dm_pending enable row level security;
