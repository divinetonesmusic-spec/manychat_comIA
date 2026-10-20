# Outras redes e vendas por webhook

Esta atualização traz duas coisas, as duas **opcionais** e desligadas até você configurar:

1. **Outras redes:** o mesmo Reel que sai no Instagram pode sair também na **Página do Facebook** (como Reel), no **Threads** e no **YouTube Shorts**.
2. **Vendas por webhook:** as vendas e os reembolsos da **Stripe**, **Whop**, **Gumroad**, **Payhip** e **Cakto** chegam sozinhos ao UaiFlow, e o Molde vê os totais por produto.

Sem as variáveis de uma rede ou plataforma, nada muda: o botão dela em Perfis avisa que falta configurar, e o Instagram continua saindo do jeito de sempre.

## Como funciona a publicação nas outras redes

- O **Instagram é sempre a rede principal**. Ele sai primeiro, como hoje.
- Quando o Instagram termina (publicado **ou** com erro), o relógio do UaiFlow manda o mesmo vídeo para as redes marcadas no post.
- **Uma rede com erro não segura nem desfaz as outras.** Cada rede tem a sua situação: na fila, publicando, publicado ou com erro.
- Cada rede tenta **3 vezes** (5 e 10 minutos depois; se a Meta pedir para esperar, 30 minutos). Depois fica "Com erro" e aparece o botão **«Tentar de novo»** daquela rede (na tela Conteúdo e pela API do Molde).
- Falta de conexão (rede não conectada, conexão vencida) dá erro na hora, sem ficar tentando.
- **Reel** (vídeo) vai para todas as outras redes. A **foto do feed** também pode ir para a **Página do Facebook** (0011, veja [vendas-escada.md](vendas-escada.md)). Carrossel e story continuam só no Instagram.
- A mídia só sai do armazenamento (R2) depois que todas as redes terminaram.

### Limites de cada rede

| Rede | Como sai | Limites |
| --- | --- | --- |
| Facebook (Página) | Reel da Página, com a legenda como descrição | Vídeo de 3 a 90 s, 9:16. A Meta aceita até 30 Reels por API por Página em 24 h. |
| Threads | Post de vídeo com a legenda | Texto até 500 caracteres (o UaiFlow corta com "…"; emoji conta mais de 1). Vídeo até 5 min. |
| YouTube Shorts | Vídeo com título (até 100 caracteres), descrição + `#Shorts`, "não é para crianças" | Vídeo até 3 min e 9:16 para virar Short. O envio vai em pedaços de 8 MB por minuto do relógio; vídeos até 512 MB. |

**Por que o YouTube vai em pedaços:** as funções do Netlify só rodam por alguns segundos. O UaiFlow abre a sessão de envio do YouTube e, a cada minuto do relógio, manda o pedaço que couber (padrão 8 MB; mude com `YOUTUBE_CHUNK_MB`). Um Reel de 40 MB leva uns 5 minutos para terminar de subir. Se um pedaço falhar, a próxima rodada pergunta ao YouTube quanto já chegou e continua dali.

## 1 · Atualização do banco: 0010

Cole o arquivo `supabase/migrations/0010_redes_e_vendas.sql` no editor SQL do Supabase (ou rode `npm run db:migrate`). Ele cria:

- em `content_posts`: as colunas `redes` (padrão `{instagram}`), `youtube_privacidade` (padrão `public`) e `youtube_titulo`;
- a tabela `content_post_redes` (o resultado de cada rede extra por post);
- as tabelas `threads_connections` e `youtube_connections` (uma conexão por conta do Instagram);
- a coluna `granted_scopes` na conexão pelo Facebook (só se a 0009 já foi colada);
- a tabela `vendas`.

Todas as tabelas novas saem com a segurança por linha (RLS) ligada e sem nenhuma política: só o servidor do UaiFlow lê e grava.

Pode ser colada mais de uma vez, antes ou depois de publicar o site (de preferência antes). Sem ela: o Instagram sai como sempre; o campo `redes` mandado pelo Molde não é guardado (aviso "Falta colar a atualização 0010…"); os botões do Threads e do YouTube pedem a 0010; os webhooks de venda respondem 503 (a plataforma tenta de novo mais tarde).

