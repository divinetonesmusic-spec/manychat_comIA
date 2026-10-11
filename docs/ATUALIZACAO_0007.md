# Atualização do banco: migração 0007 (Fase 6: arrumar a casa)

Esta atualização acompanha a Fase 6. O arquivo `0007_fase6.sql` tem tudo junto: **você cola o arquivo inteiro uma vez só** e vale para tudo.

- **Senha de administrador mais segura:** o UaiFlow passa a contar as senhas erradas. Depois de 5 erros seguidos do mesmo endereço em 15 minutos, ele para de aceitar tentativas desse endereço até passar o prazo. A atualização cria uma tabela para isso. Ela guarda só um código embaralhado do endereço, nunca o endereço nem a senha digitada.
- **Aviso de DM esperando no Telegram:** quando alguém manda uma mensagem direta que ninguém respondeu e ela fica esperando mais de 30 minutos, o UaiFlow manda um aviso no seu Telegram. A atualização cria uma coluna nova nas DMs sem resposta para lembrar que o aviso já foi.
- **Limpeza do banco:** o UaiFlow passa a apagar sozinho, uma vez por hora, o histórico de eventos com mais de 90 dias e os envios já terminados há mais de 30 dias. A atualização cria os "atalhos de busca" (índices) para essa limpeza não pesar no banco.
- **Token do Instagram num lugar só:** até agora o token da conta principal ficava guardado em dois lugares. A partir desta versão o UaiFlow usa só a tabela das contas (`instagram_accounts`). Se alguma conta tiver o token só no lugar antigo (a tabela `config`), a atualização copia esse token para a tabela das contas. A tabela antiga **não é apagada**.

- Não apaga nada do que já existe: só cria uma tabela, uma coluna e alguns atalhos, e copia o token que faltar.
- Pode ser colada mais de uma vez sem problema.
- Cole a 0006 antes desta. Se a 0006 ainda não foi colada, a 0007 funciona do mesmo jeito, só pula a parte das DMs. Depois de colar a 0006, cole a 0007 de novo.
- O site continua funcionando mesmo antes dela, **mas sem ela**:
  - a senha de administrador fica sem o limite de tentativas;
  - o aviso de DM esperando não é enviado;
  - a limpeza do banco não roda (o banco continua crescendo como antes).
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 3 minutos.

