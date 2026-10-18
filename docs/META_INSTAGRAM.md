# Meta e Instagram

O UaiFlow depende de uma conta profissional do Instagram conectada a um app Meta.

## Rotas do app

Use o dominio final da Vercel quando estiver em producao.

```text
OAuth redirect URI: https://SEU-DOMINIO/api/oauth/callback
Webhook callback URL: https://SEU-DOMINIO/api/webhook
Privacy policy URL: https://SEU-DOMINIO/privacy-policy
Data deletion URL: https://SEU-DOMINIO/data-deletion
```

As rotas em portugues tambem existem:

```text
/privacidade
/exclusao-de-dados
```

## Variaveis

```text
INSTAGRAM_APP_ID
INSTAGRAM_APP_SECRET
INSTAGRAM_REDIRECT_URI
WEBHOOK_VERIFY_TOKEN
META_API_VERSION=v25.0
```

## Escopos usados

O fluxo OAuth pede:

```text
instagram_business_basic
instagram_business_manage_messages
instagram_business_manage_comments
instagram_business_content_publish
instagram_business_manage_insights
```

## Webhook

A verificacao GET do webhook compara `hub.verify_token` com `WEBHOOK_VERIFY_TOKEN`. Os POSTs sao validados com `x-hub-signature-256` usando `INSTAGRAM_APP_SECRET`.

## Teste inicial

1. Abra `Perfis` no UaiFlow.
2. Conecte a conta do Instagram.
3. Confirme que o perfil aparece na tela.
4. Crie uma automacao com uma palavra-chave simples.
5. Comente essa palavra em um post/reel da conta conectada ou envie uma DM de teste.

## Música do Instagram (opcional)

Para publicar Reels com música da biblioteca do Instagram, cada conta precisa também de uma conexão pelo **Login do Facebook** (a Audio API da Meta só existe nesse caminho). Passo a passo, permissões, variáveis (`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`) e a migração 0009: [musica-instagram.md](musica-instagram.md).
