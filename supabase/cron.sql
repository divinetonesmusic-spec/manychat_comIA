-- Relógio do UaiFlow no Supabase (pg_cron + pg_net). Rode no SQL Editor depois que o site estiver no ar no Netlify.
--
-- O que ele agenda:
--   * uaiflow-drain-every-minute: a cada 1 minuto ('* * * * *') chama POST /api/queue/drain (envia a fila de mensagens,
--     publica os posts agendados, avisa as DMs esperando no Telegram e limpa o banco 1 vez por hora).
--   * uaiflow-refresh-weekly: toda segunda-feira às 9h UTC ('0 9 * * 1') chama POST /api/token/refresh (renova os tokens).
--     Desde a v133 o relógio de cada minuto já renova os tokens que precisam (todas as contas); este fica como reserva.
--
-- Antes de rodar, troque nas DUAS chamadas:
--   * https://SEU-SITE.netlify.app pelo endereço do seu site no Netlify (ex.: https://uaiflow-divinetones.netlify.app);
--   * SEU_WORKER_SECRET pelo mesmo valor de WORKER_SECRET das variáveis do Netlify.
-- Este arquivo no GitHub nunca leva o segredo de verdade: depois de rodar, não salve nem envie a cópia com o valor trocado.
-- Pode rodar de novo quando quiser (por exemplo, ao trocar o WORKER_SECRET): cada agendamento é apagado e criado de novo.
-- Requer as extensões pg_cron e pg_net ligadas no Supabase (Database > Extensions).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('uaiflow-drain-every-minute')
where exists (select 1 from cron.job where jobname = 'uaiflow-drain-every-minute');

select cron.schedule(
  'uaiflow-drain-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-SITE.netlify.app/api/queue/drain',
    headers := jsonb_build_object('x-worker-secret', 'SEU_WORKER_SECRET')
  );
  $$
);

select cron.unschedule('uaiflow-refresh-weekly')
where exists (select 1 from cron.job where jobname = 'uaiflow-refresh-weekly');

select cron.schedule(
  'uaiflow-refresh-weekly',
  '0 9 * * 1',
  $$
  select net.http_post(
    url := 'https://SEU-SITE.netlify.app/api/token/refresh',
    headers := jsonb_build_object('x-worker-secret', 'SEU_WORKER_SECRET')
  );
  $$
);
