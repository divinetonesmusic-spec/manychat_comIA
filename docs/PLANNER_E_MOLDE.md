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
   - **Obrigatório no site no ar:** `ALLOWED_EMAILS=seu@email.com` (só esses e-mails entram com e-mail, link ou Google; vazio = só a senha de administrador).
   - `ADMIN_SESSION_SECRET` (32+ caracteres) e `ADMIN_PASSWORD` (12+). Sem eles, o login de administrador fica desligado em produção.

Sem R2 o planner funciona do mesmo jeito com **links públicos colados**; só o botão *Enviar* fica indisponível.

## Como o post anda

`rascunho` → `agendado` → (na hora) `publicando` → `publicado` → 1º comentário + automação → resultados a cada 6 h (até 30 dias) → depois de 3 dias a mídia sai do R2 (o original continua no Mac).

Se a Meta recusar: `erro` com a explicação em português e o botão **Tentar de novo**. Vídeo que a Meta não termina em 2 h (contadas do início da publicação) vira erro. Post preso é devolvido para a fila sozinho (até 3 tentativas); no carrossel, os itens já criados são aproveitados.

Cada post tem uma trava curta: se o relógio, a tela aberta e o Molde agirem ao mesmo tempo, só um mexe no post — o 1º comentário e a automação nunca saem em dobro. Mídia de post cancelado, de rascunho e de post com erro fica 14 dias sem mudança no R2 e depois é apagada (link colado de fora não é apagado). O post continua, com a nota "A mídia foi apagada do armazenamento depois de 14 dias parada. Envie a mídia de novo para agendar ou publicar." e o selo **Precisa de mídia nova** na tela; reagendar, publicar ou "Tentar de novo" pedem o arquivo de novo (o mesmo link antigo não serve).

Se a Meta pedir para esperar (limite de uso: códigos 4, 17, 32, 613, 80002, limite de publicações ou HTTP 429), o post que ia começar volta para `agendado` daqui a 30 min com a nota "A Meta pediu para esperar (limite de uso). Nova tentativa às HH:MM." e a tentativa não conta. Se a Meta não responder em 8 s, espera 5 min (a tentativa conta). Nas mensagens, o limite de uso faz o envio esperar 30, 60, 120 e depois 240 min, sem gastar as 3 tentativas (desiste depois de 6 esperas seguidas).

## Porta do Molde (para o robô do Mac)

Cabeçalho em todas as chamadas: `x-molde-token: <MOLDE_API_TOKEN>`.

