-- 0011 · Escada de vendas (Money Models), página de obrigado, pedido de depoimento, pré-venda e destino do post
--
-- O que esta migração traz, seção por seção:
--   1 · Produtos (public.produtos): um por produto vendido. Página de uma tela (/p/<slug>), link de pagamento da
--       entrada (o checkout continua na plataforma: Stripe, Whop, Gumroad, Payhip ou Cakto), modo pré-venda, a escada
--       (order bump, upsell, downsell, recorrência) e a página de obrigado com o próximo passo.
--   2 · Sessões da oferta pós-compra (public.funil_sessoes): uma por compra. Guarda em que passo a pessoa está e o
--       prazo REAL do desconto do upsell (oferta_expira_em), gravado uma vez só: recarregar a página não reinicia nada.
--   3 · Eventos do funil (public.funil_eventos): entrada, viu/aceitou/recusou upsell, downsell, recorrência, obrigado e
--       e-mail capturado. Servem para medir a taxa de aceite e o valor médio por comprador.
--   4 · Compradores (public.compradores): a lista própria de e-mails (deixados pela pessoa na página de obrigado), com
--       o agendamento do pedido de depoimento e o aviso de entrega da pré-venda.
--   5 · Depoimentos (public.depoimentos): respostas do formulário público, com data e a permissão explícita de uso.
--   6 · Destino do post (public.content_posts.destino_tipo / destino_link): para onde o post leva (quiz, página de
--       venda, isca de e-mail, palavra-chave na DM ou só valor) e o link.
--
-- Todas as tabelas novas saem com a segurança por linha (RLS) ligada e sem políticas: só o servidor lê e grava.
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- O UaiFlow funciona sem ela: a tela Vendas avisa "Falta colar a atualização 0011" e as páginas /p/... respondem 404.

-- 1 · Produtos ------------------------------------------------------------------------------------------------------
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  nome text not null,
  promessa text not null default '',
  preco numeric(12, 2) not null default 0,
  moeda text not null default 'USD',
  produto_ref text,                                 -- o produtoRef que chega nas vendas por webhook (para somar a receita)
  checkout_url text,                                -- link de pagamento da entrada na plataforma
  modo text not null default 'normal' check (modo in ('normal', 'prevenda')),
  prevenda_entrega date,                            -- pré-venda: prazo de entrega prometido
  o_que_recebe text[] not null default '{}'::text[],
  escada jsonb not null default '{}'::jsonb,        -- { bump, upsell, downsell, recorrencia } (lido e conferido pelo servidor)
  obrigado jsonb not null default '{}'::jsonb,      -- { texto, proximoPasso: { tipo, titulo, texto, link } }
  depoimento_ativo boolean not null default true,
  depoimento_dias integer not null default 7 check (depoimento_dias between 1 and 90),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.produtos enable row level security;

-- 2 · Sessões da oferta pós-compra ---------------------------------------------------------------------------------
create table if not exists public.funil_sessoes (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  compra_ref text,                                  -- id da compra no link de retorno (ex.: {CHECKOUT_SESSION_ID} da Stripe)
  etapa text not null default 'upsell' check (etapa in ('upsell', 'downsell', 'recorrencia', 'obrigado')),
  oferta_expira_em timestamptz,                     -- prazo real do desconto do upsell; nunca é regravado
  aceitou_recorrencia boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (produto_id, compra_ref)
);

create index if not exists funil_sessoes_produto_idx on public.funil_sessoes (produto_id, criado_em desc);

alter table public.funil_sessoes enable row level security;

-- 3 · Eventos do funil ----------------------------------------------------------------------------------------------
create table if not exists public.funil_eventos (
  id bigint generated always as identity primary key,
  sessao_id uuid references public.funil_sessoes(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  tipo text not null check (tipo in (
    'clique_comprar', 'clique_comprar_bump', 'entrada',
    'viu_upsell', 'aceitou_upsell', 'recusou_upsell',
    'viu_downsell', 'aceitou_downsell', 'recusou_downsell',
    'viu_recorrencia', 'aceitou_recorrencia', 'recusou_recorrencia',
    'viu_obrigado', 'email_capturado'
  )),
  valor numeric(12, 2) not null default 0,          -- preço mostrado no momento (aceites), para a estimativa do valor médio
  criado_em timestamptz not null default now()
);

-- Um evento de cada tipo por sessão (recarregar a página não conta de novo). Cliques sem sessão não têm esse limite.
create unique index if not exists funil_eventos_sessao_tipo_idx on public.funil_eventos (sessao_id, tipo) where sessao_id is not null;
create index if not exists funil_eventos_produto_idx on public.funil_eventos (produto_id, criado_em desc);

alter table public.funil_eventos enable row level security;

-- 4 · Compradores (lista própria) -----------------------------------------------------------------------------------
create table if not exists public.compradores (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid references public.produtos(id) on delete set null,
  email text not null,
  nome text,
  compra_ref text,
  sessao_id uuid references public.funil_sessoes(id) on delete set null,
  aceita_novidades boolean not null default false,  -- caixa marcada pela pessoa (novidades e ofertas por e-mail)
  prevenda boolean not null default false,          -- comprou na pré-venda: avisar na entrega
  avisado_entrega_em timestamptz,
  depoimento_token text unique,                     -- link do formulário público (/depoimento/<token>)
  depoimento_pedir_em timestamptz,                  -- quando o relógio manda o pedido de depoimento
  depoimento_pedido_em timestamptz,                 -- quando foi mandado (null = ainda não)
  depoimento_canal text check (depoimento_canal in ('email', 'manual')),
  depoimento_erro text,
  depoimento_tentativas integer not null default 0,
  descadastrado_em timestamptz,                     -- pediu para não receber mais e-mails
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists compradores_produto_email_idx on public.compradores (coalesce(produto_id::text, ''), lower(email));
create index if not exists compradores_pedido_idx on public.compradores (depoimento_pedir_em)
  where depoimento_pedido_em is null and descadastrado_em is null;

alter table public.compradores enable row level security;

-- 5 · Depoimentos ---------------------------------------------------------------------------------------------------
create table if not exists public.depoimentos (
  id uuid primary key default gen_random_uuid(),
  comprador_id uuid references public.compradores(id) on delete set null,
  produto_id uuid references public.produtos(id) on delete set null,
  nome_exibicao text,
  o_que_funcionou text not null,
  depoimento text,
  print_key text,                                   -- imagem enviada (chave no R2, pasta depoimentos/); vista só no painel
  autoriza_uso boolean not null default false,      -- caixa «autorizo usar» marcada pela pessoa
  autorizado_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists depoimentos_criado_idx on public.depoimentos (criado_em desc);

alter table public.depoimentos enable row level security;

-- 6 · Destino do post ----------------------------------------------------------------------------------------------
alter table public.content_posts add column if not exists destino_tipo text;
alter table public.content_posts add column if not exists destino_link text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_posts_destino_tipo_check') then
    alter table public.content_posts add constraint content_posts_destino_tipo_check
      check (destino_tipo is null or destino_tipo in ('quiz', 'pagina_venda', 'isca_email', 'palavra_chave_dm', 'so_valor'));
  end if;
end $$;
