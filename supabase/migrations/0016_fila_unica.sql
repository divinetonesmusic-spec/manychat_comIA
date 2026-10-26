-- 0016 · Fila única do Molde e o Telegram para aprovar e pedir (Molde v134, etapas N1 · Fila única e F-MCP parte 1)
--
-- O que esta migração traz:
--   1 · O espelho da fila (public.molde_fila): cada pedido pago ou demorado da página do Molde (os pedidos da Fábrica, do
--       Estúdio de fotos e do Estúdio de vídeo, o Flow, o Só Flow, o storyboard, o HeyGen e a voz) ganha uma linha aqui, com o
--       estado (na fila, produzindo, para aprovar, aprovado, refazer, pronto, erro, cancelado), o custo estimado, o projeto e o
--       avatar, a prévia (link) e a chave do núcleo da página. A página continua dona do pedido: a linha serve para o Telegram,
--       o painel «Fila» e, depois, o orquestrador.
--       Também guarda os pedidos feitos pelo Telegram («/reel», «/fotos»): nascem como «rascunho» e só entram na fila
--       («na_fila») depois do 2º toque «Confirmar · US$ X». A página pega os confirmados e cria o pedido dela.
--   2 · Os avatares que o Telegram oferece (public.molde_avatares): a página manda a lista dos projetos (o nome do avatar,
--       a conta do Instagram) e o preço de cada coisa, para o Telegram mostrar os botões e o custo certo.
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- Não depende de nenhuma outra (só da extensão pgcrypto, que o Supabase já traz, para gen_random_uuid()).
-- O UaiFlow funciona sem ela: as rotas /api/molde/fila respondem «Falta colar a atualização 0016» e a página guarda o
-- espelho para mandar depois. Os outros comandos do Telegram continuam iguais.

-- 1 · O espelho da fila ----------------------------------------------------------------------------------------------
create table if not exists public.molde_fila (
  id uuid primary key default gen_random_uuid(),
  ref text not null,                                  -- quem é na página: pedido:<id>, heygen:<id>, voz:<id> ou telegram:<id>
  origem text not null default 'pagina',              -- pagina | telegram
  pedido_id text,                                     -- o pedidos/<id> da página (o do Telegram ganha quando a página cria)
  chave text,                                         -- a chave do núcleo da página (Nucleo.pedido, k + 16 letras)
  projeto text not null default '',                   -- o projeto (molde) da página
  avatar text not null default '',                    -- o nome do avatar, para mostrar
  tipo text not null,                                 -- fotos, flow_video, produto, ebook, heygen, voz, reel…
  titulo text not null default '',
  estado text not null default 'na_fila',
  etapa text,
  nota text,
  custo_estimado_usd numeric(12, 4) not null default 0,
  previa jsonb,                                       -- {texto?, imagem?, video?, audio?, link?} (links https)
  pedido jsonb not null default '{}'::jsonb,          -- o pedido do Telegram: {comando, texto, n, opcoes}
  rodada integer not null default 0,                  -- quantas vezes ficou «para aprovar»
  decisao jsonb,                                      -- a última decisão: {decisao, nota, via, por, em, rodada}
  decisoes jsonb not null default '[]'::jsonb,        -- o histórico das decisões
  decisao_aplicada_em timestamptz,                    -- a página aplicou a última decisão no pedido dela
  espera_motivo_em timestamptz,                       -- tocou em «Refazer» no Telegram: o próximo texto é o motivo
  confirmado_em timestamptz,                          -- o 2º toque (Telegram) ou o clique (página) que confirmou o gasto
  confirmado_via text,
  telegram_msg_id bigint,
  telegram_aviso_em timestamptz,
  expira_em timestamptz,                              -- o rascunho do Telegram que não foi confirmado some depois disto
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint molde_fila_estado_check check (estado in ('rascunho', 'na_fila', 'produzindo', 'para_aprovar', 'aprovado', 'refazer', 'pronto', 'erro', 'cancelado')),
  constraint molde_fila_origem_check check (origem in ('pagina', 'telegram')),
  constraint molde_fila_custo_check check (custo_estimado_usd >= 0 and custo_estimado_usd <= 1000)
);

create unique index if not exists molde_fila_ref_idx on public.molde_fila (ref);
create unique index if not exists molde_fila_pedido_idx on public.molde_fila (pedido_id) where pedido_id is not null;
create index if not exists molde_fila_projeto_idx on public.molde_fila (projeto, atualizado_em desc);
create index if not exists molde_fila_estado_idx on public.molde_fila (estado, atualizado_em desc);
create index if not exists molde_fila_decisao_idx on public.molde_fila (atualizado_em) where decisao is not null and decisao_aplicada_em is null;
create index if not exists molde_fila_aviso_idx on public.molde_fila (atualizado_em) where estado = 'para_aprovar' and telegram_msg_id is null;

alter table public.molde_fila enable row level security;

comment on table public.molde_fila is
  'Fila única do Molde (0016): o espelho de cada pedido pago ou demorado da página e os pedidos feitos pelo Telegram. A página é dona do pedido; esta linha serve ao Telegram, ao painel «Fila» e ao orquestrador.';

-- 2 · Os avatares que o Telegram oferece -----------------------------------------------------------------------------
create table if not exists public.molde_avatares (
  projeto text primary key,                           -- o projeto (molde) da página
  nome text not null default '',                      -- o nome do avatar
  conta text not null default '',                     -- o @ do Instagram ligado (sem @), se houver
  precos jsonb not null default '{}'::jsonb,          -- {foto: US$ por foto, reel: US$ para produzir um Reel}
  ordem integer not null default 0,
  atualizado_em timestamptz not null default now()
);

alter table public.molde_avatares enable row level security;

comment on table public.molde_avatares is
  'Os avatares (projetos do Molde) que o Telegram oferece nos botões de «/reel» e «/fotos», com o preço de cada coisa (0016).';