## Passo a passo

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0007_fase6.sql`.

   Ele está na pasta do projeto no Mac ou no GitHub (abra o arquivo e use o botão **Copy raw file**, de copiar). O arquivo já está pronto para colar: não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query** (consulta nova).
4. Copie o arquivo inteiro, do começo ao fim (as linhas que começam com `--` são comentários e podem ir juntas). Cole no editor e clique em **Run** (ou aperte Ctrl+Enter / Cmd+Enter).
   - O que esperar: embaixo aparece **Success. No rows returned**.
   - Se você colar de novo, pode aparecer um aviso dizendo que algo "already exists, skipping" (já existe, pulando). Isso não é erro.
5. **Confira se deu certo.** Abra mais uma **New query**, cole a consulta abaixo e clique em **Run**. Deve aparecer **uma linha com o número 0** (ainda não há nenhuma senha errada; o zero mostra que a tabela existe). Se aparecer o erro `relation "public.admin_login_attempts" does not exist`, repita o passo 4:

   ```sql
   select count(*) from public.admin_login_attempts;
   ```

   Para conferir a coluna do aviso de DM (deve aparecer **uma linha** com `notified_at`; se não aparecer nada, a 0006 ainda não foi colada: cole a 0006 e depois a 0007 de novo):

   ```sql
   select column_name from information_schema.columns where table_name = 'dm_pending' and column_name = 'notified_at';
   ```

   Para conferir os atalhos da limpeza (devem aparecer **3 linhas**):

   ```sql
   select indexname from pg_indexes
   where indexname in ('events_received_idx', 'queue_finished_idx', 'queue_event_id_idx')
   order by indexname;
   ```

   Para conferir que toda conta tem o token na tabela das contas (deve aparecer **uma linha com o número 0**):

   ```sql
   select count(*) from public.config c
   where c.instagram_access_token is not null and c.instagram_user_id is not null
     and not exists (select 1 from public.instagram_accounts a where a.instagram_user_id = c.instagram_user_id);
   ```

## Se aparecer erro

- **`syntax error`**: o arquivo não foi copiado inteiro. Apague o editor, copie o arquivo de novo do começo ao fim e rode outra vez.
- **`relation "public.events" does not exist`** (ou `public.queue`, `public.config`): o projeto aberto não é o do UaiFlow. Confira o nome do projeto no alto da tela.
- Qualquer outro erro: tire um print da mensagem e peça ajuda antes de tentar outra coisa.

## O que fazer além de colar (uma vez só)

1. **Netlify: confira `ALLOWED_EMAILS`.** No Netlify, abra o site **uaiflow-divinetones** → **Site configuration** → **Environment variables**. A variável `ALLOWED_EMAILS` tem que ter o seu e-mail (o mesmo que você usa para entrar), por exemplo `ALLOWED_EMAILS=seu-email@gmail.com`. Mais de um e-mail: separe por vírgula. **Sem essa variável, depois desta versão ninguém entra com e-mail, link ou Google**; só com a senha de administrador. Depois de mudar, publique o site de novo (**Deploys** → **Trigger deploy** → **Deploy site**).
2. **Supabase: desligue o cadastro de contas novas.** No Supabase, abra **Authentication** → **Sign In / Providers** e desmarque **Allow new users to sign up** (permitir cadastro de usuários novos). Clique em **Save**. Assim ninguém cria conta nova, nem pelo Google. Quem já tem conta continua entrando.
3. **Entre de novo uma vez.** O jeito de lembrar a entrada com a senha de administrador mudou: quem entrou com essa senha vai precisar entrar de novo uma vez. Quem entra com e-mail ou Google não percebe nada.
4. **Telegram (opcional):** o aviso de DM esperando usa o mesmo Telegram dos outros avisos (`TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`). Se você ainda não ligou, veja `docs/AVISOS_E_COPIA.md`.

## O que muda no dia a dia

- **Entrar.** A página `/cadastro` saiu: quem abrir esse endereço vai para a entrada (`/login`). O link de entrada por e-mail só funciona para quem já tem conta. Na página de entrada há também **Entrar com a senha de administrador** (a porta de emergência). Errou a senha 5 vezes em 15 minutos: aparece "Muitas tentativas com a senha errada. Espere 15 minutos e tente de novo." A entrada com a senha de administrador vale por 30 dias.
- **Menu.** O UaiFlow virou o painel de operação: no menu principal ficam **Início**, **Perfis**, **Contatos** e **Configurações**. **Conteúdo**, **Caixa de entrada**, **Automações** e **Fluxos** continuam funcionando, agora dentro do grupo **Avançado** (criar e aprovar posts e respostas é no Molde). O item "Assistente UaiFlow" saiu (ele não levava a lugar nenhum).
- **Aviso de DM esperando.** Se uma mensagem direta que ninguém respondeu está esperando há mais de 30 minutos, chega no Telegram uma mensagem por perfil, mais ou menos assim: "UaiFlow: 3 mensagens no Direct de @perfil esperam resposta (de 2 pessoas). A mais urgente vence em 5 h 20 min (o Instagram só deixa responder até 24 h depois da última mensagem da pessoa). Responda pelo Molde." No máximo um aviso a cada 2 horas por perfil, e a mesma conversa não é avisada duas vezes (só se a pessoa mandar mensagem nova).
- **Limpeza do banco.** Uma vez por hora o relógio apaga o histórico de eventos com mais de 90 dias e os envios terminados (enviados, que falharam ou foram pulados) há mais de 30 dias. Por isso a conversa mais antiga que 90 dias some da **Caixa de entrada**, e os números de "enviadas" mais antigos que 30 dias saem das contagens. Envios que ainda esperam para sair nunca são apagados.
- **Instagram pedindo para esperar.** Quando a Meta pede para esperar (limite de uso), a mensagem não vira mais "falhou" depois de 15 minutos: ela espera 30 minutos, depois 1 hora, 2 horas, 4 horas, e tenta de novo sozinha. Com o post é igual: volta para agendado daqui a 30 minutos com a nota "A Meta pediu para esperar (limite de uso). Nova tentativa às HH:MM.". Se a Meta não responder em 8 segundos, o UaiFlow desiste daquela vez e tenta de novo depois.
- **Mensagem com foto ou vídeo e texto.** Se o texto saiu e só a foto/vídeo falhou, a nova tentativa manda só a foto/vídeo (o texto não chega duas vezes).
- **Mídia parada.** A mídia de um rascunho ou de um post com erro que ficou 14 dias sem mudança é apagada do armazenamento (R2). O post continua lá, com a nota "A mídia foi apagada do armazenamento depois de 14 dias parada. Envie a mídia de novo para agendar ou publicar." e o selo **Precisa de mídia nova**. Link colado de fora (que não está no R2) não é apagado. Isso não precisa da 0007.
- **Envio de arquivo.** O link de envio para o armazenamento agora só aceita um arquivo do tamanho exato informado. Na tela isso é automático. O Molde já manda o tamanho; se um envio pelo Molde passar a falhar com "SignatureDoesNotMatch", avise (o robô precisa mandar o arquivo inteiro de uma vez, com o tamanho).

## Bom saber

- Migrações coladas à mão no SQL Editor não ficam registradas na tabela `schema_migrations`. Por isso o comando `npm run db:status` vai mostrar a 0007 como pendente. É normal. Se alguém rodar `npm run db:migrate` depois, não tem problema: a migração pode rodar de novo sem mudar nada.
- O relógio (`supabase/cron.sql`) não muda. Se precisar rodar de novo, o endereço agora é o do Netlify (veja `docs/NETLIFY.md`).
- As migrações anteriores estão em `docs/ATUALIZACAO_0003_0004.md`, `docs/ATUALIZACAO_0005.md` e `docs/ATUALIZACAO_0006.md`.