**Tokens:** os tokens do Threads e o refresh token do YouTube ficam no banco em texto, do mesmo jeito que os do Instagram e do Facebook (proteção: RLS sem políticas, só o servidor lê; nunca vão para o navegador nem para o Molde). Se um dia quiser criptografar, é uma mudança para todas as conexões juntas.

## 2 · Facebook (Página)

Usa a **mesma conexão pelo Facebook** da música do Instagram ([musica-instagram.md](musica-instagram.md)), com uma permissão a mais.

1. No app da Meta (developers.facebook.com), no Login do Facebook, peça também a permissão **`pages_manage_posts`**. A lista completa fica:
   - `instagram_basic`, `instagram_content_publish` (música)
   - `pages_show_list`, `pages_read_engagement`, **`pages_manage_posts`** (Reel na Página)
2. Com o app em **modo de desenvolvimento**, só quem tem papel no app consegue conectar. Para outras pessoas, o app precisa estar **ao vivo** com essas permissões aprovadas na Análise do app (acesso avançado).
3. Quem conecta precisa poder **criar conteúdo** na Página (administrador ou acesso total).
4. Em **Perfis**, toque em **«Reconectar pelo Facebook»** em cada conta (as conexões antigas, feitas só para a música, não têm a permissão nova). A conta passa a mostrar "Página do Facebook: publica Reels".
5. A Meta baixa o vídeo direto do R2: o endereço público do R2 precisa aceitar o robô da Meta (`facebookexternalhit/1.1`), o que já acontece com o domínio público padrão do R2.

