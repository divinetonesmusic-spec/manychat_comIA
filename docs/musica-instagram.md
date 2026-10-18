# Música do Instagram nos Reels

O UaiFlow consegue publicar um Reel já com uma música da biblioteca do Instagram, com o volume da música e o da voz/vídeo escolhidos por você. Isso usa a **Audio API** da Meta.

A Meta só oferece a Audio API no caminho **"Instagram API with Facebook Login"** (pelo Facebook, com a Página ligada à conta). O UaiFlow, no resto, usa o **"Instagram API with Instagram Login"**. Por isso cada conta que vai usar música precisa de uma **segunda conexão, pelo Facebook**. Ela é opcional: sem ela, tudo continua igual, só sem música.

## O que fazer na Meta (uma vez)

1. **Conta do Instagram profissional ligada a uma Página do Facebook.** A conta precisa ser comercial ou de criador de conteúdo e estar ligada a uma Página. Faça a ligação no app do Instagram (Editar perfil → Página) ou no Meta Business Suite. Quem for fazer o login do Facebook precisa ter acesso de administrador (ou controle total) a essa Página.
2. **Login do Facebook no app da Meta.** No painel de desenvolvedores (developers.facebook.com), abra o app do UaiFlow (ou crie um app do tipo Empresa) e adicione o produto **Login do Facebook** (ou "Login do Facebook para Empresas"). No caso de uso do Instagram, é a opção "Configuração da API com login do Facebook".
3. **Permissões.** Peça estas quatro:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`

   Se a Página fica num Gerenciador de Negócios e não aparece na hora de conectar, adicione também `business_management`.
   Com o app em **modo de desenvolvimento**, só quem tem papel no app (administrador, desenvolvedor ou testador) consegue conectar. Para outras pessoas, o app precisa estar **ao vivo** e com essas permissões aprovadas na Análise do app (acesso avançado).
4. **Endereço de retorno.** Em Login do Facebook → Configurações → "URIs de redirecionamento do OAuth válidos", cadastre:

   ```
   https://SEU-SITE/api/oauth/facebook/callback
   ```

   (troque `SEU-SITE` pelo endereço do UaiFlow no ar, o mesmo de `APP_BASE_URL`).
5. **ID e chave secreta do app.** Em Configurações do app → Básico, copie o **ID do aplicativo** e a **Chave secreta do aplicativo**. Atenção: é o ID do app da Meta (o do Facebook), não o "ID do app do Instagram" que vai em `INSTAGRAM_APP_ID`.

## Variáveis do servidor (Netlify)

| Variável | O que é |
| --- | --- |
| `FACEBOOK_APP_ID` | ID do aplicativo da Meta com o Login do Facebook (passo 5). |
| `FACEBOOK_APP_SECRET` | Chave secreta desse aplicativo. É segredo: nunca coloque no GitHub. |
| `FACEBOOK_REDIRECT_URI` | Opcional. Só se o endereço de retorno for diferente de `APP_BASE_URL` + `/api/oauth/facebook/callback`. |

Sem `FACEBOOK_APP_ID` e `FACEBOOK_APP_SECRET`, o botão «Conectar pelo Facebook» avisa que falta configurar, e nada mais muda.

## Atualização do banco: 0009

Cole o arquivo `supabase/migrations/0009_musica_instagram.sql` no editor SQL do Supabase (ou rode `npm run db:migrate`). Ele cria:

- a tabela `instagram_facebook_connections` (a conexão pelo Facebook de cada conta, com a segurança por linha ligada e sem políticas: só o servidor lê);
- as colunas `musica_audio_id`, `musica_titulo`, `musica_volume` (padrão 20) e `video_volume` (padrão 100) em `content_posts`.

Pode ser colada mais de uma vez, e antes ou depois de publicar o site. Sem ela, o UaiFlow funciona como antes: a música mandada pelo Molde não é guardada (a resposta traz o aviso "Falta colar a atualização 0009…"), e a busca de música pede a 0009.

## Como usar

1. Em **Perfis**, em cada conta, toque em **Conectar pelo Facebook** e entre com o Facebook que administra a Página da conta. Marque a Página dessa conta quando o Facebook perguntar. A conta passa a mostrar "Facebook conectado (música)". A conta principal não muda.
2. Em **Conteúdo**, abra um Reel. No bloco **Música do Instagram**: busque pelo nome (busca vazia = músicas em alta), escolha uma, ajuste **Volume da música** e **Volume da voz/vídeo** e salve. «Tirar a música» volta ao Reel sem música.
3. Se a conta não tiver a conexão pelo Facebook, o Reel com música **não sai sem a música**: ele fica "Com erro" com a frase "Para pôr música do Instagram, conecte esta conta também pelo Facebook em Perfis." Posts sem música continuam saindo pelo caminho de sempre.

O relógio de tokens (`/api/token/refresh`, uma vez por dia) renova também a conexão pelo Facebook. Se ela vencer mesmo assim, use «Reconectar pelo Facebook» em Perfis.

## Limites

- **Sem prévia.** O Instagram não mostra como fica o Reel com a música: ele sai direto com os volumes escolhidos. Sugestão: música 15–20, voz 100.
- **A biblioteca pela API pode ser diferente da do app.** A Meta só devolve músicas liberadas para uso por apps de terceiros, e isso varia por conta e país. Uma música que aparece no app do Instagram pode não aparecer na busca do UaiFlow.
- **Só Reel.** Carrossel, foto e story não levam música por aqui.
- A Meta pode recusar uma música na hora de publicar (indisponível para a conta ou a região). O post fica "Com erro" pedindo para escolher outra música ou tirar a música.

## Para o Molde (robô do Mac e página)

- `POST /api/molde/posts` e `PATCH /api/molde/posts/:id` aceitam `musica: { audioId, titulo, volumeMusica, volumeVideo }` (só Reel; volumes de 0 a 100, ajustados para a ponta; padrões 20 e 100) ou `musica: null` para tirar. As respostas (e o `GET`) trazem `musica` no mesmo formato, ou `null`.
- `GET /api/molde/audio?conta=<id da conta>&q=<busca>&tipo=music` (cabeçalho `x-molde-token`) busca as músicas. Detalhes em [PLANNER_E_MOLDE.md](PLANNER_E_MOLDE.md).
