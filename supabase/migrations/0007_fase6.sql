-- 0007 · Fase 6 (arrumar a casa)
--
-- O que esta migração traz, seção por seção:
--   1 · Entrada de administrador: uma tabela nova com as tentativas de senha errada (no máximo 5 por endereço em 15 minutos).
--   2 · Aviso de DM esperando no Telegram: uma coluna nova nas DMs sem resposta (quando o aviso já foi mandado).
--       Só vale se a 0006 já foi colada; sem ela, esta seção é pulada sem erro.
--   3 · Limpeza do banco: atalhos de busca (índices) para apagar sem varrer as tabelas inteiras os eventos com mais de
--       90 dias e os envios terminados há mais de 30 dias.
--   4 · Tokens do Instagram num lugar só: se alguma conta só tinha o token na tabela antiga (public.config), ele é
--       copiado para a tabela das contas (public.instagram_accounts). A tabela antiga NÃO é apagada.
--   5 · Estado interno (public.app_status, a mesma da 0004): criada aqui também, caso a 0004 não tenha sido colada.
--
-- Pode ser colada mais de uma vez: "if not exists" e "on conflict do nothing" pulam o que já existe e não mudam nenhum dado.
-- O UaiFlow funciona sem ela: a senha de administrador fica sem o limite de tentativas, o aviso de DM no Telegram não sai
-- e a limpeza do banco não roda (tudo o mais continua igual).
-- Pode ser colada antes ou depois de publicar a versão nova do site. De preferência antes.
-- A tabela nova (seção 1) já sai com a segurança por linha (RLS) ligada e sem nenhuma política: só o servidor do
-- UaiFlow lê e grava nela.
-- (Sem "concurrently" de propósito: o editor SQL do Supabase roda tudo numa transação, e as tabelas ainda são pequenas.)

-- 5 · Estado interno (vem antes porque as outras partes do app usam) -----------------------------------------------
create table if not exists public.app_status (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.app_status enable row level security;

-- 1 · Tentativas de senha errada do administrador ------------------------------------------------------------------
-- Guarda só um resumo (hash) do endereço de quem tentou, nunca o endereço em si, nem a senha digitada.
-- As linhas com mais de 1 dia são apagadas pela limpeza do relógio.
create table if not exists public.admin_login_attempts (
  id bigserial primary key,
  ip_hash text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists admin_login_attempts_ip_time_idx
  on public.admin_login_attempts (ip_hash, attempted_at desc);

alter table public.admin_login_attempts enable row level security;

-- 2 · Aviso de DM esperando ----------------------------------------------------------------------------------------
-- notified_at = quando o UaiFlow avisou no Telegram que esta conversa espera resposta (para não avisar de novo).
-- A tabela dm_pending vem da 0006: sem ela, esta parte não faz nada.
do $$
begin
  if to_regclass('public.dm_pending') is not null then
    alter table public.dm_pending add column if not exists notified_at timestamptz;
    -- A limpeza dos envios antigos solta o vínculo das DMs (queue_id); este atalho evita varrer a tabela a cada envio apagado.
    create index if not exists dm_pending_queue_idx on public.dm_pending (queue_id) where queue_id is not null;
  end if;
end
$$;

-- 3 · Limpeza do banco ---------------------------------------------------------------------------------------------
-- Eventos mais velhos primeiro (a limpeza apaga os de mais de 90 dias).
create index if not exists events_received_idx
  on public.events (received_at);

-- Envios terminados (enviado, falhou ou pulado), pela data da última mudança (a limpeza apaga os de mais de 30 dias).
create index if not exists queue_finished_idx
  on public.queue (updated_at)
  where status in ('sent', 'failed', 'skipped');

-- Ao apagar um evento, o banco solta o vínculo dos envios ligados a ele (event_id); este atalho evita varrer a fila toda.
create index if not exists queue_event_id_idx
  on public.queue (event_id)
  where event_id is not null;

-- 4 · Tokens do Instagram num lugar só ---------------------------------------------------------------------------
-- A partir desta versão o UaiFlow só lê e grava o token em public.instagram_accounts. Se a tabela antiga (public.config)
-- tiver o token de uma conta que ainda não está na tabela das contas, ele é copiado agora. Conta que já existe não muda.
insert into public.instagram_accounts (
  instagram_access_token, instagram_user_id, instagram_username, instagram_name,
  instagram_profile_picture_url, token_expires_at, last_token_refresh_at, webhook_subscribed_at, is_default
)
select
  c.instagram_access_token, c.instagram_user_id, coalesce(c.instagram_username, c.instagram_user_id), c.instagram_name,
  c.instagram_profile_picture_url, c.token_expires_at, c.last_token_refresh_at, c.webhook_subscribed_at,
  not exists (select 1 from public.instagram_accounts a where a.is_default)
from public.config c
where c.id = true
  and c.instagram_access_token is not null
  and c.instagram_user_id is not null
on conflict (instagram_user_id) do nothing;

comment on table public.config is
  'Antiga: até a 0007 guardava uma cópia do token da conta padrão. O UaiFlow não lê nem grava mais tokens aqui (use public.instagram_accounts).';
