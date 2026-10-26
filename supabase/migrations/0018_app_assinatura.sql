-- 0018 · O app por assinatura do Molde (/a/<código>): a página-app (PWA) de 1 toque que a página do Molde publica, quem assina,
-- os pagamentos que chegam pelos avisos de venda, a entrada sem senha (link e código por e-mail), o uso de cada dia e o lembrete.
--
-- O que esta migração traz, seção por seção:
--   1 · O app (public.apps): o pacote que a página do Molde publica (a rotina de 30 dias, os textos, a marca do avatar, o preço, o
--       link de pagamento e o lembrete), os códigos do produto de assinatura na plataforma (para casar o aviso de venda) e os
--       áudios, guardados PRIVADOS no R2 (uaiflow/apps/<id>/…), tocados só por quem tem a assinatura ativa.
--   2 · Quem assina (public.app_assinantes): o e-mail do comprador (o que chega no aviso da plataforma), a situação da assinatura
--       e até quando entra (acesso_ate: o último pagamento + 31 dias + a carência; depois de um cancelamento, atraso, reembolso ou
--       chargeback, só a carência). O lembrete diário por e-mail é escolha da pessoa (desligado no começo) e tem o «sair».
--   3 · Os pagamentos (public.app_pagamentos): cada aviso da assinatura (aprovada, renovada, cancelada, atrasada, reembolsada,
--       chargeback) uma vez só. É daqui que saem a receita do mês, os cancelamentos e a retenção no 2º mês.
--   4 · A entrada (public.app_acessos): o link e o código de 6 números que vão por e-mail (valem 30 minutos, uma vez) e a sessão
--       do aparelho (180 dias). Só o resumo (sha256) fica guardado: ninguém lê o link nem a sessão no banco.
--   5 · O uso (public.app_uso): um dia por pessoa quando ela toca o áudio do dia (no fuso dela): os dias seguidos e o uso diário.
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- Não depende de outra atualização além da 0001 (a 0013 dá o limite de tentativas do formulário do e-mail; sem ela, sem limite).
-- O UaiFlow funciona sem ela: /a/<código> responde "página não encontrada", as rotas do Molde respondem "Falta colar a
-- atualização 0018" e os avisos de venda seguem como antes (sem mexer em assinatura nenhuma).

-- 1 · O app ---------------------------------------------------------------------------------------------------------------
create table if not exists public.apps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.instagram_accounts(id) on delete set null,
  molde text not null default '',                     -- o projeto (avatar) do Molde que publicou o app
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  titulo text not null default '',
  pacote jsonb not null default '{}'::jsonb,          -- rotina (30 dias), áudios, textos, marca, preço, checkout, lembrete (conferidos pelo servidor)
  produto_refs text[] not null default '{}',          -- os códigos do produto de assinatura na plataforma (Hotmart, Kiwify, Stripe…)
  carencia_dias integer not null default 3 check (carencia_dias between 0 and 15),
  audios jsonb not null default '{}'::jsonb,          -- id do áudio → {key, size, contentType} (conferidos no R2)
  pendentes jsonb not null default '{}'::jsonb,       -- os áudios pedidos e ainda não conferidos
  versao integer not null default 1,                  -- sobe a cada publicação (o app do celular troca os áudios guardados)
  ativo boolean not null default false,               -- só abre depois de «publicar» (os áudios conferidos no R2)
  publicado_em timestamptz,                           -- a 1ª publicação: o começo do teste dos 60 dias
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists apps_molde_idx on public.apps (molde);
create index if not exists apps_produto_refs_idx on public.apps using gin (produto_refs);
alter table public.apps enable row level security;

-- 2 · Quem assina ---------------------------------------------------------------------------------------------------------
create table if not exists public.app_assinantes (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) between 3 and 254),
  status text not null default 'ativo' check (status in ('ativo', 'atrasada', 'cancelada', 'reembolsada', 'chargeback')),
  plataforma text,
  assinatura_ref text,                                -- o código da assinatura na plataforma (casa o aviso que vem sem e-mail, ex.: Stripe)
  inicio_em timestamptz not null default now(),       -- o 1º pagamento
  ultimo_pagamento_em timestamptz,
  status_em timestamptz not null default now(),       -- quando a situação mudou pela última vez
  acesso_ate timestamptz not null default now(),      -- até quando a pessoa entra no app
  fuso text not null default 'America/Sao_Paulo',     -- o fuso do aparelho dela (o dia do uso e a hora do lembrete)
  lembrete boolean not null default false,            -- o lembrete diário por e-mail: só com o «sim» dela
  lembrete_hora smallint not null default 21 check (lembrete_hora between 0 and 23),
  lembrete_ultimo date,                               -- o último dia (no fuso dela) em que o lembrete saiu
  sair_codigo text not null unique,                   -- o «não quero mais o lembrete» do e-mail
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (app_id, email)
);
create index if not exists app_assinantes_ref_idx on public.app_assinantes (assinatura_ref) where assinatura_ref is not null;
create index if not exists app_assinantes_lembrete_idx on public.app_assinantes (lembrete_hora) where lembrete;
alter table public.app_assinantes enable row level security;

-- 3 · Os pagamentos -------------------------------------------------------------------------------------------------------
create table if not exists public.app_pagamentos (
  id bigserial primary key,
  app_id uuid not null references public.apps(id) on delete cascade,
  assinante_id uuid not null references public.app_assinantes(id) on delete cascade,
  plataforma text not null,
  raw_id text not null,                               -- o código do aviso na plataforma (o mesmo aviso de novo não conta 2 vezes)
  tipo text not null check (tipo in ('aprovada', 'renovada', 'cancelada', 'atrasada', 'reembolsada', 'chargeback')),
  valor numeric(12, 2) not null default 0,
  moeda text not null default 'BRL',
  teste boolean not null default false,
  em timestamptz not null default now(),
  unique (plataforma, raw_id, tipo)
);
create index if not exists app_pagamentos_app_em_idx on public.app_pagamentos (app_id, em desc);
alter table public.app_pagamentos enable row level security;

-- 4 · A entrada (link e código por e-mail; a sessão do aparelho) ------------------------------------------------------------
create table if not exists public.app_acessos (
  id uuid primary key default gen_random_uuid(),
  assinante_id uuid not null references public.app_assinantes(id) on delete cascade,
  tipo text not null check (tipo in ('link', 'sessao')),
  hash text not null unique,                          -- sha256 do link ou da sessão (nunca o valor)
  codigo_hash text,                                   -- sha256 do código de 6 números (só no tipo link)
  tentativas smallint not null default 0,             -- códigos errados (5 = o link vence)
  expira_em timestamptz not null,
  usado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists app_acessos_assinante_idx on public.app_acessos (assinante_id, tipo);
alter table public.app_acessos enable row level security;

-- 5 · O uso de cada dia ---------------------------------------------------------------------------------------------------
create table if not exists public.app_uso (
  assinante_id uuid not null references public.app_assinantes(id) on delete cascade,
  dia date not null,                                  -- o dia no fuso da pessoa
  noite smallint,                                     -- a noite da rotina que ela tocou (1 a 30)
  em timestamptz not null default now(),
  primary key (assinante_id, dia)
);
alter table public.app_uso enable row level security;
