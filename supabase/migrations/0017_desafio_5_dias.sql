-- 0017 · O desafio de 5 dias no Direct, com e-mail de reserva (Molde v134, etapa K-EMAILCURSO revista)
--
-- O que esta migração traz:
--   1 · Os desafios (public.desafios): os 5 dias que a página do Molde escreve (texto da DM, vídeo curto do avatar, tarefa,
--       botão «Quero o dia N amanhã» e o e-mail de reserva de cada dia), em 1 ou 2 versões (A e B), o convite da DM, o
--       pedido do e-mail, a oferta do fim do dia 5 e o gasto de anúncio que o dono informar (para o custo por venda).
--   2 · Quem entrou (public.desafio_inscricoes): cada pessoa que comentou a palavra e tocou em «Começar»: a versão (A ou B),
--       o dia em que está, por onde recebe (Direct ou e-mail), o e-mail de reserva (na Lista própria, com consentimento e
--       «sair da lista») e o toque na oferta.
--   3 · Cada dia entregue (public.desafio_envios): por Direct (marcado quando a mensagem sai de verdade) ou por e-mail.
--   4 · Os códigos de compra do desafio (public.desafio_origens): o código curto (mo…) que vai no checkout da oferta. A venda
--       que volta com ele (public.vendas.origem, da 0012) conta como compra daquele desafio e daquela versão.
--   5 · A ligação da automação do post com o desafio (public.automations.desafio_id) e a fonte «desafio» na Lista própria
--       (public.leads, da 0013).
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- Precisa da 0013 (a Lista própria) para guardar o e-mail de reserva. Sem a 0013, a parte 5 dos e-mails é pulada sem erro
-- (cole a 0013 e depois esta de novo). Sem a 0012, as compras do desafio aparecem como 0.
-- O UaiFlow funciona sem ela: a página do Molde avisa «Falta colar a atualização 0017» e nada do que já existia muda.

-- 1 · Os desafios ----------------------------------------------------------------------------------------------------------
create table if not exists public.desafios (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.instagram_accounts(id) on delete set null,
  molde text not null default '',                    -- o projeto (avatar) do Molde que escreveu o desafio
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  titulo text not null default '',
  keyword text not null default '',                  -- a palavra do post (maiúsculas), só para o painel
  pacote jsonb not null default '{}'::jsonb,         -- convite, pedido do e-mail, oferta e os 5 dias de cada versão (conferidos pelo servidor)
  gasto_anuncio numeric(12, 2),                      -- o gasto de anúncio que o dono informou (para o custo por venda)
  moeda text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists desafios_molde_idx on public.desafios (molde);
alter table public.desafios enable row level security;

-- 2 · Quem entrou --------------------------------------------------------------------------------------------------------------
create table if not exists public.desafio_inscricoes (
  id uuid primary key default gen_random_uuid(),
  desafio_id uuid not null references public.desafios(id) on delete cascade,
  account_id uuid references public.instagram_accounts(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  variante text not null default 'A' check (variante in ('A', 'B')),
  chave text not null unique,                        -- o código da pessoa no link da oferta (/d/<slug>/ir?i=<chave>)
  comentou_em timestamptz not null default now(),    -- comentou a palavra e recebeu o convite
  inscrito_em timestamptz,                           -- tocou em «Começar» (o dia 1 saiu)
  dia integer not null default 0 check (dia between 0 and 5), -- o último dia mandado (0 = ainda não começou)
  dia_em timestamptz,                                -- quando esse dia saiu (ou vai sair, no Direct)
  canal text not null default 'dm' check (canal in ('dm', 'email')),
  email_pedido_em timestamptz,                       -- o pedido do e-mail saiu no dia 1
  lead_id uuid,                                      -- o e-mail de reserva (public.leads, da 0013)
  clicou_oferta_em timestamptz,                      -- tocou no botão da oferta (fim do dia 5)
  concluido_em timestamptz,                          -- recebeu o dia 5
  atualizado_em timestamptz not null default now(),
  unique (desafio_id, contact_id)
);
create index if not exists desafio_inscricoes_contato_idx on public.desafio_inscricoes (contact_id);
create index if not exists desafio_inscricoes_reserva_idx on public.desafio_inscricoes (dia_em) where dia between 1 and 4;
alter table public.desafio_inscricoes enable row level security;

-- 3 · Cada dia entregue ---------------------------------------------------------------------------------------------------------
create table if not exists public.desafio_envios (
  id bigserial primary key,
  inscricao_id uuid not null references public.desafio_inscricoes(id) on delete cascade,
  dia integer not null check (dia between 1 and 5),
  canal text not null check (canal in ('dm', 'email')),
  queue_id uuid,                                     -- no Direct: a mensagem da tarefa (a última do dia) na fila
  enviado_em timestamptz,                            -- saiu de verdade (no Direct, quando a fila mandou; no e-mail, quando o serviço aceitou)
  erro text,
  tentativas integer not null default 0,            -- no e-mail: quantas vezes o envio falhou (na 3ª, o e-mail desta pessoa para)
  criado_em timestamptz not null default now(),
  unique (inscricao_id, dia, canal)
);
create index if not exists desafio_envios_queue_idx on public.desafio_envios (queue_id) where queue_id is not null;
alter table public.desafio_envios enable row level security;

-- 4 · Os códigos de compra do desafio -----------------------------------------------------------------------------------------
create table if not exists public.desafio_origens (
  chave text primary key check (chave ~ '^mo[a-z0-9]{1,7}$'),
  desafio_id uuid not null references public.desafios(id) on delete cascade,
  variante text not null default 'A' check (variante in ('A', 'B')),
  criado_em timestamptz not null default now()
);
create index if not exists desafio_origens_desafio_idx on public.desafio_origens (desafio_id);
alter table public.desafio_origens enable row level security;

-- 5 · A automação do post e a Lista própria ----------------------------------------------------------------------------------
alter table public.automations add column if not exists desafio_id uuid references public.desafios(id) on delete set null;

do $$
begin
  if to_regclass('public.leads') is not null then
    alter table public.leads drop constraint if exists leads_fonte_check;
    alter table public.leads add constraint leads_fonte_check check (fonte in ('quiz', 'entrega', 'desafio'));
    alter table public.leads add column if not exists desafio_id uuid references public.desafios(id) on delete set null;
    if not exists (select 1 from pg_constraint where conname = 'desafio_inscricoes_lead_fk') then
      alter table public.desafio_inscricoes add constraint desafio_inscricoes_lead_fk foreign key (lead_id) references public.leads(id) on delete set null;
    end if;
  end if;
end $$;
