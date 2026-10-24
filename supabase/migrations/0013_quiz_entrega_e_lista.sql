-- 0013 · O funil do Molde: o quiz (/q/<código>), a página de entrega do material grátis (/e/<código>) e a Lista própria (leads)
--
-- O que esta migração traz, seção por seção:
--   1 · Quiz (public.quizzes): o quiz que a página do Molde monta e publica (perfis, perguntas, prova, marca do avatar).
--   2 · Página de entrega (public.entregas e public.entrega_eventos): o material grátis guardado no R2, a página na marca
--       do avatar e quantas pessoas viram, deixaram o e-mail, baixaram o PDF, abriram a versão interativa e o próximo degrau.
--   3 · Lista própria (public.leads): os e-mails do quiz e da entrega, com a origem, o perfil do quiz, o consentimento,
--       a data e o descadastro. O campo «sequencia» é o gancho dos e-mails (DESLIGADO: nada é enviado nesta versão).
--   4 · Sessões do quiz (public.quiz_sessoes): cada pessoa que abriu o quiz: início, cada resposta, fim, e-mail, perfil e o
--       toque no botão da oferta. É daqui que saem os números do Molde (início, fim, e-mail e compra por perfil).
--   5 · Códigos de origem do quiz (public.quiz_origens): o código curto (mo…) que vai no checkout de cada perfil. A venda que
--       volta com esse código (public.vendas.origem, da 0012) conta como compra daquele perfil.
--   6 · Proteção dos formulários públicos de e-mail (public.formulario_limites): limite de tentativas por IP e por e-mail
--       (quiz, entrega e a página de obrigado da 0011) e a confirmação dupla opcional (leads.confirmado_em).
--
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe e não muda nenhum dado.
-- Não depende de outra atualização além da 0001. Sem a 0012, os números do quiz mostram as compras como 0.
-- O UaiFlow funciona sem ela: as páginas /q/ e /e/ respondem "página não encontrada", as rotas do Molde respondem
-- "Falta colar a atualização 0013" e nada do que já existia muda.

-- 1 · Quiz -------------------------------------------------------------------------------------------------------------
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.instagram_accounts(id) on delete set null,
  molde text not null default '',                    -- o projeto (avatar) do Molde que montou o quiz
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  titulo text not null default '',
  pacote jsonb not null default '{}'::jsonb,         -- perfis, perguntas, prova, pergunta da DM, marca e textos (conferidos pelo servidor)
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists quizzes_molde_idx on public.quizzes (molde);
alter table public.quizzes enable row level security;

-- 2 · Página de entrega (antes da lista: a lista aponta para ela) ----------------------------------------------------------
create table if not exists public.entregas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.instagram_accounts(id) on delete set null,
  molde text not null default '',
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  titulo text not null default '',
  pacote jsonb not null default '{}'::jsonb,         -- subtítulo, o que tem dentro, próximo degrau, marca e textos
  capa_key text,                                     -- a capa (imagem) no R2, privada (a página abre por link com prazo)
  pdf_key text,                                      -- o PDF no R2, privado (baixa por link assinado)
  pdf_nome text,
  html_key text,                                     -- a versão interativa (HTML) no R2, privada
  pendentes jsonb not null default '{}'::jsonb,      -- os arquivos pedidos e ainda não conferidos (tipo → {key, nome, tipo})
  ativo boolean not null default false,              -- só abre depois de «publicar» (os arquivos conferidos no R2)
  publicada_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists entregas_molde_idx on public.entregas (molde);
alter table public.entregas enable row level security;

create table if not exists public.entrega_eventos (
  id bigserial primary key,
  entrega_id uuid not null references public.entregas(id) on delete cascade,
  tipo text not null check (tipo in ('visita', 'email', 'pdf', 'html', 'proximo')),
  origem text,                                       -- o código do post (mo…), quando veio no link
  de text,                                           -- bio, dm, comentario, story ou outro
  criado_em timestamptz not null default now()
);
create index if not exists entrega_eventos_idx on public.entrega_eventos (entrega_id, tipo, criado_em desc);
alter table public.entrega_eventos enable row level security;

