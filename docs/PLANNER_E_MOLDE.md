# Planner de conteúdo + Molde do Avatar

O UaiFlow agora agenda e publica sozinho (Reel, carrossel, foto e story) e, na hora em que o post sai, faz o **1º comentário** e liga a **automação da palavra-chave** (comentou → resposta pública → DM com o botão do link). Também guarda os **resultados** (views, alcance, curtidas, comentários, compartilhamentos, salvos).

## O que mudou

| Parte | O que faz |
| --- | --- |
| `supabase/migrations/0002_planner_molde.sql` | Novos status (agendado, cancelado), horário, pacote do post (legenda, 1º comentário, palavra, DM, link, textos da automação), resultados e limpeza de mídia. |
| `/conteudo` | Calendário do mês (no celular: pontinhos + lista do dia), lista, novo post com envio de arquivo, agendar/agora/rascunho, funil, resultados, tentar de novo e excluir em 2 cliques. |
| `/api/queue/drain` | O relógio (pg_cron a cada minuto) agora envia a fila **e** cuida do planner, tudo em ~9 s (cabe no plano grátis). |
| `/api/content`, `/api/content/[id]` | Criar, editar, reagendar, publicar agora, tentar de novo, cancelar e excluir. |
| `/api/uploads/presign` | Link assinado para o navegador mandar o arquivo direto para o R2. |
| `/api/molde/*` | Porta do Molde do Avatar (token próprio): contas, envio de mídia, posts (sem duplicar) e situação/resultados. |

## Passo a passo (uma vez só)

1. **Banco**: `npm run db:migrate` (aplica a 0002; pode rodar de novo sem problema).
2. **Cloudflare R2** (grátis até 10 GB):
   - Crie o bucket (ex.: `uaiflow-midia`).
   - Em *Settings → Public access*, ligue o **endereço público r2.dev** (ou um domínio seu). Esse endereço vai em `R2_PUBLIC_BASE_URL`. A Meta precisa baixar o vídeo por ele.
   - Em *Settings → CORS policy*, cole:
     ```json
     [{ "AllowedOrigins": ["https://SEU-DOMINIO-DO-UAIFLOW"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
     ```
   - Em *R2 → Manage API tokens*, crie um token **Object Read & Write** só para esse bucket.
3. **Variáveis do servidor** (Netlify/Render/Vercel → Environment variables):
   ```
   R2_ACCOUNT_ID=        # id da conta Cloudflare
   R2_ACCESS_KEY_ID=     # do token criado
   R2_SECRET_ACCESS_KEY= # do token criado
   R2_BUCKET=uaiflow-midia
   R2_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev
   MOLDE_API_TOKEN=      # 24+ caracteres aleatórios; o mesmo vai no robô do Molde
   CRON_BUDGET_MS=9000   # opcional: tempo máximo de cada minuto do relógio
   ```
4. **Relógio**: o `supabase/cron.sql` de sempre (a cada minuto em `/api/queue/drain`). Em produção o relógio **exige** `WORKER_SECRET` no cabeçalho `x-worker-secret` (não aceita mais `?secret=` na URL).
5. **Segurança (obrigatório antes de publicar o UaiFlow na internet)**:
   - No Supabase: *Authentication → Sign In / Providers → desligue "Allow new users to sign up"* (senão qualquer pessoa cria conta e mexe no seu Instagram).
   - Opcional, mas recomendado: `ALLOWED_EMAILS=seu@email.com` (só esses e-mails entram).
   - `ADMIN_SESSION_SECRET` (32+ caracteres) e `ADMIN_PASSWORD` (12+). Sem eles, o login de administrador fica desligado em produção.

Sem R2 o planner funciona do mesmo jeito com **links públicos colados**; só o botão *Enviar* fica indisponível.

## Como o post anda

`rascunho` → `agendado` → (na hora) `publicando` → `publicado` → 1º comentário + automação → resultados a cada 6 h (até 30 dias) → depois de 3 dias a mídia sai do R2 (o original continua no Mac).

Se a Meta recusar: `erro` com a explicação em português e o botão **Tentar de novo**. Vídeo que a Meta não termina em 2 h (contadas do início da publicação) vira erro. Post preso é devolvido para a fila sozinho (até 3 tentativas); no carrossel, os itens já criados são aproveitados.

Cada post tem uma trava curta: se o relógio, a tela aberta e o Molde agirem ao mesmo tempo, só um mexe no post — o 1º comentário e a automação nunca saem em dobro. Mídia de post cancelado fica 14 dias no R2; se ela já tiver sido apagada, reagendar pede o arquivo de novo.

## Porta do Molde (para o robô do Mac)

Cabeçalho em todas as chamadas: `x-molde-token: <MOLDE_API_TOKEN>`.

- `GET /api/molde/accounts` → perfis conectados.
- `POST /api/molde/upload` `{ fileName, contentType, size, folder }` → `{ key, uploadUrl, publicUrl }`; o robô faz `PUT uploadUrl` com o arquivo.
- `POST /api/molde/posts` → pacote do post. Campos: `accountId, publishType (reel_video|carousel|feed_image|story_video|story_image), title, caption, mediaUrl | mediaItems[], coverUrl, mediaKeys[], scheduledAt (ISO) | publishNow, firstComment, keyword, dmText, linkUrl, linkLabel, publicReply, automationOptions { quickReplyLabel, linkText, reminderText, publicReplies[], requireFollower }, externalRef`.
  Mandar de novo o mesmo `externalRef` **atualiza** (não duplica), enquanto não tiver sido publicado. Depois de publicado, responde **409** (o Molde manda a versão nova com outra referência).
- `GET /api/molde/posts?refs=a,b` → status, link do post e resultados.
- `PATCH /api/molde/posts/:id` (editar, `action: publish_now | retry | cancel`) e `DELETE /api/molde/posts/:id`.

Os textos da automação (`automationOptions`) vão no idioma do avatar — o UaiFlow não traduz nada.