Variáveis: as mesmas da música (`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, opcional `FACEBOOK_REDIRECT_URI`).

## 3 · Threads

O Threads tem um app próprio (o ID e a chave são diferentes dos do Facebook e do Instagram).

1. Em developers.facebook.com, crie um app (ou use o mesmo) e adicione o caso de uso **"Acessar a API do Threads"**.
2. Em Permissões, adicione **`threads_basic`** e **`threads_content_publish`**.
3. Em Configurações do Threads, cadastre o endereço de retorno (Redirect Callback URL):

   ```
   https://SEU-SITE/api/oauth/threads/callback
   ```

   Os campos de "desinstalar" e "excluir dados" podem apontar para `https://SEU-SITE/exclusao-de-dados`.
4. Com o app em desenvolvimento, adicione a conta do Threads como **Testador do Threads** (Funções do app → Testadores) e aceite o convite no Threads (Configurações → Conta → Permissões de sites). Para outras pessoas, o app precisa passar pela Análise do app.
5. Copie o **ID do app do Threads** e a **Chave secreta do app do Threads**.
6. Em **Perfis**, toque em **«Conectar Threads»** na conta.

| Variável | O que é |
| --- | --- |
| `THREADS_APP_ID` | ID do app do Threads. |
| `THREADS_APP_SECRET` | Chave secreta do app do Threads. É segredo. |
| `THREADS_REDIRECT_URI` | Opcional. Só se o retorno for diferente de `APP_BASE_URL` + `/api/oauth/threads/callback`. |

O token do Threads vale 60 dias e é renovado pelo relógio de tokens (`/api/token/refresh`), junto com o Instagram e o Facebook. Se vencer mesmo assim, use «Reconectar Threads».

## 4 · YouTube (Google Cloud)

1. Em console.cloud.google.com, crie um projeto (ou use um).
2. **APIs e serviços → Biblioteca:** ative a **YouTube Data API v3**.
3. **Tela de consentimento OAuth** (Google Auth Platform): tipo **Externo**; preencha nome do app, e-mail de suporte, domínio do site (`SEU-SITE`) e links de privacidade (`https://SEU-SITE/privacidade`). Em Escopos, adicione **`https://www.googleapis.com/auth/youtube.upload`**.
4. Enquanto o app estiver em **"Teste"**, adicione o seu Gmail (o dono do canal) em **Usuários de teste**. Atenção: **no modo "Teste", a autorização vence em 7 dias** (o Google apaga o refresh token). Depois disso o YouTube fica "Com erro" pedindo para reconectar. Para não vencer, publique o app ("Em produção"); o escopo `youtube.upload` é sensível e o Google pede a verificação do app.
5. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web.** Em "URIs de redirecionamento autorizados", cadastre:

   ```
   https://SEU-SITE/api/oauth/youtube/callback
   ```

6. Copie o **ID do cliente** e a **Chave secreta do cliente**.
7. Em **Perfis**, toque em **«Conectar YouTube»** e entre com a conta Google dona do canal.

| Variável | O que é |
| --- | --- |
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth (termina em `.apps.googleusercontent.com`). |
| `GOOGLE_CLIENT_SECRET` | Chave secreta do cliente. É segredo. |
| `GOOGLE_REDIRECT_URI` | Opcional. Só se o retorno for diferente de `APP_BASE_URL` + `/api/oauth/youtube/callback`. |
| `YOUTUBE_CHUNK_MB` | Opcional. Tamanho do pedaço enviado por minuto (padrão 8). |

**Vídeos privados até a auditoria:** o Google trava como **privados** os vídeos enviados por projetos da API que ainda não passaram pela auditoria do YouTube (regra em vigor desde julho de 2020). Mesmo escolhendo "Público", o vídeo pode ficar privado. Para liberar, peça a auditoria do projeto no formulário "YouTube API Services – Audit and Quota Extension". Até lá, confira os vídeos no YouTube Studio e mude para público à mão.

**Cota:** cada envio gasta cota da YouTube Data API (o projeto novo tem 10.000 unidades por dia; um envio custa cerca de 100 unidades pela conta antiga, ou 1 unidade no balde novo de envios). Dá folga para vários Shorts por dia.

A privacidade é escolhida por post (padrão **Público**): na tela Conteúdo, ao marcar YouTube Shorts, ou pelo Molde em `youtubePrivacidade`.

## 5 · Vendas por webhook

Cada plataforma só funciona com o seu segredo nas variáveis do Netlify. Sem ele, o endereço responde 503 e nada é gravado. O UaiFlow guarda só o mínimo: plataforma, produto, valor, moeda, situação (paga, reembolsada, reembolso parcial, contestada) e datas. **Nenhum e-mail, nome ou telefone de cliente.** O mesmo aviso mandado duas vezes não duplica a venda.

**Produto de cada venda (`produtoRef`):** o UaiFlow usa, nesta ordem, a referência que você mandou no link de compra e, se não houver, o id do produto na plataforma. Para separar as vendas por Reel ou por campanha, ponha uma referência no link:

| Plataforma | Como pôr a referência |
| --- | --- |
| Stripe | Link de pagamento com `?client_reference_id=ebook-sono` (ou `metadata.produto_ref` / `metadata.ref` no checkout). Sem isso: o id do link de pagamento. |
| Whop | `metadata.ref` (ou `metadata.produto_ref`) no checkout. Sem isso: o id do produto. |
| Gumroad | `?ref=planner-ig` no link do produto (o Gumroad devolve em `url_params`). Sem isso: o final do link do produto. |
| Payhip | Sem referência no link: usa a chave do produto (`product_key`). |
| Cakto | `?ref=mentoria-ig` no link do checkout. Sem isso: o id curto do produto. |

### Stripe

1. Painel da Stripe → **Desenvolvedores → Webhooks → Adicionar endpoint**.
2. URL: `https://SEU-SITE/api/webhooks/stripe`
3. Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`.
4. Copie o **Segredo de assinatura** (começa com `whsec_`) para `STRIPE_WEBHOOK_SECRET`.

### Whop

1. Painel da Whop → **Developer → Webhooks → Create webhook**.
2. URL: `https://SEU-SITE/api/webhooks/whop`
3. Eventos: `payment.succeeded`, `refund.created`, `refund.updated` (e `dispute.created`, se quiser marcar contestações).
4. Copie o segredo (começa com `ws_`) para `WHOP_WEBHOOK_SECRET`. O UaiFlow confere a assinatura (padrão Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature`) e recusa avisos com mais de 5 minutos.

### Gumroad

O Gumroad não assina os avisos ("Ping"). Por isso o segredo vai no próprio endereço:

1. Crie uma chave longa e aleatória (24+ caracteres) e ponha em `GUMROAD_WEBHOOK_KEY`.
2. Gumroad → **Settings → Advanced → Ping**: `https://SEU-SITE/api/webhooks/gumroad?key=SUA_CHAVE`
3. Opcional, mais seguro: crie um token em **Settings → Advanced → Applications** e ponha em `GUMROAD_ACCESS_TOKEN`. Com ele, o UaiFlow confere cada venda na API do Gumroad (`GET /v2/sales/{id}`) antes de gravar.
4. Os reembolsos chegam pelo mesmo Ping (`refunded=true`). Se você usar as assinaturas de recurso da API (`resource_name` = `sale`, `refund`, `dispute`), aponte todas para o mesmo endereço.

### Payhip

1. Payhip → **Settings → Developer**: copie a **API Key** para `PAYHIP_API_KEY`.
2. Em **Settings → Developer → Webhooks**, cadastre `https://SEU-SITE/api/webhooks/payhip` para os eventos `paid` e `refunded`.
3. O Payhip manda no aviso o campo `signature` (o SHA-256 da sua API Key); o UaiFlow confere esse valor. (É uma proteção fraca: quem souber a chave consegue imitar. Não compartilhe a API Key.)

### Cakto

1. Cakto → **Integrações → Webhooks → Adicionar**.
2. URL: `https://SEU-SITE/api/webhooks/cakto`
3. Eventos: `purchase_approved` (compra aprovada), `refund` (reembolso) e `chargeback`.
4. Copie o **segredo** do webhook para `CAKTO_WEBHOOK_SECRET`. A Cakto manda esse segredo no corpo do aviso (campo `secret`) e o UaiFlow compara.

### Variáveis das vendas

| Variável | Plataforma |
| --- | --- |
| `STRIPE_WEBHOOK_SECRET` | Stripe (`whsec_...`) |
| `WHOP_WEBHOOK_SECRET` | Whop (`ws_...`) |
| `GUMROAD_WEBHOOK_KEY` | Gumroad (a chave do `?key=`) |
| `GUMROAD_ACCESS_TOKEN` | Gumroad, opcional (confere a venda na API) |
| `PAYHIP_API_KEY` | Payhip |
| `CAKTO_WEBHOOK_SECRET` | Cakto |

## 6 · Para o Molde (API)

Todas as rotas com o cabeçalho `x-molde-token`.

### Posts: `redes`

`POST /api/molde/posts` e `PATCH /api/molde/posts/:id` aceitam:

```json
{
  "redes": ["instagram", "facebook", "threads", "youtube"],
  "youtubePrivacidade": "public",
  "youtubeTitulo": "Título opcional (até 100 caracteres)"
}
```

- `redes`: lista com `instagram`, `facebook`, `threads` e/ou `youtube`. Sem o campo: não mexe (post novo = `["instagram"]`). O Instagram entra sempre (se faltar, entra sozinho e vem o aviso "O Instagram é sempre a rede principal: foi incluído nas redes do post.").
- Rede desconhecida ou formato errado: **400** `{ "error": "redes inválidas: mande uma lista com instagram, facebook, threads e/ou youtube." }`.
- Outras redes em post que não é Reel: **400** `{ "error": "Facebook, Threads e YouTube só valem para Reel (vídeo)." }`.
- `youtubePrivacidade`: `public` (padrão), `unlisted` ou `private`; outro valor: 400.
- Rede marcada que **não está conectada** na conta: o post é salvo do mesmo jeito e vem `warning` (também em `data.warning`), por exemplo `"Não conectado nesta conta: YouTube Shorts. Conecte em Perfis antes do horário; o Instagram sai normalmente."`. Se continuar sem conexão na hora, aquela rede fica `failed`.
- Sem a 0010: o post é salvo só para o Instagram, com `warning` "Falta colar a atualização 0010 no Supabase: o post sai só no Instagram (as outras redes não foram guardadas)."

As respostas (e o `GET /api/molde/posts`) trazem:

```json
{
  "redes": ["instagram", "threads", "youtube"],
  "redesStatus": {
    "instagram": { "status": "published", "externalId": "1789...", "permalink": "https://www.instagram.com/reel/...", "erro": null, "publishedAt": "2026-10-18T12:00:00.000Z" },
    "threads": { "status": "published", "externalId": "1801...", "permalink": "https://www.threads.net/@conta/post/...", "erro": null, "publishedAt": "2026-10-18T12:01:10.000Z", "tentativas": 0 },
    "youtube": { "status": "processing", "externalId": null, "permalink": null, "erro": "Enviando o vídeo ao YouTube (40%).", "publishedAt": null, "tentativas": 0 }
  },
  "youtubePrivacidade": "public",
  "youtubeTitulo": null
}
```

- `redesStatus.instagram.status` é o `status` do post (`draft`, `scheduled`, `publishing`, `published`, `failed`, `canceled`).
- As outras redes: `pending` (na fila: espera o Instagram terminar ou a próxima tentativa), `processing`, `published` ou `failed`. Em `pending`/`processing`, `erro` pode trazer uma nota de andamento ou o erro da última tentativa.
- **Tentar de novo uma rede:** `PATCH /api/molde/posts/:id` com `{ "action": "retry_rede", "rede": "threads" }`. Só vale para rede em `failed` (senão 409). Rede inválida: 400. A publicada nunca é repetida.

### Contas: redes conectadas

`GET /api/molde/accounts` traz, em cada conta, o campo `redes`, e no topo `redesConfiguradas`:

```json
{
  "data": [
    {
      "id": "…", "username": "conta", "connected": true,
      "redes": {
        "instagram": { "conectado": true, "configurado": true },
        "facebook": { "conectado": false, "configurado": true, "motivo": "Reconecte pelo Facebook em Perfis para liberar a publicação na Página (pages_manage_posts)." },
        "threads": { "conectado": true, "configurado": true, "nome": "conta" },
        "youtube": { "conectado": false, "configurado": true, "motivo": "Conecte o YouTube em Perfis." }
      }
    }
  ],
  "redesConfiguradas": { "facebook": true, "threads": true, "youtube": true }
}
```

`configurado` = o servidor tem as variáveis daquela rede. Nunca vem token.

### Vendas

`GET /api/molde/vendas?dias=30` (1 a 365; padrão 30). Vendas de teste das plataformas ficam de fora. Sem dado pessoal.

```json
{
  "data": {
    "dias": 30,
    "desde": "2026-09-18T12:00:00.000Z",
    "totais": [{ "moeda": "BRL", "vendas": 3, "reembolsos": 0, "contestacoes": 0, "bruto": 192.8, "reembolsado": 0, "liquido": 192.8 }],
    "porProduto": [{ "produtoRef": "ebook-sono", "produtoId": "plink_1", "produtoNome": null, "plataforma": "stripe", "moeda": "BRL", "vendas": 2, "reembolsos": 0, "contestacoes": 0, "bruto": 95.8, "reembolsado": 0, "liquido": 95.8 }],
    "porPlataforma": [{ "plataforma": "stripe", "moeda": "BRL", "vendas": 2, "reembolsos": 0, "contestacoes": 0, "bruto": 95.8, "reembolsado": 0, "liquido": 95.8 }],
    "ultimas": [{ "id": "…", "plataforma": "stripe", "produtoRef": "ebook-sono", "produtoId": "plink_1", "produtoNome": null, "valor": 47.9, "moeda": "BRL", "status": "paga", "valorReembolsado": 0, "criadoEm": "2026-10-18T11:00:00.000Z" }]
  }
}
```

- Valores na unidade da moeda (47.9 = R$ 47,90). Moedas diferentes nunca são somadas juntas.
- `vendas` conta todas as vendas do período (inclusive as reembolsadas); `liquido` = `bruto` − `reembolsado` (contestação conta como reembolsado).
- Sem a 0010: 503 `{ "codigo": "falta_0010" }`.

## O que conferir depois de configurar

- `npm run setup:check` avisa variáveis pela metade (só o ID sem a chave, endereço de retorno diferente do esperado).
- Em **Perfis**, cada conta mostra "Página do Facebook: publica Reels", "Threads conectado" e "YouTube conectado".
- Em **Conteúdo**, num Reel, o bloco **"Publicar também em"** mostra só as redes conectadas liberadas; depois de publicado, o painel do post mostra a situação de cada rede e o link.
- Vendas: em cada plataforma, use o botão de "enviar teste" do webhook. O teste da Stripe (modo teste) é gravado como venda de teste e não entra no resumo.