- `GET /api/molde/accounts` → perfis conectados.
- `POST /api/molde/upload` `{ fileName, contentType, size, folder }` → `{ key, uploadUrl, publicUrl, size }`; o robô faz `PUT uploadUrl` com o arquivo. **`size` (em bytes) é obrigatório** desde a Fase 6 (sem ele: 400 "Falta o tamanho do arquivo (size, em bytes).") e vai assinado no link: o `PUT` tem de mandar `Content-Length` igual a `size` (o normal ao mandar um arquivo; envio em pedaços, sem `Content-Length`, é recusado pelo R2).
- `POST /api/molde/posts` → pacote do post. Campos: `accountId, publishType (reel_video|carousel|feed_image|story_video|story_image), title, caption, mediaUrl | mediaItems[], coverUrl, mediaKeys[], scheduledAt (ISO) | publishNow, firstComment, keyword, dmText, linkUrl, linkLabel, publicReply, automationOptions { quickReplyLabel, linkText, reminderText, publicReplies[], requireFollower }, externalRef, aiGenerated` (boolean; `true` = o Instagram mostra "feito com IA", no carrossel só no container pai; opcional, outro tipo é ignorado; precisa da migração 0006 — sem ela o campo é aceito mas o aviso não vai).
  **Aviso de bloqueio (N6/N13):** quando `aiGenerated: true` chega e a 0006 ainda não foi colada, o `POST` e o `PATCH` de `/api/molde/posts` (e `/api/content`) respondem com `warning` = "Falta colar a atualização 0006 no Supabase: o aviso de IA não foi guardado." — no corpo (`warning`) **e** dentro de `data.warning`, porque o robô do Mac 0.9.1 devolve à página só o `data` (o post é criado, mas `data.aiGenerated` volta `false`). **O Molde deve tratar esse `warning` como bloqueio**: não agendar nem publicar o Reel/carrossel/story de IA até a 0006 estar colada, porque o post sairia sem o aviso.
  Mandar de novo o mesmo `externalRef` **atualiza** (não duplica), enquanto não tiver sido publicado. Depois de publicado, responde **409** (o Molde manda a versão nova com outra referência).
  **Música do Instagram (0009):** campo opcional `musica: { audioId, titulo?, volumeMusica?, volumeVideo? }` (só `reel_video`/`feed_video`). `audioId` = o `id` da busca abaixo (texto ou número; obrigatório); `titulo` = o nome para mostrar (até 200 letras); `volumeMusica` e `volumeVideo` = números de 0 a 100 (fora disso vira a ponta; padrões 20 e 100). `musica: null` tira a música; sem o campo, não mexe. Formato errado: 400 "musica inválida: …"; outro tipo de post: 400 "Música do Instagram só vale para Reel.". As respostas trazem `data.musica` no mesmo formato (ou `null`). Avisos em `warning` (e `data.warning`): "Falta colar a atualização 0009 no Supabase: a música não foi guardada." (o post é criado sem música) e, no agendado/rascunho de uma conta sem a conexão pelo Facebook, "Para pôr música do Instagram, conecte esta conta também pelo Facebook em Perfis." — nesse caso, na hora de publicar, o post vira `failed` com essa frase em `lastError` (nunca sai sem a música). Veja [musica-instagram.md](musica-instagram.md).
  **Outras redes (0010):** campos opcionais `redes: ["instagram","facebook","threads","youtube"]` (o Instagram entra sempre; outras redes só em `reel_video`/`feed_video`), `youtubePrivacidade: "public"|"unlisted"|"private"` e `youtubeTitulo`. Rede desconhecida: 400. Rede não conectada: o post é salvo e `warning` diz qual falta. As respostas trazem `data.redes` e `data.redesStatus`. `PATCH { action: "retry_rede", rede }` tenta de novo uma rede com erro. Contratos completos em [redes-e-vendas.md](redes-e-vendas.md).
- `GET /api/molde/audio?conta=<accountId>&q=<busca>&tipo=music|original_sound` → músicas da biblioteca do Instagram para a conta (sem `q`: as em alta; `tipo` padrão `music`). `{ data: { conta, username, q, tipo, emAlta, musicas: [{ id, titulo, artista, duracaoMs, duracao ("m:ss"), tipo, capaUrl, previaUrl (prévia temporária, ~1,5 dia), linkPrevia, usuario (só original_sound) }] } }`. Erros `{ error, codigo }`: 400 `sem_conta` / `tipo_invalido`, 404 `conta_nao_encontrada`, 409 `sem_facebook` (conecte pelo Facebook em Perfis) / `facebook_vencido`, 503 `falta_0009`, 502 `meta` (a Meta recusou; a frase vem em `error`).
- `GET /api/molde/posts?refs=a,b` → status, link do post, resultados, `aiGenerated`, `musica` e `mediaDeleted` (`true` = a mídia saiu do R2; para publicar um rascunho ou post com erro assim, mande a mídia de novo).
- `PATCH /api/molde/posts/:id` (editar, `action: publish_now | retry | cancel`) e `DELETE /api/molde/posts/:id`.
- `GET /api/molde/resultados?accountId=&dias=90&limite=200` → todos os posts **publicados** (de qualquer origem: Molde ou tela Conteúdo) dos últimos `dias` (padrão 90, máximo 365), até `limite` (padrão 200, máximo 500), do mais novo para o mais velho: `{ data: [{ id, externalRef, source, accountId, username, publishType, title, captionInicio (140 caracteres, uma linha), publishedAt, permalink, insights, insightsAt, aiGenerated }] }`.
  **Atenção com `insights`:** o UaiFlow só atualiza os números de um post de 1 hora até **30 dias** depois de publicado (e no máximo a cada 6 horas); passou disso, ficam congelados. `insightsAt` mostra o dia da última leitura (`null` = nunca foi lido, e `insights` vem `{}`). O Molde deve tratar número de post com mais de 30 dias como **"última leitura"** (mostrando a data de `insightsAt`) e nunca como o número de hoje.
