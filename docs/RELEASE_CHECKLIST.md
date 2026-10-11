# Checklist para publicar no GitHub

## Arquivos e privacidade

- [ ] `.env.local`, `.vercel`, `.next` e `node_modules` nao aparecem no GitHub.
- [ ] `instagram-skill`, `logo` e `referencia` nao aparecem no commit.
- [ ] Nenhum print possui dados de clientes, tokens ou senhas.
- [ ] Nenhum token, export do banco ou connection string foi adicionado.
- [ ] `npm run release:check` passa.

## Banco

- [ ] Existe migration em `supabase/migrations`.
- [ ] `npm run db:migrate` funciona em um Supabase vazio.
- [ ] A segunda execucao nao reaplica migrations.
- [ ] `npm run db:status` nao mostra pendencias.
- [ ] O banco novo nao possui dados do dono anterior.

## Codigo

- [ ] `npm ci` conclui sem erro.
- [ ] `npm run lint` passa.
- [ ] `npx tsc --noEmit` passa.
- [ ] `npm run build` passa.

## Deploy

- [ ] Todas as variaveis de `.env.example` existem no Netlify (Site configuration > Environment variables), inclusive `ALLOWED_EMAILS` com o seu e-mail.
- [ ] `APP_BASE_URL` usa o dominio final e HTTPS.
- [ ] `INSTAGRAM_REDIRECT_URI` termina em `/api/oauth/callback`.
- [ ] Supabase Auth possui o dominio final nas Redirect URLs.
- [ ] Meta possui OAuth callback, webhook, privacidade e exclusao de dados.
- [ ] Webhook da Meta foi verificado.
- [ ] `supabase/cron.sql` foi personalizado e executado.

## Teste funcional

- [ ] Login funciona (e-mail da lista `ALLOWED_EMAILS` e a senha de administrador); `/cadastro` leva para `/login`.
- [ ] Instagram Business ou Creator conecta em `Perfis`.
- [ ] Diagnostico nao apresenta erros.
- [ ] DM recebida aparece na caixa de entrada.
- [ ] Resposta manual e entregue dentro da janela de 24 horas.
- [ ] Comentario novo dispara a automacao de teste.
- [ ] A fila muda o job para `sent`.