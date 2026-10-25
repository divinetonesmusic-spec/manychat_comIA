# Atualização do banco: migração 0016 (fila única e o Telegram para aprovar e pedir)

Esta atualização acompanha a versão 134 da página do Molde. O arquivo `0016_fila_unica.sql` tem tudo junto: **você cola o arquivo inteiro** (pode colar de novo, não apaga nada).

O que muda com ela:

- **Uma fila só.** Tudo o que a página do Molde pede e que custa ou demora (fotos, os vídeos do Flow, o Só Flow, o storyboard, o vídeo do avatar no HeyGen, a voz e os pedidos da Fábrica) aparece também no UaiFlow, com o estado (na fila, produzindo, para aprovar, aprovado, refazer, pronto, erro, cancelado), o custo estimado e o avatar. Na página, o painel **Fila** (no pé da linha de montagem) mostra isso de todos os avatares.
- **Aprovar pelo Telegram.** Quando algo fica pronto para aprovar, chega no Telegram a prévia com **Aprovar** e **Refazer**. No **Refazer**, o robô pergunta o que mudar e você responde com uma mensagem. A página aplica a sua decisão quando abrir (como na área Aprovar: nada é refeito sozinho; o botão de refazer pergunta o custo antes).
- **Pedir pelo Telegram.** No chat do robô:
  - `/reel 3 erros de quem guarda dinheiro` · um Reel novo no calendário do avatar (o roteiro usa o seu plano do Claude);
  - `/fotos 2 tomando café na varanda` · fotos do avatar (até 4) no gerador do seu Mac;
  - `/status` · o que está na fila de cada avatar;
  - `/ajuda` · os comandos.

  Com vários avatares, aparecem os botões de cada um. Depois o robô mostra o custo e só põe na fila quando você toca em **Confirmar · US$ X** (nada gasta com 1 toque). A página faz o pedido quando você abrir o Molde daquele avatar; se passar do seu limite do mês, ela pergunta de novo.
- **Só a sua conversa** pode pedir e aprovar (a mesma `TELEGRAM_CHAT_ID` dos avisos). Mensagens de outras conversas são ignoradas.

Sobre a migração:

- Não apaga nada: cria duas tabelas novas (`molde_fila` e `molde_avatares`).
- Não depende de nenhuma outra.
- O site continua funcionando mesmo antes dela: a página guarda a fila para mandar depois e o Telegram responde «Falta colar a atualização 0016».

Leva uns 5 minutos.

## Passo 1 — colar a 0016 no Supabase

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0016_fila_unica.sql` (na pasta do projeto no Mac, ou no GitHub com o botão **Copy raw file**). Não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
4. Cole o arquivo inteiro e clique em **Run** (ou Cmd+Enter).
   - O que esperar: **Success. No rows returned**.
   - Se colar de novo, pode aparecer "already exists, skipping". Não é erro.
5. **Confira.** Numa **New query**, cole e rode:

   ```sql
   select count(*) from public.molde_fila;
   ```

   Deve aparecer **uma linha com o número 0**.

## Passo 2 — ligar as mensagens do Telegram (1 clique, depois de publicar o site)

Para o robô **ler o que você escreve** (os comandos e o motivo do Refazer), o Telegram precisa saber que agora o UaiFlow quer receber mensagens, e não só os toques nos botões.

1. Depois que o site novo estiver publicado, abra o UaiFlow → **Configurações** → quadro **Avisos no celular**.
2. Toque em **Ligar os botões do Telegram** (o mesmo botão de antes). Deve aparecer «Botões do Telegram ligados! …».
3. No Telegram, mande `/ajuda` para o seu robô. Ele responde com os comandos.

Se nada responder: confira se `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` e `TELEGRAM_WEBHOOK_SECRET` estão no Netlify (veja `docs/AVISOS_E_COPIA.md`) e toque no botão de novo.

## Passo 3 — abrir a página do Molde uma vez

Abra a página do Molde no app Claude do Mac, com o Estúdio do Molde ligado. Ela manda ao UaiFlow a lista dos seus avatares e o preço das fotos (para o Telegram mostrar os botões e o custo certo) e o que já está em produção. A partir daí, faz isso sozinha cada vez que abre.

## Bom saber

- **A página continua dona dos pedidos.** O UaiFlow guarda uma cópia do estado para o Telegram e o painel. Se o UaiFlow estiver fora do ar, a página guarda e manda depois; nada trava.
- **O pedido do Telegram só vira produção com a página aberta** no Molde daquele avatar (as fotos saem no gerador do Mac). Até lá ele fica «na fila» e aparece no `/status` como «esperando a página do Molde abrir».
- **Um pedido do Telegram que você não confirmou** vale por 30 minutos e é apagado depois de 1 dia.