- `POST /api/molde/links` `{ accountId?, externalRef, destino, rotulo? }` → link rastreado do Reel: `{ data: { externalRef, slug, url, destino, criado } }` (201 se criou, 200 se já existia). Um por (perfil, `externalRef`): pedir de novo devolve o mesmo código; se o `destino` mudou, atualiza e os cliques continuam. `destino` tem de ser `https://` (senão 400). Precisa da 0006 (sem ela: 503 "Falta colar a atualização 0006 no Supabase (veja docs/ATUALIZACAO_0006.md).").
- `GET /api/molde/links?refs=a,b&accountId=` → `{ data: [{ externalRef, accountId, slug, url, destino, cliques: { total, d7, d30, porOrigem: { bio, dm, comentario, outro } } }] }`.
- `GET /l/<slug>` (pública, sem token): 302 para o destino e conta 1 clique; `?de=bio|dm|comentario` diz de onde veio (qualquer outro valor = `outro`). Robôs de prévia e `HEAD` não contam; não guarda IP nem navegador; link desconhecido (ou sem a 0006) = 404 "Link não encontrado."; se o banco estiver com problema e o servidor nunca tiver visto aquele código, 503 com `Retry-After: 5` (um código que o servidor já viu continua levando ao destino).
- `GET /api/molde/dms?accountId=` → DMs que **ninguém respondeu** (entram quando é mensagem de texto — DM ou resposta a story — e nenhuma palavra-chave serviu, não há automação padrão ligada, não é parar/começar, reação, eco, leitura, foto sem texto nem botão). Antes de responder, o UaiFlow marca `expirada` quem passou de 24 h sem falar e confere na fila o que já saiu. Devolve os `aguardando` e os que mudaram nas últimas 48 h: `{ data: [{ id, accountId, username, instagramUserId, mensagens: [{ texto, em }] (até 10, as mais novas), ultimaEm, prazoAte (última fala + 24 h - 10 min), status (aguardando|na_fila|enviada|nao_enviada|expirada|descartada), resposta, nota (frase em português: por que não saiu), conversa: [{ de: "pessoa"|"perfil", texto, em }] (as 6 últimas falas, da mais antiga à mais nova) }] }`. Sem a 0006: 503 "Falta colar a atualização 0006 no Supabase (veja docs/ATUALIZACAO_0006.md)." (o webhook segue normal e só não guarda).
- `POST /api/molde/dms/:id` `{ acao: "enviar", texto }` (1 a 1000 letras; senão 400) ou `{ acao: "descartar" }` → devolve o item. `enviar` põe a resposta aprovada na **fila normal** de envios (limite de 200 por hora: adia sem falhar; regra de 24 h: pula e o item vira `nao_enviada` com a frase), com `payload.origem = "molde_ia"`; o texto sai **exatamente** como aprovado (as `{{marcações}}` não são trocadas) e **não** liga a pausa de atendimento humano. Item que já foi respondido/descartado: 409 "Esta mensagem já foi respondida ou descartada."; prazo vencido: 409 "Passou o prazo de 24 h do Instagram para responder esta pessoa."; pessoa que pediu para parar: 409 "Esta pessoa pediu para não receber mensagens." (o item vira `descartada` com essa frase em `nota`); id que não existe: 404. Quem manda "parar" tem os itens `aguardando` descartados, a resposta aprovada que ainda estava na fila (`pending`, `origem: "molde_ia"`) é segurada (o job vira `skipped` e o item `nao_enviada`, os dois com "A pessoa pediu para não receber mensagens."), a confirmação de saída continua saindo, e as mensagens seguintes dela não entram na fila até mandar "começar". Itens fechados ou `na_fila` sem mudança há mais de 90 dias são apagados (o texto recebido continua também em `events`).

Os textos da automação (`automationOptions`) vão no idioma do avatar — o UaiFlow não traduz nada.

O UaiFlow segura em 95 posts publicados por perfil em 24 h (o Instagram aceita 100): passou disso, o post continua `scheduled`, com `scheduledAt` no horário em que a vaga abre e `lastError` = "Limite de 100 publicações em 24 h do Instagram: sai às HH:MM.". Nunca vira `failed` por isso. Story (`story_image`, `story_video`) não tem 1º comentário nem palavra-chave: esses campos são ignorados depois de publicar.
