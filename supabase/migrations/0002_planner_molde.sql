-- 0002 · Planner de conteúdo + integração com o Molde do Avatar
-- Agendamento, pacote do post (legenda, palavra, DM, link, 1º comentário), resultados e limpeza de mídia.

alter table public.content_posts drop constraint if exists content_posts_status_check;
alter table public.content_posts
  add constraint content_posts_status_check
  check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'canceled'));

alter table public.content_posts
  add column if not exists title text not null default '',
  add column if not exists scheduled_at timestamptz,
  add column if not exists first_comment text not null default '',
  add column if not exists first_comment_id text,
  add column if not exists keyword text not null default '',
  add column if not exists dm_text text not null default '',
  add column if not exists link_url text not null default '',
  add column if not exists link_label text not null default '',
  add column if not exists public_reply text not null default '',
  add column if not exists automation_options jsonb not null default '{}'::jsonb,
  add column if not exists automation_id uuid references public.automations(id) on delete set null,
  add column if not exists source text not null default 'manual',
  add column if not exists external_ref text,
  add column if not exists media_keys text[] not null default '{}',
  add column if not exists media_deleted_at timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists insights jsonb not null default '{}'::jsonb,
  add column if not exists insights_at timestamptz,
  add column if not exists publishing_started_at timestamptz,
  add column if not exists lock_until timestamptz;

create index if not exists content_posts_due_idx
  on public.content_posts (scheduled_at)
  where status = 'scheduled';

create index if not exists content_posts_publishing_idx
  on public.content_posts (updated_at)
  where status = 'publishing';

create unique index if not exists content_posts_external_ref_unique
  on public.content_posts (account_id, source, external_ref)
  where external_ref is not null;

-- Pega os posts vencidos de forma segura (dois relógios ao mesmo tempo não publicam o mesmo post).
create or replace function public.claim_due_content_posts(post_limit integer default 5)
returns setof public.content_posts as $$
begin
  return query
  with due as (
    select cp.id
    from public.content_posts cp
    where cp.status = 'scheduled'
      and cp.scheduled_at is not null
      and cp.scheduled_at <= now()
    order by cp.scheduled_at asc
    limit post_limit
    for update of cp skip locked
  )
  update public.content_posts cp
  set status = 'publishing', attempts = cp.attempts + 1, last_error = null, publishing_started_at = now()
  from due
  where cp.id = due.id
  returning cp.*;
end;
$$ language plpgsql;
