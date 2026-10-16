-- 0008 · Fase 9 (o Molde trabalha sozinho)
--
-- O que esta migração traz, seção por seção:
--   1 · Fila de trabalho do Molde (public.molde_jobs): a página do Molde (ou o próprio UaiFlow) põe trabalhos na fila e o
--       robô do Mac busca sozinho o próximo, mesmo com a página fechada. Cada trabalho guarda o estado, a etapa, o
--       progresso, a prévia para aprovar, quem aprovou e quanto deve custar.
--   2 · DMs: o rascunho de resposta que o Molde preparou e espera o «Mandar» (pela página ou pelo Telegram).
--       Só vale se a 0006 já foi colada; sem ela, esta seção é pulada sem erro.
--   3 · Estado interno (public.app_status, a mesma da 0004 e da 0007): criada aqui também, caso falte.
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- O UaiFlow funciona sem ela: as rotas novas (/api/molde/jobs) respondem "Falta colar a atualização 0008", o botão
-- «Mandar» do Telegram não aparece e o relatório de domingo sai sem a parte dos gastos.
-- Pode ser colada antes ou depois de publicar a versão nova do site. De preferência antes.
-- A tabela nova já sai com a segurança por linha (RLS) ligada e sem nenhuma política: só o servidor do UaiFlow lê e grava.
-- (Sem "concurrently" de propósito: o editor SQL do Supabase roda tudo numa transação, e as tabelas ainda são pequenas.)

-- 3 · Estado interno (vem antes porque as outras partes do app usam) ------------------------------------------------
create table if not exists public.app_status (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.app_status enable row level security;

-- 1 · Fila de trabalho do Molde -------------------------------------------------------------------------------------
-- Ciclo: na_fila → rodando → (esperando_aprovacao → aprovado | recusado → rodando → …) → pronto | erro | cancelado.
-- "aprovado" e "recusado" voltam a ser pegos pelo robô (para continuar ou refazer).
create table if not exists public.molde_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.instagram_accounts(id) on delete set null,
  projeto text not null default '',                 -- a pasta/projeto do Molde (ex.: birdie-lanier)
  tipo text not null check (tipo ~ '^[a-z][a-z0-9_]{1,39}$'),   -- reel_pipeline, narrar, montar, versoes…
  ref text not null,                                -- a referência do trabalho no Molde (pedir de novo não duplica)
  titulo text not null default '',
  estado text not null default 'na_fila'
    check (estado in ('na_fila','rodando','esperando_aprovacao','aprovado','recusado','pronto','erro','cancelado')),
  etapa text,                                       -- frase curta em português (ex.: "Gerando a voz")
  progresso integer not null default 0 check (progresso between 0 and 100),
  prioridade integer not null default 0,
  payload jsonb not null default '{}'::jsonb,       -- o pedido (o robô lê)
  resultado jsonb,                                  -- o que o robô entregou (arquivos, links)
  previa jsonb,                                     -- a prévia para aprovar: {texto, imagem, video, audio, link}
  erro text,                                        -- frase em português
  tentativas integer not null default 0,            -- quantas vezes um Mac pegou este trabalho nesta fase
  retomar_estado text,                              -- de onde o trabalho saiu ao ser pego (volta para lá se o Mac sumir)
  lease_until timestamptz,                          -- até quando o Mac que pegou ainda é o dono (renovado no batimento)
  worker text,                                      -- o nome do Mac que está com o trabalho
  custo_estimado_usd numeric(10,4) not null default 0 check (custo_estimado_usd >= 0),
  forcar_custo boolean not null default false,      -- true = pode passar do teto do mês (a dona confirmou)
  rodada integer not null default 0,                -- quantas vezes já pediu aprovação
  aprovacao jsonb,                                  -- a última decisão: {decisao, via, por, em, nota, rodada}
  aprovacoes jsonb not null default '[]'::jsonb,    -- todas as decisões, em ordem
  telegram_msg_id bigint,                           -- a mensagem de aprovação no Telegram (para editar depois)
  telegram_aviso_em timestamptz,                    -- última tentativa de mandar a mensagem de aprovação
  aviso_erro_em timestamptz,                        -- quando o aviso de erro foi mandado (para não repetir)
  iniciado_em timestamptz,                          -- a primeira vez que um Mac pegou (conta nos gastos do mês)
  concluido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Quando o relógio apagou do R2 a prévia de aprovação (pasta molde-previas, 30 dias depois). Em "add column" à parte
-- para valer também onde uma versão anterior desta migração já foi colada.
alter table public.molde_jobs add column if not exists previa_apagada_em timestamptz;
-- Código de posse: cada claim gera um novo; as ações do robô (batimento, aprovacao, concluir, erro) precisam dele.
-- Um robô que pegou o trabalho antes (e perdeu o prazo) não mexe mais nele, mesmo com o mesmo nome de Mac.
alter table public.molde_jobs add column if not exists posse uuid;

-- Um trabalho por (projeto, tipo, ref): pedir de novo devolve o mesmo.
create unique index if not exists molde_jobs_ref_unique
  on public.molde_jobs (projeto, tipo, ref);

-- O "pegar o próximo" do robô e o relógio (leases vencidos) leem por aqui.
create index if not exists molde_jobs_fila_idx
  on public.molde_jobs (estado, prioridade desc, criado_em)
  where estado in ('na_fila', 'rodando', 'aprovado', 'recusado', 'esperando_aprovacao');

-- Gastos do mês (soma do custo estimado dos trabalhos começados no mês).
create index if not exists molde_jobs_iniciado_idx
  on public.molde_jobs (iniciado_em)
  where iniciado_em is not null;

-- A lista da página (por projeto, os mais recentes primeiro).
create index if not exists molde_jobs_projeto_idx
  on public.molde_jobs (projeto, atualizado_em desc);

alter table public.molde_jobs enable row level security;

-- 2 · Rascunho de resposta das DMs ----------------------------------------------------------------------------------
-- O Molde prepara a resposta (draft_text) e o UaiFlow pergunta no Telegram: «Mandar» / «Não mandar».
-- draft_seq muda a cada rascunho novo: um botão de um rascunho antigo não manda o novo.
do $$
begin
  if to_regclass('public.dm_pending') is not null then
    alter table public.dm_pending add column if not exists draft_text text;
    alter table public.dm_pending add column if not exists draft_seq integer not null default 0;
    alter table public.dm_pending add column if not exists draft_at timestamptz;
    alter table public.dm_pending add column if not exists telegram_msg_id bigint;
    alter table public.dm_pending add column if not exists telegram_aviso_em timestamptz;
  end if;
end
$$;
