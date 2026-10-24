# Atualização do banco: migração 0014 (DM com o vídeo do avatar)

Esta atualização acompanha a versão 133 da página do Molde. O arquivo `0014_dm_video.sql` tem tudo junto: **você cola o arquivo inteiro** (pode colar de novo, não apaga nada).

O que muda com ela:

- **A DM responde com um vídeo do avatar.** Quem comenta a palavra do Reel recebe a pergunta «O que te fez comentar?». Quando a pessoa responde, o UaiFlow lê as palavras da resposta e escolhe um dos vídeos curtos que você gravou para aquele post (um por dúvida comum; se nada casar, vai o vídeo «geral»). O vídeo sai sozinho uns 3 minutos depois (nunca mais de 15) e **só depois** vai o link do produto.
- **Aviso no Telegram** a cada resposta: quem respondeu, o que escreveu e qual vídeo vai sair e a que horas. Se quiser, você escreve antes pelo Instagram; o vídeo e o link saem do mesmo jeito.
- **Painel do funil por post** no Molde: comentários → responderam → vídeo enviado → clique → compra, com o gargalo marcado (tráfego, conversa ou página).

Sobre a migração:

- Não apaga nada: cria uma tabela nova (`dm_videos`) e algumas colunas novas na tabela `dm_sequencias` (a da 0012).
- Cole a 0012 antes desta (se ainda não colou). Sem ela, a 0014 cria só a tabela dos vídeos; depois de colar a 0012, cole a 0014 de novo.
- O site continua funcionando mesmo antes dela: a DM segue como na versão 132 (a mensagem 2, o link e o lembrete), sem o vídeo. A página avisa «Falta colar a atualização 0014».
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 3 minutos.

## Passo 1 — colar a 0014 no Supabase

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0014_dm_video.sql` (na pasta do projeto no Mac, ou no GitHub com o botão **Copy raw file**). Não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
4. Cole o arquivo inteiro e clique em **Run** (ou Cmd+Enter).
   - O que esperar: **Success. No rows returned**.
   - Se colar de novo, pode aparecer "already exists, skipping". Não é erro.
5. **Confira.** Numa **New query**, cole e rode:

   ```sql
   select count(*) from public.dm_videos;
   ```

   Deve aparecer **uma linha com o número 0**. E esta deve mostrar **uma linha** com `video_chave` (se não mostrar nada, cole a 0012 e depois a 0014 de novo):

   ```sql
   select column_name from information_schema.columns where table_name = 'dm_sequencias' and column_name = 'video_chave';
   ```

## Passo 2 — o aviso no Telegram (se ainda não tem)

O aviso usa o mesmo robô do Telegram dos outros avisos do UaiFlow (`TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` no Netlify, veja `docs/AVISOS_E_COPIA.md`). Se já recebe os avisos de DM esperando resposta, não precisa fazer nada.

## O que o Instagram não deixa medir

- **Se a pessoa assistiu ao vídeo:** a Meta não informa. O painel mostra «vídeo enviado» (o envio saiu) e, à parte, «com sinal de que viu»: quem tocou no link ou escreveu de novo depois do vídeo. Não é uma visualização medida.
- **Tamanho do vídeo:** a Meta aceita vídeos de até **25 MB** na DM (mp4 ou mov). O Molde já manda o vídeo do tamanho certo (o Estúdio do Molde 1.4.1 diminui o arquivo no Mac quando precisa).
- **Janela de 24 horas:** a Meta só deixa mandar o vídeo e o link depois que a pessoa responde, e só por 24 horas. Por isso a 1ª mensagem é uma pergunta.
