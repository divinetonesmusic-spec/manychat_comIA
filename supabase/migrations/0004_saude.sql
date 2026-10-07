-- 0004 · Saúde do relógio: o UaiFlow guarda quando o relógio rodou pela última vez.
--
-- O relógio (/api/queue/drain, chamado a cada minuto pelo pg_cron) grava aqui um "batimento"
-- (chave = 'relogio'). A rota pública /api/health lê esse horário e responde "fora do ar" quando ele
-- passa de 15 minutos; o monitor do GitHub (a cada hora) manda aviso no Telegram nesse caso.
--
-- Pode rodar mais de uma vez sem problema (if not exists).
-- RLS ligado e nenhuma política: só o servidor do UaiFlow (dono da tabela) lê e grava; a chave pública
-- (anon) do Supabase não enxerga nada.
-- O código continua funcionando sem esta migração: o relógio segue normal e o /api/health avisa que ela falta.

create table if not exists public.app_status (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.app_status enable row level security;

comment on table public.app_status is
  'Estado interno do UaiFlow (ex.: chave relogio = último batimento do /api/queue/drain). Só o servidor acessa.';
