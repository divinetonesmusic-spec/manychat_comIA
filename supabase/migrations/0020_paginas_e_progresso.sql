-- 0020 · A página de venda no ar pelo UaiFlow e o progresso do vídeo numa mensagem só do Telegram (Molde v137, etapas K12 e G7)
--
-- O que esta migração traz:
--   1 · As páginas de venda (public.molde_paginas): o HTML único que a Fábrica do Molde gera (pagina-para-subir.html, com as
--       imagens embutidas) fica guardado no UaiFlow e abre em /v/<nome>. O arquivo fica PRIVADO no R2 (uaiflow/paginas/<id>.html)
--       quando o R2 está configurado; sem o R2, fica no próprio banco (coluna html, até 5 MB). «publicada» = no ar.
--   2 · O progresso do vídeo no Telegram: cada item da fila única (public.molde_fila, da 0016) ganha o «grupo» (o vídeo a que
--       ele pertence) e cada grupo guarda o número da sua mensagem de progresso (public.molde_fila_grupos). O Telegram passa a
--       editar UMA mensagem por vídeo («Reel «Oração da manhã» · 3 de 6 · Voz pronta ✓ · Fazendo o vídeo…»).
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe; o gatilho da versão é trocado pelo mesmo. Não muda
-- nenhum dado. A parte 2 precisa da 0016 (e usa a 0019 se ela já foi colada); sem a 0016, a parte 2 é pulada.
-- O UaiFlow funciona sem ela: /v/<nome> responde «Página não encontrada», as rotas /api/molde/paginas respondem «Falta colar a
-- atualização 0020» e o Telegram continua mandando as mensagens como na v135 (sem a mensagem de progresso).

-- 1 · As páginas de venda ---------------------------------------------------------------------------------------------------
create table if not exists public.molde_paginas (
  id uuid primary key default gen_random_uuid(),
  molde text not null default '',                     -- o projeto (avatar) do Molde que publicou a página
  account_id uuid references public.instagram_accounts(id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  titulo text not null default '',
  armazenamento text not null default 'r2' check (armazenamento in ('r2', 'banco')),
  html_key text,                                      -- onde o HTML está no R2 (privado; o UaiFlow lê e entrega em /v/<nome>)
  html text check (html is null or octet_length(html) <= 5242880), -- sem o R2: o HTML aqui mesmo (até 5 MB)
  tamanho integer not null default 0 check (tamanho >= 0 and tamanho <= 5242880), -- bytes do HTML
  publicada boolean not null default false,           -- true = no ar em /v/<nome>; DELETE tira do ar (o conteúdo fica)
  publicada_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists molde_paginas_molde_idx on public.molde_paginas (molde, atualizado_em desc);
alter table public.molde_paginas enable row level security;

comment on table public.molde_paginas is
  'Páginas de venda do Molde (0020), abertas em /v/<slug>. O HTML roda isolado (CSP sandbox, sem a origem do UaiFlow).';

-- 2 · O progresso do vídeo no Telegram ----------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.molde_fila') is null then
    raise notice '0020: a tabela molde_fila (0016) não existe; o progresso do Telegram fica para depois da 0016.';
    return;
  end if;

  execute 'alter table public.molde_fila add column if not exists grupo text';
  execute 'create index if not exists molde_fila_grupo_idx on public.molde_fila (grupo, criado_em) where grupo is not null';

  -- O grupo não é mudança do item: a versão (0019) não sobe por causa dele. O gatilho é trocado pelo mesmo da 0019 com
  -- «grupo» na lista do que não conta (só se a coluna versao da 0019 existe).
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'molde_fila' and column_name = 'versao') then
    execute $f$
      create or replace function public.molde_fila_versao() returns trigger
      language plpgsql as $b$
      begin
        if (to_jsonb(new) - array['versao', 'atualizado_em', 'telegram_msg_id', 'telegram_aviso_em', 'espera_motivo_em', 'grupo'])
           is distinct from (to_jsonb(old) - array['versao', 'atualizado_em', 'telegram_msg_id', 'telegram_aviso_em', 'espera_motivo_em', 'grupo']) then
          new.versao := old.versao + 1;
        else
          new.versao := old.versao;
        end if;
        return new;
      end;
      $b$
    $f$;
  end if;
end $$;

create table if not exists public.molde_fila_grupos (
  grupo text primary key check (char_length(grupo) between 3 and 300), -- o vídeo: g:<projeto>:<grupo da página> ou t:<projeto>:<tema>
  projeto text not null default '',
  telegram_msg_id bigint,                             -- a mensagem de progresso deste vídeo (editada a cada etapa)
  passos smallint check (passos is null or passos between 1 and 30), -- quantas etapas o vídeo tem (a página manda; «3 de 6»)
  texto text,                                         -- o último texto mandado (não edita se não mudou)
  editado_em timestamptz,                             -- a última edição (no máximo 1 por segundo por mensagem)
  pendente boolean not null default false,            -- mudou e ainda não foi mostrado (o relógio manda no minuto seguinte)
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists molde_fila_grupos_pendente_idx on public.molde_fila_grupos (atualizado_em) where pendente;
alter table public.molde_fila_grupos enable row level security;

comment on column public.molde_fila_grupos.telegram_msg_id is
  'A mensagem de progresso do vídeo no Telegram (0020). Uma por vídeo, editada a cada mudança de etapa ou estado.';

-- Fechado para a chave pública (como a 0015): só o servidor do UaiFlow (DATABASE_URL) lê e escreve.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.molde_paginas from anon, authenticated';
    execute 'revoke all on public.molde_fila_grupos from anon, authenticated';
  end if;
end $$;
