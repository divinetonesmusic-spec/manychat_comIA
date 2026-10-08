-- 0006 · Fase 5 (ideias novas)
--
-- O que esta migração traz, seção por seção (cada tarefa da Fase 5 acrescenta a sua abaixo):
--   1 · Aviso de "feito com IA": uma coluna nova no post (ai_generated).
--   2 · Limite de 100 publicações em 24 h: um atalho de busca (índice) para contar os posts já publicados.
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- O UaiFlow funciona sem ela (só não manda o aviso de "feito com IA" ao Instagram e conta os posts um pouco mais devagar).
-- Pode ser colada antes ou depois de publicar a versão nova do site. De preferência antes.
-- Nenhuma tabela nova nesta migração; por isso nada de segurança por linha (RLS) a ligar aqui.
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
