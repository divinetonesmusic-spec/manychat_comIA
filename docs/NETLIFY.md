# Netlify (onde o UaiFlow fica no ar)

O UaiFlow que está no ar roda no **Netlify** (site `uaiflow-divinetones`, endereço `https://uaiflow-divinetones.netlify.app`). O Netlify reconhece o projeto como Next.js sozinho; não precisa de arquivo de configuração.

## Configuração do site

```text
Build command: npm run build
Publish directory: .next
Node: 20 ou mais novo
```

Se o site estiver ligado ao GitHub, cada envio para a branch `main` gera uma publicação nova. Para publicar na mão: **Deploys** → **Trigger deploy** → **Deploy site**, e espere ficar verde (**Published**).

## Variáveis de ambiente

No Netlify: **Site configuration** → **Environment variables**. Copie todas as chaves de `.env.example`. No site no ar, confira:

```text
APP_BASE_URL=https://uaiflow-divinetones.netlify.app
INSTAGRAM_REDIRECT_URI=https://uaiflow-divinetones.netlify.app/api/oauth/callback
ALLOWED_EMAILS=seu-email@gmail.com
```

- `ALLOWED_EMAILS` é **obrigatório** no site no ar: só quem está nessa lista entra com e-mail, link ou Google. Vazio, ninguém entra assim; só com a senha de administrador (`ADMIN_PASSWORD`).
- Use valores fortes e diferentes para `ADMIN_SESSION_SECRET`, `WORKER_SECRET` e `WEBHOOK_VERIFY_TOKEN` (32 caracteres ou mais). Trocar o `ADMIN_SESSION_SECRET` desconecta todo mundo que entrou com a senha de administrador.
- As variáveis só valem depois de publicar o site de novo.
- `npm run setup:check` (no computador, com o `.env.local`) avisa o que falta.

## Limites do plano grátis

As funções do Netlify param em cerca de 10 segundos. Por isso o relógio (`/api/queue/drain`) trabalha em ~9 s por minuto e deixa o resto para o minuto seguinte, e cada chamada à Meta desiste em 8 s.

## Depois da primeira publicação

1. Copie o endereço final do site.
2. Atualize as URLs no Supabase (**Authentication** → **URL Configuration**) e desligue o cadastro de contas novas (**Authentication** → **Sign In / Providers** → desmarque **Allow new users to sign up**).
3. Atualize as URLs no app da Meta.
4. Edite uma cópia de `supabase/cron.sql` com o endereço do site e o `WORKER_SECRET` e rode no SQL Editor do Supabase (não salve a cópia com o segredo).
5. Abra `https://SEU-SITE.netlify.app/api/health`: em 1 ou 2 minutos deve aparecer `"ok":true`.

Para um roteiro passo a passo, veja o [guia completo para novo proprietário](GUIA_COMPLETO_NOVO_PROPRIETARIO.md). O guia ainda descreve a instalação pela Vercel; os passos são parecidos, mas os nomes dos botões do Netlify estão aqui.
