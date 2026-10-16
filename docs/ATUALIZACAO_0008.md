# Atualização do banco: migração 0008 (Fase 9: o Molde trabalha sozinho)

Esta atualização acompanha a Fase 9. O arquivo `0008_fase9.sql` tem tudo junto: **você cola o arquivo inteiro uma vez só**.

O que muda com ela:

- **Fila de trabalho do Molde:** a página do Molde põe os trabalhos (vídeos, narrações, montagens) numa fila no UaiFlow, e o robô do Mac (o "Estúdio do Molde") busca sozinho o próximo. Você pode **fechar a página** e o trabalho continua, desde que o Mac esteja ligado com o app Claude aberto.
- **Aprovar pelo Telegram:** quando um vídeo fica pronto, chega no Telegram «O vídeo "X" ficou pronto» com o link da prévia e os botões **Aprovar** e **Refazer**. Quando o Molde prepara uma resposta de DM, chega a resposta com **Mandar** e **Não mandar**. Tocar no botão faz o mesmo que tocar na página.
- **Avisos novos no Telegram:** um trabalho deu erro; o Mac parece desligado (há trabalho esperando há mais de 30 minutos e nenhum Mac pediu trabalho); o teto de gastos do mês foi atingido.
- **Relatório de domingo:** todo domingo, a partir das 9h (horário de Brasília), 1 mensagem no Telegram com o resumo da semana de cada perfil: posts publicados, o mais visto, cliques nos links, conversas do Direct respondidas e esperando, posts com erro e quanto a fila do Molde gastou no mês contra o teto.

Sobre a migração:

- Não apaga nada: cria uma tabela nova (`molde_jobs`) e algumas colunas novas nas DMs sem resposta (o rascunho do Molde).
- Pode ser colada mais de uma vez sem problema.
- Cole a 0006 antes desta. Se a 0006 ainda não foi colada, a 0008 funciona do mesmo jeito e só pula a parte das DMs; depois de colar a 0006, cole a 0008 de novo.
- O site continua funcionando mesmo antes dela, **mas sem ela**: a fila do Molde responde "Falta colar a atualização 0008", o botão **Mandar** do Telegram não aparece e o relatório de domingo sai sem a parte dos gastos.
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 10 minutos (3 para colar, 5 para as variáveis, 2 para ligar os botões).

## Passo 1 — colar a 0008 no Supabase

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0008_fase9.sql` (na pasta do projeto no Mac, ou no GitHub com o botão **Copy raw file**). Não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
4. Cole o arquivo inteiro e clique em **Run** (ou Ctrl+Enter / Cmd+Enter).
   - O que esperar: **Success. No rows returned**.
   - Se colar de novo, pode aparecer "already exists, skipping". Não é erro.
5. **Confira.** Numa **New query**, cole e rode:

   ```sql
   select count(*) from public.molde_jobs;
   ```

   Deve aparecer **uma linha com o número 0**. Se aparecer `relation "public.molde_jobs" does not exist`, repita o passo 4.

   Para conferir a parte das DMs (deve aparecer **uma linha** com `draft_text`; se não aparecer nada, cole a 0006 e depois a 0008 de novo):

   ```sql
   select column_name from information_schema.columns where table_name = 'dm_pending' and column_name = 'draft_text';
   ```

## Passo 2 — duas variáveis novas no Netlify

Entre em https://app.netlify.com, abra o site **uaiflow-divinetones** → **Site configuration** → **Environment variables** → **Add a variable** → **Add a single variable**.

1. **`TELEGRAM_WEBHOOK_SECRET`** — o segredo que liga os botões do Telegram.
   - Valor: uma sequência aleatória de **24 a 256** letras, números, `_` ou `-`, **sem espaço**. Para gerar uma no Mac, abra o Terminal e rode `openssl rand -hex 32`; copie o que aparecer.
   - Não mande esse valor para ninguém nem coloque no GitHub.
   - Sem ela, os avisos continuam chegando, mas **sem os botões** (a mensagem diz para aprovar pela página).
2. **`MOLDE_TETO_USD`** — o teto de gastos estimados da fila do Molde por mês, em dólares.
   - Valor: um número, por exemplo `50` (o padrão, se você não criar a variável, é 50).
   - Quando a soma do mês passa do teto, o Mac para de pegar trabalhos **que custam** (os de custo zero continuam) e chega 1 aviso no Telegram. Os gastos zeram no dia 1º. Para liberar um trabalho específico mesmo assim, use a opção de liberar na página do Molde (ela pede a sua confirmação).
3. (Opcional) **`RELATORIO_SEMANAL`** = `desligado`, se não quiser o relatório de domingo.

Depois de criar as variáveis, publique o site de novo: **Deploys** → **Trigger deploy** → **Deploy site**.

O Telegram em si (`TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`) você já configurou na Fase 5 (veja `docs/AVISOS_E_COPIA.md`). Sem ele, nada desta fase chega no celular.

## Passo 3 — ligar os botões do Telegram (registrar o webhook)

O Telegram precisa saber para onde mandar o seu toque nos botões. Faça isto **uma vez**, depois que o site novo estiver no ar com as variáveis do Passo 2:

1. Entre no UaiFlow e abra **Configurações**.
2. No quadro do Telegram, toque em **Ligar os botões do Telegram**.
3. O que esperar: "Botões do Telegram ligados! As aprovações agora chegam com «Aprovar» e «Refazer»."
   - "Falta configurar TELEGRAM_WEBHOOK_SECRET": volte ao Passo 2 (e publique o site de novo).
   - "O Telegram não aceitou o TELEGRAM_BOT_TOKEN": confira o token que o @BotFather mandou.

Outro jeito (para quem usa o Terminal), com o `.env.local` preenchido com `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (o **mesmo** do Netlify) e `APP_BASE_URL`:

```bash
npm run telegram:webhook          # registra
npm run telegram:webhook -- --ver # só mostra o que está registrado e o último erro do Telegram
```

Se um dia você trocar o `TELEGRAM_WEBHOOK_SECRET`, publique o site e toque em **Ligar os botões do Telegram** de novo. Os botões das mensagens antigas deixam de valer (aparece "Este botão não vale mais"); use a página do Molde para essas.

## Passo 4 — conferir

1. Abra `https://<seu-site>/api/health`. Agora aparece também `"mac"`: `ultimaVez` é a última vez que o robô do Mac pediu trabalho (fica `null` até o robô novo ser instalado).
2. Quando o robô e a página novos do Molde estiverem instalados, mande um vídeo curto pela página, feche a página e espere a mensagem «ficou pronto» no Telegram. Toque em **Aprovar**: a mensagem muda para "Aprovado às HH:MM (pelo Telegram)".

## Segurança (o que protege os botões)

- O endereço `/api/telegram/webhook` só aceita chamadas com o segredo `TELEGRAM_WEBHOOK_SECRET` (o Telegram manda no cabeçalho `X-Telegram-Bot-Api-Secret-Token`).
- Só vale o toque vindo da conversa `TELEGRAM_CHAT_ID`. Se o robô for adicionado a outro grupo, os toques de lá são recusados.
- Cada botão leva uma assinatura que só o UaiFlow sabe fazer: ninguém consegue inventar um «Aprovar».
- Dois toques no mesmo botão fazem uma ação só. Se você já decidiu pela página, o toque no Telegram só mostra o que foi decidido.

Para quem for fazer o robô e a página do Molde: a API completa está em `docs/API_MOLDE_JOBS.md`.
