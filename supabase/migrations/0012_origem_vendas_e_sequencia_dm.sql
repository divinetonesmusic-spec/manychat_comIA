-- 0012 · Vendas por post (a origem do link no checkout), mais 10 plataformas de venda, cliques do story e a sequência de DM
--
-- O que esta migração traz, seção por seção:
--   1 · Link com origem (public.tracked_links.origem / destino_origem): o código curto do post (mo + letras e números) e o
--       endereço do checkout com esse código. O link curto /l/<código> passa a levar a pessoa ao checkout com a origem.
--   2 · Clique do story (public.link_clicks.origin): aceita "story" (o adesivo de link do story, ?de=story).
--   3 · Vendas com origem (public.vendas.origem) e as plataformas novas: Hotmart, Kiwify, Eduzz, Monetizze, Braip, Ticto,
--       Perfect Pay, Digistore24, ClickBank e Lemon Squeezy (Stripe, Whop, Gumroad, Payhip e Cakto continuam).
--   4 · Sequência de DM por post (public.automations.sequencia): mensagem 2 quando a pessoa responder, o link no passo 3 e
--       o lembrete antes de fechar a janela de 24 h.
--   5 · Andamento da sequência de cada pessoa (public.dm_sequencias): em que passo ela está, quando respondeu, se tocou no
--       link e o lembrete na fila.
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- As seções 1 e 2 só mexem se a 0006 já foi colada; a 3, se a 0010 já foi colada (senão são puladas sem erro).
-- O UaiFlow funciona sem ela: os links continuam levando ao destino de sempre, o clique do story conta como "outro", as
-- vendas das plataformas novas respondem 503 (a plataforma tenta de novo mais tarde) e a DM do post sai só com a 1ª mensagem.
-- Pode ser colada antes ou depois de publicar a versão nova do site. De preferência antes.

-- 1 · Link com origem ------------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.tracked_links') is not null then
    alter table public.tracked_links add column if not exists origem text;          -- mo + até 7 letras/números (o mesmo post, o mesmo código)
    alter table public.tracked_links add column if not exists destino_origem text;  -- o checkout com a origem (para onde o /l/ leva)
    create index if not exists tracked_links_origem_idx on public.tracked_links (origem) where origem is not null;
  end if;
end $$;

-- 2 · Clique do story ------------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.link_clicks') is not null then
    alter table public.link_clicks drop constraint if exists link_clicks_origin_check;
    alter table public.link_clicks add constraint link_clicks_origin_check
      check (origin in ('bio', 'dm', 'comentario', 'story', 'outro'));
  end if;
end $$;

-- 3 · Vendas com origem e as plataformas novas -------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.vendas') is not null then
    alter table public.vendas add column if not exists origem text;                 -- o código mo… que voltou no aviso de venda
    create index if not exists vendas_origem_idx on public.vendas (origem) where origem is not null;
    alter table public.vendas drop constraint if exists vendas_plataforma_check;
    alter table public.vendas add constraint vendas_plataforma_check check (plataforma in (
      'stripe', 'whop', 'gumroad', 'payhip', 'cakto',
      'hotmart', 'kiwify', 'eduzz', 'monetizze', 'braip', 'ticto', 'perfectpay', 'digistore24', 'clickbank', 'lemonsqueezy'
    ));
  end if;
end $$;

-- 4 · Sequência de DM por post ---------------------------------------------------------------------------------------
-- { mensagem2, mensagem3, linkUrl, linkLabel, linkAposSegundos, lembrete, lembreteHoras } (conferido pelo servidor).
-- Vazio ({}) = como antes: só a 1ª mensagem (e o botão/lembrete antigos, se houver).
alter table public.automations add column if not exists sequencia jsonb not null default '{}'::jsonb;

-- 5 · Andamento da sequência de cada pessoa --------------------------------------------------------------------------
create table if not exists public.dm_sequencias (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.instagram_accounts(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  chave text not null unique,                        -- vai no link do passo 3 (&s=…): o toque no link pula o lembrete
  etapa text not null default 'aguardando_resposta' check (etapa in ('aguardando_resposta', 'em_andamento', 'concluida')),
  comentou_em timestamptz not null default now(),    -- a 1ª mensagem (resposta privada ao comentário) entrou na fila
  respondeu_em timestamptz,                          -- a resposta da pessoa (abre a janela de 24 h): passos 2, 3 e o lembrete
  clicou_em timestamptz,                             -- tocou no link do passo 3
  respondeu_depois_em timestamptz,                   -- escreveu de novo depois do passo 2 (o lembrete não sai)
  lembrete_queue_id uuid references public.queue(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (automation_id, contact_id)
);

create index if not exists dm_sequencias_contato_idx on public.dm_sequencias (contact_id, atualizado_em desc);

alter table public.dm_sequencias enable row level security;
