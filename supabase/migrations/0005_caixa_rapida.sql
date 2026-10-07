-- 0005 · Caixa de entrada e Contatos rápidos (índices)
--
-- Só cria índices (atalhos de busca). Não cria tabela, não muda dado nenhum e não mexe em segurança (RLS).
-- Pode ser colada mais de uma vez: "if not exists" pula o que já existe.
-- Sem esta migração o UaiFlow funciona igual; só fica mais devagar quando há milhares de contatos.
-- (Sem "concurrently" de propósito: o editor SQL do Supabase roda tudo numa transação, e as tabelas ainda são pequenas.)

-- Eventos de um contato (contagem e última mensagem na lista e na conversa da Caixa de entrada).
create index if not exists events_account_user_received_idx
  on public.events (account_id, instagram_user_id, received_at desc);

-- Fila de envio de um contato (enviadas, pendentes, com erro e a última).
create index if not exists queue_contact_created_idx
  on public.queue (contact_id, created_at desc);

-- Contatos mais recentes de um perfil (a lista começa pelos que tiveram atividade há pouco).
create index if not exists contacts_account_updated_idx
  on public.contacts (account_id, updated_at desc);

-- Contatos mais recentes de todos os perfis.
create index if not exists contacts_updated_idx
  on public.contacts (updated_at desc);

-- Quantas mensagens diretas o perfil enviou na última hora (limite de 200 por hora).
create index if not exists queue_sent_dm_idx
  on public.queue (account_id, sent_at)
  where status = 'sent' and send_type in ('dm', 'private_reply');
