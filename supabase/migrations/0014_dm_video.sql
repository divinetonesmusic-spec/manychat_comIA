-- 0014 · Roteiro de DM com vídeo do avatar (Molde v133, etapa K-DMVIDEO)
--
-- O que esta migração traz:
--   1 · Os vídeos de resposta da DM (public.dm_videos): 3 a 5 vídeos curtos do avatar por post ou por palavra-chave, cada um
--       com as palavras (e sinônimos) que o escolhem e o endereço do vídeo no armazenamento (R2). Um deles pode ser o «geral»,
--       que vai quando a resposta da pessoa não casa com nenhum.
--   2 · O andamento da sequência em modo vídeo (colunas novas em public.dm_sequencias, da 0012): o que a pessoa respondeu,
--       qual vídeo foi escolhido para ela e quando o Nicolas foi avisado no Telegram.
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- Precisa da 0012 (a tabela dm_sequencias). Sem a 0012, a parte 2 é pulada sem erro (cole a 0012 e depois esta de novo).
-- O UaiFlow funciona sem ela: a sequência da 0012 continua igual (mensagem 2, o link e o lembrete), sem o vídeo.

-- 1 · Os vídeos de resposta ------------------------------------------------------------------------------------------
create table if not exists public.dm_videos (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.instagram_accounts(id) on delete cascade,
  external_ref text not null default '',            -- o post do Molde (o mesmo externalRef do post); '' = vale para a palavra
  keyword text not null default '',                 -- a palavra-chave (maiúsculas, sem acento); '' = vale para o post
  chave text not null,                              -- nome curto do vídeo (ex.: acorda-de-madrugada)
  titulo text not null default '',                  -- a dúvida que o vídeo responde, em palavras do Nicolas
  palavras text[] not null default '{}',            -- palavras e sinônimos que escolhem este vídeo
  geral boolean not null default false,             -- vai quando nada casa
  texto text not null default '',                   -- a frase que sai junto do vídeo (antes dele)
  video_url text not null,                          -- endereço público do vídeo (https)
  r2_key text,                                      -- a chave no R2 (pasta uaiflow/molde-dmvideos/, nunca apagada por post)
  tamanho bigint,                                   -- bytes (a Meta aceita até 25 MB por vídeo na DM)
  duracao_seg integer,
  ordem integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists dm_videos_escopo_chave_idx
  on public.dm_videos (coalesce(account_id::text, ''), external_ref, keyword, chave);
create index if not exists dm_videos_ref_idx on public.dm_videos (external_ref) where external_ref <> '';
create index if not exists dm_videos_keyword_idx on public.dm_videos (keyword) where keyword <> '';

alter table public.dm_videos enable row level security;

-- 2 · O andamento em modo vídeo ----------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.dm_sequencias') is not null then
    alter table public.dm_sequencias add column if not exists resposta_texto text;          -- o que a pessoa respondeu (até 500 letras)
    alter table public.dm_sequencias add column if not exists video_chave text;             -- o vídeo escolhido para ela
    alter table public.dm_sequencias add column if not exists video_queue_id uuid references public.queue(id) on delete set null;
    alter table public.dm_sequencias add column if not exists video_sai_em timestamptz;     -- quando a resposta automática (o vídeo) sai
    alter table public.dm_sequencias add column if not exists alerta_em timestamptz;        -- o aviso no Telegram já saiu
    create index if not exists dm_sequencias_alerta_idx on public.dm_sequencias (respondeu_em) where video_chave is not null and alerta_em is null;
  end if;
end $$;