-- 3 · Lista própria ----------------------------------------------------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.instagram_accounts(id) on delete set null,
  molde text not null default '',
  lista text not null default '',                    -- de qual lista: a conta do Instagram (id) ou, sem conta, o projeto do Molde
  email text not null check (position('@' in email) > 1),
  nome text,
  fonte text not null check (fonte in ('quiz', 'entrega')),
  origem text,                                       -- o código do post (mo…) que trouxe a pessoa
  de text,                                           -- bio, dm, comentario, story ou outro
  quiz_id uuid references public.quizzes(id) on delete set null,
  perfil text,                                       -- o perfil do quiz
  entrega_id uuid references public.entregas(id) on delete set null,
  consentimento boolean not null default false,      -- marcou «quero receber e-mails com dicas e ofertas»
  consentimento_texto text,                          -- a frase exata que a pessoa viu
  consentimento_em timestamptz,
  chave text not null unique,                        -- o link de sair da lista (/lista/sair/<chave>) e o acesso à entrega
  sequencia text,                                    -- GANCHO DESLIGADO: a sequência de e-mails, quando o envio existir (K-EMAILCURSO)
  sequencia_passo integer not null default 0,
  descadastrado_em timestamptz,                      -- pediu para sair da lista
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (lista, email)
);
create index if not exists leads_molde_idx on public.leads (molde, criado_em desc);
alter table public.leads enable row level security;

-- 4 · Sessões do quiz ---------------------------------------------------------------------------------------------------------
create table if not exists public.quiz_sessoes (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  perfil_dm text,                                    -- o perfil que a pessoa já escolheu na pergunta da DM (?perfil=)
  origem text,                                       -- o código do post (mo…) que trouxe a pessoa (?o=)
  de text,
  respostas jsonb not null default '[]'::jsonb,      -- a opção escolhida em cada pergunta, na ordem
  perfil text,                                       -- o resultado
  iniciado_em timestamptz not null default now(),
  terminou_em timestamptz,
  email_em timestamptz,
  checkout_em timestamptz,                           -- tocou no botão da oferta do perfil
  lead_id uuid references public.leads(id) on delete set null,
  atualizado_em timestamptz not null default now()
);
create index if not exists quiz_sessoes_quiz_idx on public.quiz_sessoes (quiz_id, iniciado_em desc);
alter table public.quiz_sessoes enable row level security;

-- 5 · Códigos de origem do quiz ---------------------------------------------------------------------------------------------
create table if not exists public.quiz_origens (
  chave text primary key check (chave ~ '^mo[a-z0-9]{1,7}$'),  -- o código de compra (mo…)
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  perfil text not null,
  origem_post text,                                  -- o código do post que trouxe a pessoa (o checkout leva o código do quiz)
  criado_em timestamptz not null default now()
);
create index if not exists quiz_origens_quiz_idx on public.quiz_origens (quiz_id);
alter table public.quiz_origens enable row level security;

-- 6 · Proteção dos formulários públicos de e-mail (quiz, entrega e a página de obrigado da 0011) ------------------------------
-- Conta as tentativas por IP e por e-mail (os dois guardados só como resumo: nunca o IP nem o e-mail em claro), numa janela
-- de tempo. Passou do limite: o formulário responde «muitas tentativas, tente daqui a pouco» e nada é gravado. As linhas
-- com mais de 2 dias o próprio servidor apaga, aos poucos.
create table if not exists public.formulario_limites (
  chave text not null,                               -- o formulário + «ip:<resumo>» ou «email:<resumo>»
  janela timestamptz not null,                       -- o começo da janela de tempo
  n integer not null default 0,
  primary key (chave, janela)
);
create index if not exists formulario_limites_janela_idx on public.formulario_limites (janela);
alter table public.formulario_limites enable row level security;

-- Confirmação dupla (opcional, desligada por padrão): com FUNIL_CONFIRMACAO_DUPLA=1 e o envio de e-mail configurado (Resend),
-- quem marca «quero receber ofertas» só entra na lista de ofertas depois de tocar no link do e-mail (/lista/confirmar/<chave>).
alter table public.leads add column if not exists confirmado_em timestamptz;
alter table public.leads add column if not exists confirmacao_enviada_em timestamptz;
