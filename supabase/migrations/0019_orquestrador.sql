-- 0019 · O orquestrador do Molde na fila única (Molde v135, etapas 2-NUCLEO parte 4 e F-MCP parte 2)
--
-- O que esta migração traz (tudo na mesma tabela da 0016, public.molde_fila):
--   1 · O trabalho do orquestrador: a estação (a skill que faz: molde-roteirista, molde-fotografo…), os detalhes do pedido,
--       a entrada (as peças do projeto), o diário dos passos (a saída de cada skill), o pedido de aprovação com os achados
--       do revisor, o resultado e o erro.
--   2 · A posse com prazo («pegar»): quem pegou o item e até quando. O prazo vence sozinho: um orquestrador que caiu no
--       meio não trava o item (o próximo ciclo pega de novo).
--   3 · A versão: um número que sobe a cada mudança do item. Quem escreve manda a versão que leu; se outra escrita passou
--       no meio, a fila responde 409 e ninguém apaga o trabalho do outro.
--   4 · Um estado novo, «na_revisao» (o revisor está olhando), e a origem «piloto».
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe; a regra dos estados e o gatilho da versão são
-- trocados pela mesma coisa. Não muda nenhum dado.
-- Precisa da 0016 (a tabela public.molde_fila). Sem a 0019 a página e o Telegram continuam iguais; só as rotas do
-- orquestrador e o MCP respondem «Falta colar a atualização 0019».

-- 1 · O trabalho do orquestrador ------------------------------------------------------------------------------------
alter table public.molde_fila add column if not exists versao integer not null default 1;
alter table public.molde_fila add column if not exists estacao text;                       -- a skill que faz (null = espelho da página)
alter table public.molde_fila add column if not exists conta text;                         -- a conta do UaiFlow ligada ao projeto
alter table public.molde_fila add column if not exists detalhes jsonb not null default '{}'::jsonb;
alter table public.molde_fila add column if not exists entrada jsonb;                      -- {pecas, pecasMarcas, projeto}
alter table public.molde_fila add column if not exists passos jsonb not null default '[]'::jsonb;
alter table public.molde_fila add column if not exists aprovacao jsonb;                    -- {necessaria, motivo, pergunta, opcoes, achados…}
alter table public.molde_fila add column if not exists resultado jsonb;                    -- {saida, pecasParaGravar}
alter table public.molde_fila add column if not exists tentativas integer not null default 0;
alter table public.molde_fila add column if not exists erro text;

-- 2 · A posse com prazo ----------------------------------------------------------------------------------------------
alter table public.molde_fila add column if not exists pego_por text;
alter table public.molde_fila add column if not exists pego_ate timestamptz;
alter table public.molde_fila add column if not exists pego_prazo_seg integer;
alter table public.molde_fila add column if not exists pego_de text;                       -- o estado de quando pegou (volta a ele se o prazo vencer)

create index if not exists molde_fila_chave_idx on public.molde_fila (chave, criado_em desc) where chave is not null;
create index if not exists molde_fila_estacao_idx on public.molde_fila (estado, criado_em) where estacao is not null;

-- 4 · Os estados e as origens (a regra é trocada pela mesma, mais «na_revisao» e «piloto») ---------------------------
alter table public.molde_fila drop constraint if exists molde_fila_estado_check;
alter table public.molde_fila add constraint molde_fila_estado_check
  check (estado in ('rascunho', 'na_fila', 'produzindo', 'na_revisao', 'para_aprovar', 'aprovado', 'refazer', 'pronto', 'erro', 'cancelado'));
alter table public.molde_fila drop constraint if exists molde_fila_origem_check;
alter table public.molde_fila add constraint molde_fila_origem_check check (origem in ('pagina', 'telegram', 'piloto'));
alter table public.molde_fila drop constraint if exists molde_fila_tentativas_check;
alter table public.molde_fila add constraint molde_fila_tentativas_check check (tentativas >= 0 and tentativas <= 100);

-- 3 · A versão sobe sozinha a cada mudança ---------------------------------------------------------------------------
-- (o número da mensagem do Telegram, a hora do aviso e a espera do motivo não contam: não são mudança do item)
create or replace function public.molde_fila_versao() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - array['versao', 'atualizado_em', 'telegram_msg_id', 'telegram_aviso_em', 'espera_motivo_em'])
     is distinct from (to_jsonb(old) - array['versao', 'atualizado_em', 'telegram_msg_id', 'telegram_aviso_em', 'espera_motivo_em']) then
    new.versao := old.versao + 1;
  else
    new.versao := old.versao;
  end if;
  return new;
end;
$$;

drop trigger if exists molde_fila_versao on public.molde_fila;
create trigger molde_fila_versao before update on public.molde_fila
  for each row execute function public.molde_fila_versao();

comment on column public.molde_fila.versao is
  'Sobe a cada mudança do item (0019). Quem escreve pelo orquestrador manda a versão que leu: outra no meio = 409.';
comment on column public.molde_fila.estacao is
  'A skill do plugin molde-do-avatar que faz o item (0019). null = espelho de um pedido da página (o orquestrador não pega).';
