# Manual de uso do UaiFlow

Este manual explica as telas depois que a instalacao e a conexao do Instagram ja foram concluidas. Consulte primeiro o [guia completo de instalacao](GUIA_COMPLETO_NOVO_PROPRIETARIO.md) se o perfil ainda nao aparece no painel.

## Selecao de perfil

Quando houver mais de um Instagram conectado, confira o perfil selecionado antes de editar ou enviar qualquer coisa. Cada perfil possui automacoes, contatos, configuracoes e historico proprios. Em **Perfis**, use **Definir como padrao** para escolher o perfil aberto quando nenhum outro for informado.

## Dashboard

Use o Dashboard para acompanhar:

- estado da conexao do Instagram;
- automacoes ativas;
- eventos recentes;
- contatos;
- jobs pendentes, enviados ou com falha.

Se uma automacao nao enviar, procure o evento de entrada e depois o job da fila. Um evento sem job normalmente significa que nenhum gatilho combinou. Um job `failed` mostra um erro da Meta; um job `pending` pode estar aguardando atraso ou o cron.

## Perfis

### Conectar outro Instagram

1. Adicione/autorize a conta no app Meta enquanto ele estiver em modo de teste.
2. Confirme que o Instagram e Business ou Creator.
3. Clique em **Adicionar via Meta + Login**.
4. Autorize as permissoes.
5. Selecione o perfil conectado e clique em **Testar conexao**.

O diagnostico verifica token, perfil, mídia, webhook, menu e iniciadores. Avisos de menu/ice breakers vazios sao normais se voce nao usa esses recursos; erros de token, perfil ou webhook precisam ser corrigidos.

### Menu persistente

O menu aparece na conversa do Instagram quando suportado pela conta:

1. adicione itens de postback ou URL;
2. salve as configuracoes;
3. sincronize/publice o menu na Meta;
4. use **Carregar da Meta** para conferir;
5. use **Excluir da Meta** apenas se quiser remover o menu publicado.

### Ice breakers

Ice breakers sao perguntas iniciais que ajudam o usuario a iniciar uma conversa. Crie ate quatro perguntas, associe um payload, salve e sincronize.

## Automacoes

Uma automacao possui quatro partes principais:

1. **Gatilho:** comentario, story ou DM.
2. **Condicao:** palavra-chave exata, contida no texto ou qualquer mensagem.
3. **Resposta:** resposta publica, privada, DM, botoes ou link.
4. **Tempo:** atraso fixo/aleatorio e follow-ups.

### Automacao de comentario

1. Clique em criar nova automacao.
2. Dê um nome interno claro.
3. Escolha **Comentarios**.
4. Escolha todos os posts ou posts especificos.
5. Defina palavras-chave sem acentos alternativos quando necessario.
6. Escreva uma resposta publica curta.
7. Configure a mensagem privada e o link.
8. Salve, ative e teste com outro perfil.

A resposta privada so pode ser enviada dentro do periodo permitido pela Meta. Evite testar repetidamente no mesmo comentario porque a Meta limita respostas privadas por comentario.

### Responder quem já comentou (post que viralizou antes da automação)

A automação só responde comentários **novos**. Para quem comentou antes de ela existir:

1. Abra a automação do post (Fluxos → a automação → Editar). Ela precisa estar **Ativa** e com o post escolhido.
2. Toque em **«Responder quem já comentou neste post»**.
3. Cole o link do Reel (ou do post) e toque em **«Contar os comentários»**. Nada é mandado nesta hora.
4. Confira os números: quantos comentários foram lidos, quantos têm a palavra-chave, quantos já foram respondidos,
   quantos passaram de 7 dias (a Meta não deixa responder) e quantas pessoas vão receber.
5. Toque em **«Mandar para N pessoas»**. As mensagens saem no ritmo de 200 por hora (12 mil comentários levam uns 2 a 3
   dias; quem passar dos 7 dias antes da vez fica de fora). Pode fechar a tela: o envio continua sozinho.
6. Quer pegar quem comentou depois? Volte e toque em **«Contar de novo»**: quem já recebeu nunca recebe de novo.

Detalhes para quem mexe no código: `docs/API_MOLDE_RESPONDER_ANTIGOS.md`.

