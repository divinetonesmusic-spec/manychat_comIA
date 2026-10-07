# Atualização do banco: migração 0005 (Caixa de entrada rápida)

Esta atualização deixa a **Caixa de entrada** e a tela **Contatos** rápidas mesmo quando houver milhares de contatos. Ela cria cinco "atalhos de busca" (índices) no banco do UaiFlow no Supabase.

- Não apaga nem muda nada do que já existe: só cria atalhos.
- Pode ser colada mais de uma vez sem problema.
- O site continua funcionando mesmo antes dela. Sem ela, só fica mais devagar quando o número de contatos cresce.
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 3 minutos.

## Passo a passo

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0005_caixa_rapida.sql`.

   Ele está na pasta do projeto no Mac ou no GitHub (abra o arquivo e use o botão **Copy raw file**, de copiar).
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query** (consulta nova).
4. Copie o arquivo inteiro, do começo ao fim (as linhas que começam com `--` são comentários e podem ir juntas). Cole no editor e clique em **Run** (ou aperte Ctrl+Enter / Cmd+Enter).
   - O que esperar: embaixo aparece **Success. No rows returned**.
   - Se você colar de novo, pode aparecer um aviso dizendo que algo "already exists, skipping" (já existe, pulando). Isso não é erro.
5. **Confira se deu certo.** Abra mais uma **New query**, cole a consulta abaixo e clique em **Run**:

   ```sql
   select indexname from pg_indexes where indexname = 'events_account_user_received_idx';
   ```

   Deve aparecer **uma linha** com `events_account_user_received_idx`. Se não aparecer nenhuma linha, repita o passo 4.

   Para ver os cinco de uma vez, use esta consulta. Devem aparecer **5 linhas**:

   ```sql
   select indexname from pg_indexes
   where indexname in ('events_account_user_received_idx', 'queue_contact_created_idx',
                       'contacts_account_updated_idx', 'contacts_updated_idx', 'queue_sent_dm_idx')
   order by indexname;
   ```

## Se aparecer erro

- **`syntax error`**: o arquivo não foi copiado inteiro. Apague o editor, copie o arquivo de novo do começo ao fim e rode outra vez.
- **`relation "public.events" does not exist`** (ou `public.queue`, `public.contacts`): o projeto aberto não é o do UaiFlow. Confira o nome do projeto no alto da tela.
- Qualquer outro erro: tire um print da mensagem e peça ajuda antes de tentar outra coisa.

## Bom saber

- Migrações coladas à mão no SQL Editor não ficam registradas na tabela `schema_migrations`. Por isso o comando `npm run db:status` vai mostrar a 0005 como pendente. É normal. Se alguém rodar `npm run db:migrate` depois, não tem problema: a migração pode rodar de novo sem mudar nada.
- Com a versão nova do site, o limite de 200 mensagens por hora de cada perfil também mudou: as mensagens que passam do limite **esperam o próximo horário livre** e saem sozinhas (antes eram descartadas). No histórico de envios, elas ficam como pendentes, com a nota "Limite de 200 mensagens por hora deste perfil: sai às HH:MM." Isso não precisa de nenhuma migração.
- As outras migrações (0003 e 0004) estão em `docs/ATUALIZACAO_0003_0004.md`.
