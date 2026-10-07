-- 0003 · Publicação segura: o mesmo post nunca sai duas vezes no Instagram.
--
-- publish_requested_at guarda a hora em que o UaiFlow pediu à Meta para publicar (media_publish).
-- Se a função do Netlify for cortada depois desse pedido e antes de gravar "publicado", o relógio
-- vê esse registro e confere no Instagram (container e feed) antes de pedir de novo.
--
-- Pode rodar mais de uma vez sem problema (if not exists). Não cria tabela nova.
-- O código continua funcionando sem esta migração (só perde essa conferência extra).

alter table public.content_posts
  add column if not exists publish_requested_at timestamptz;

comment on column public.content_posts.publish_requested_at is
  'Hora em que o UaiFlow pediu à Meta para publicar (media_publish). Usada para nunca publicar em dobro.';