### Automacao de DM

O usuario precisa iniciar a conversa. Configure a palavra-chave e a resposta. Mensagens comuns so podem ser enviadas dentro da janela de 24 horas apos a interacao do usuario.

### Exigir seguidor

Quando ativado, o fluxo consulta se o usuario segue o perfil e pode apresentar uma etapa de confirmacao. Esse recurso depende das permissoes e dos dados retornados pela Meta.

## Fluxos

O editor visual representa a automacao com blocos e conexoes:

- gatilho inicia o fluxo;
- mensagens enviam texto ou mídia;
- botoes continuam por um caminho;
- condicoes criam caminhos diferentes;
- atrasos aguardam antes do proximo passo.

Conecte todos os blocos que devem executar, salve e teste em um perfil controlado. Um bloco solto nao sera alcancado.

## Caixa de entrada

A caixa de entrada agrupa contatos e eventos conhecidos pelo UaiFlow.

1. Selecione o perfil correto.
2. Procure o contato pelo username.
3. Abra a conversa.
4. Digite a resposta manual.
5. Envie somente se o usuario interagiu dentro da janela permitida.

Uma resposta manual pausa a automacao daquele contato por 24 horas para evitar que bot e atendente respondam ao mesmo tempo. Em **Contatos**, a pausa pode ser removida antes.

## Contatos

Use esta tela para:

- conferir username e perfil de origem;
- adicionar ou remover tags;
- identificar falhas/pedidos pendentes;
- pausar automacoes durante atendimento humano;
- reativar automacoes.

Tags ajudam a organizar campanhas, interesses e etapas do atendimento. Nao use tags para armazenar dados pessoais sensiveis.

## Conteudo

O UaiFlow publica a partir de URLs publicas. A Meta precisa conseguir baixar o arquivo sem login, cookie ou bloqueio temporario.

### Imagem no feed

1. Escolha **Feed imagem**.
2. Cole uma URL publica de imagem.
3. Escreva a legenda.
4. Clique em publicar.

### Reel e story de video

Use uma URL publica de MP4 compativel. Videos demoram para processar. Aguarde e clique em **Atualizar** ate o status mudar de `publishing` para `published` ou `failed`.

### Carrossel

Adicione de 2 a 10 itens. Mantenha proporcoes semelhantes. Cada item e processado antes do container final ser publicado.

Publicacoes concluidas nao podem ser apagadas pela API usada pelo UaiFlow. Exclua manualmente no aplicativo Instagram quando necessario.

## Configuracoes

Esta tela mostra:

- conta conectada;
- validade do token;
- estado do webhook;
- URLs que devem ser copiadas para a Meta;
- botao para reconectar/renovar o Instagram;
- link para o seu app Meta.

Se o token estiver perto de expirar, use a renovacao ou reconecte a conta. Se o webhook estiver aguardando, revise a configuracao no painel Meta.

## Rotina recomendada

### Todos os dias

- confira jobs com falha;
- confira mensagens que precisam de atendimento;
- valide se as automacoes principais continuam ativas.

### Toda semana

- abra o diagnostico dos perfis;
- confira validade do token;
- revise links das automacoes;
- confira se os jobs de cron continuam ativos no Supabase.

### Antes de uma campanha

- teste a palavra-chave com um perfil controlado;
- confira post selecionado;
- confirme texto, link e botoes;
- confirme que o perfil correto esta selecionado;
- acompanhe os primeiros eventos e jobs.

## Status da fila

| Status | Significado |
|---|---|
| `pending` | aguardando horario ou cron |
| `sending` | reservado por um worker |
| `sent` | Meta aceitou o envio |
| `failed` | Meta ou rede recusou; leia o erro |
| `skipped` | regra do sistema impediu o envio |

## Limites importantes da Meta

- Conta pessoal nao funciona; use Business ou Creator.
- O usuario deve iniciar a conversa.
- DM comum possui janela de 24 horas.
- Resposta privada exige comentario recente e segue limites proprios.
- `HUMAN_AGENT` exige aprovacao separada do app.
- URLs de mídia precisam ser publicas e compatíveis.
- A Meta pode exigir App Review para atender usuarios que nao sao testers do app.