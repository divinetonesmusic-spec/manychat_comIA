-- 0015 · Segurança (v133, etapa U-SEG): Reel nunca publicado duas vezes e o banco fechado para a chave pública
--
-- O que esta migração traz, seção por seção:
--   1 · Registro dos itens do Molde já mandados para o Instagram (public.content_refs_publicadas): um por perfil e por
--       referência do Molde (externalRef). Fica guardado mesmo que o post seja apagado do UaiFlow. O relógio confere este
--       registro antes de publicar: o mesmo item mandado de novo (por exemplo, depois de apagar o post) não vira um
--       segundo Reel. A trava é a chave única (perfil + referência) do próprio banco.
--       Os posts que já saíram (ou cujo pedido de publicação já foi feito) entram no registro agora.
--   2 · Banco fechado para a chave pública (anon) do Supabase: o navegador só usa o login do Supabase; nenhuma tabela do
--       UaiFlow é lida pela chave pública. Todas as tabelas já têm a proteção por linha (RLS) ligada e sem regra para a
--       chave pública; aqui, além disso, a chave pública e os usuários logados pelo Supabase perdem a permissão de ler e
--       mexer nas tabelas e funções do UaiFlow (inclusive nas que forem criadas depois). A tabela de controle das
--       migrações (public.schema_migrations, quando existe) também ganha a proteção por linha.
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- O UaiFlow funciona sem ela: o relógio continua com as travas de antes (a da 0003); só o caso "post apagado e mandado de
-- novo pelo Molde" não fica protegido. Pode ser colada antes ou depois de publicar a versão nova do site. De preferência antes.

-- 1 · Itens do Molde já mandados para o Instagram ---------------------------------------------------------------------
create table if not exists public.content_refs_publicadas (
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  external_ref text not null,                       -- o externalRef do post no Molde
  post_id uuid,                                     -- o post que publicou (sem ligação: o registro fica se o post for apagado)
  estado text not null default 'pedido' check (estado in ('pedido', 'publicado')),
  media_id text,                                    -- o id do Reel/post no Instagram, quando já se sabe
  permalink text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (account_id, external_ref)
);

alter table public.content_refs_publicadas enable row level security;

comment on table public.content_refs_publicadas is
  'UaiFlow v133: um registro por perfil e referência do Molde já mandada para o Instagram. O relógio não publica de novo a mesma referência.';

-- Os posts que já saíram, ou cujo pedido de publicação já foi feito (coluna da 0003), entram no registro.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'content_posts' and column_name = 'publish_requested_at') then
    insert into public.content_refs_publicadas (account_id, external_ref, post_id, estado, media_id, permalink, criado_em)
    select distinct on (cp.account_id, cp.external_ref)
           cp.account_id, cp.external_ref, cp.id,
           case when cp.status = 'published' then 'publicado' else 'pedido' end,
           cp.published_media_id, cp.permalink, coalesce(cp.published_at, cp.publish_requested_at, now())
      from public.content_posts cp
     where cp.external_ref is not null and cp.account_id is not null
       and (cp.status = 'published' or cp.published_media_id is not null or cp.publish_requested_at is not null)
     order by cp.account_id, cp.external_ref, (cp.status = 'published') desc, cp.published_at nulls last
    on conflict (account_id, external_ref) do nothing;
  else
    insert into public.content_refs_publicadas (account_id, external_ref, post_id, estado, media_id, permalink, criado_em)
    select distinct on (cp.account_id, cp.external_ref)
           cp.account_id, cp.external_ref, cp.id, 'publicado', cp.published_media_id, cp.permalink, coalesce(cp.published_at, now())
      from public.content_posts cp
     where cp.external_ref is not null and cp.account_id is not null
       and (cp.status = 'published' or cp.published_media_id is not null)
     order by cp.account_id, cp.external_ref, cp.published_at nulls last
    on conflict (account_id, external_ref) do nothing;
  end if;
end $$;

-- 2 · Banco fechado para a chave pública -------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    execute 'alter table public.schema_migrations enable row level security';
  end if;

  -- Só no Supabase (onde existem os papéis anon e authenticated). O servidor do UaiFlow usa a conexão direta
  -- (DATABASE_URL), que não depende destas permissões.
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'revoke execute on all functions in schema public from anon, authenticated';
    -- O que for criado depois (pelo mesmo usuário que cola as migrações) também nasce fechado.
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated';
    execute 'alter default privileges in schema public revoke execute on functions from anon, authenticated';
  end if;
end $$;
