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
- `POST /api/molde/posts` → pacote do post. Campos: `accountId, publishType (reel_video|carousel|feed_image|story_video|story_image), title, caption, mediaUrl | mediaItems[], coverUrl, mediaKeys[], scheduledAt (ISO) | publishNow, firstComment, keyword, dmText, linkUrl, linkLabel, publicReply, automationOptions { quickReplyLabel, linkText, reminderText, publicReplies[], requireFollower }, externalRef, aiGenerated` (boolean; `true` = o Instagram mostra "feito com IA", no carrossel só no container pai; opcional, outro tipo é ignorado; precisa da migração 0006 — sem ela o campo é aceito mas o aviso não vai).
  **Aviso de bloqueio (N6/N13):** quando `aiGenerated: true` chega e a 0006 ainda não foi colada, o `POST` e o `PATCH` de `/api/molde/posts` (e `/api/content`) respondem com `warning` = "Falta colar a atualização 0006 no Supabase: o aviso de IA não foi guardado." — no corpo (`warning`) **e** dentro de `data.warning`, porque o robô do Mac 0.9.1 devolve à página só o `data` (o post é criado, mas `data.aiGenerated` volta `false`). **O Molde deve tratar esse `warning` como bloqueio**: não agendar nem publicar o Reel/carrossel/story de IA até a 0006 estar colada, porque o post sairia sem o aviso.
  Mandar de novo o mesmo `externalRef` **atualiza** (não duplica), enquanto não tiver sido publicado. Depois de publicado, responde **409** (o Molde manda a versão nova com outra referência).
- `GET /api/molde/posts?refs=a,b` → status, link do post, resultados e `aiGenerated`.
- `PATCH /api/molde/posts/:id` (editar, `action: publish_now | retry | cancel`) e `DELETE /api/molde/posts/:id`.
- `GET /api/molde/resultados?accountId=&dias=90&limite=200` → todos os posts **publicados** (de qualquer origem: Molde ou tela Conteúdo) dos últimos `dias` (padrão 90, máximo 365), até `limite` (padrão 200, máximo 500), do mais novo para o mais velho: `{ data: [{ id, externalRef, source, accountId, username, publishType, title, captionInicio (140 caracteres, uma linha), publishedAt, permalink, insights, insightsAt, aiGenerated }] }`.
  **Atenção com `insights`:** o UaiFlow só atualiza os números de um post de 1 hora até **30 dias** depois de publicado (e no máximo a cada 6 horas); passou disso, ficam congelados. `insightsAt` mostra o dia da última leitura (`null` = nunca foi lido, e `insights` vem `{}`). O Molde deve tratar número de post com mais de 30 dias como **"última leitura"** (mostrando a data de `insightsAt`) e nunca como o número de hoje.
- `POST /api/molde/links` `{ accountId?, externalRef, destino, rotulo? }` → link rastreado do Reel: `{ data: { externalRef, slug, url, destino, criado } }` (201 se criou, 200 se já existia). Um por (perfil, `externalRef`): pedir de novo devolve o mesmo código; se o `destino` mudou, atualiza e os cliques continuam. `destino` tem de ser `https://` (senão 400). Precisa da 0006 (sem ela: 503 "Falta colar a atualização 0006 no Supabase (veja docs/ATUALIZACAO_0006.md).").
- `GET /api/molde/links?refs=a,b&accountId=` → `{ data: [{ externalRef, accountId, slug, url, destino, cliques: { total, d7, d30, porOrigem: { bio, dm, comentario, outro } } }] }`.
- `GET /l/<slug>` (pública, sem token): 302 para o destino e conta 1 clique; `?de=bio|dm|comentario` diz de onde veio (qualquer outro valor = `outro`). Robôs de prévia e `HEAD` não contam; não guarda IP nem navegador; link desconhecido (ou sem a 0006) = 404 "Link não encontrado."; se o banco estiver com problema e o servidor nunca tiver visto aquele código, 503 com `Retry-After: 5` (um código que o servidor já viu continua levando ao destino).

Os textos da automação (`automationOptions`) vão no idioma do avatar — o UaiFlow não traduz nada.

O UaiFlow segura em 95 posts publicados por perfil em 24 h (o Instagram aceita 100): passou disso, o post continua `scheduled`, com `scheduledAt` no horário em que a vaga abre e `lastError` = "Limite de 100 publicações em 24 h do Instagram: sai às HH:MM.". Nunca vira `failed` por isso. Story (`story_image`, `story_video`) não tem 1º comentário nem palavra-chave: esses campos são ignorados depois de publicar.
