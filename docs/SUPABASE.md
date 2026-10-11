# Supabase

O UaiFlow usa Supabase para Auth e Postgres. A estrutura versionada fica em `supabase/migrations`.

## Variaveis necessarias

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
DATABASE_POOL_MAX
```

Use a `anon key` apenas para Auth no navegador. Use `service_role` somente no servidor.

## Aplicar migrations

Com `.env.local` preenchido:

```bash
npm run db:migrate
npm run db:status
```

O executor carrega `.env.local`, abre uma conexao Postgres e aplica somente migrations pendentes. Versao e checksum ficam registrados em `public.schema_migrations`.

Nunca altere uma migration ja aplicada. Para mudar o banco, crie o proximo arquivo numerado em `supabase/migrations`.

## O que o schema cria

- `profiles`, `workspaces`, `workspace_members`
- `instagram_accounts`
- `automations`, `followups`
- `contacts`
- `profile_settings`
- `events`
- `queue`
- indices unicos por conta do Instagram
- triggers de `updated_at`
- funcao `claim_queue_jobs`
- RLS basico para Auth

## Cron

Depois que o projeto estiver no ar, edite `supabase/cron.sql`:

```sql
url := 'https://SEU-SITE.netlify.app/api/queue/drain'
headers := jsonb_build_object('x-worker-secret', 'SEU_WORKER_SECRET')
```

Repita para `/api/token/refresh`.

O cron precisa das extensoes `pg_cron` e `pg_net`. Em alguns planos ou regioes do Supabase, pode ser necessario habilitar essas extensoes no painel antes de executar o arquivo.

## Migrar dados ou comecar zerado

Para uma nova instalacao, comece zerado: rode `npm run db:migrate` no novo Supabase e conecte os perfis novamente. Tokens de Instagram e chaves antigas nao devem ser migrados entre donos.