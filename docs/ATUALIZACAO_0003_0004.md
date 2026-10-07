# Atualização do banco: migrações 0003 e 0004

Esta atualização acrescenta duas coisas ao banco do UaiFlow no Supabase:

- **0003 (publicação segura):** o UaiFlow passa a anotar a hora em que pediu ao Instagram para publicar. Assim o mesmo post nunca sai duas vezes.
- **0004 (saúde do relógio):** cria a tabela `app_status`, onde o relógio anota que está rodando. O monitor do GitHub e a rota `/api/health` dependem dela.

As duas não apagam nem mudam nada do que já existe e podem ser coladas mais de uma vez sem problema. O site continua funcionando mesmo antes delas, mas sem essas proteções. De preferência, faça isto **antes** de publicar a versão nova do site.

Leva uns 5 minutos.

## Passo a passo

1. Pegue os dois arquivos do UaiFlow:
   - `supabase/migrations/0003_publicacao_segura.sql`
   - `supabase/migrations/0004_saude.sql`

   Eles estão na pasta do projeto no Mac ou no GitHub (abra o arquivo e use o botão **Copy raw file**, de copiar).
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query** (consulta nova).
4. **Primeiro a 0003.** Copie o arquivo `0003_publicacao_segura.sql` inteiro, do começo ao fim (as linhas que começam com `--` são comentários e podem ir juntas). Cole no editor e clique em **Run** (ou aperte Ctrl+Enter / Cmd+Enter).
   - O que esperar: embaixo aparece **Success. No rows returned**.
5. **Depois a 0004.** Abra outra **New query**, cole o arquivo `0004_saude.sql` inteiro e clique em **Run**.
   - O que esperar: de novo **Success. No rows returned**.
   - Se você colar a mesma migração duas vezes, pode aparecer um aviso dizendo que algo "already exists, skipping" (já existe, pulando). Isso não é erro.
6. **Confira se deu certo.** Abra mais uma **New query**, cole a consulta abaixo e clique em **Run**:

   ```sql
   select
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'content_posts' and column_name = 'publish_requested_at') as tem_0003,
     exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'app_status') as tem_0004;
   ```

   Deve aparecer uma linha com **true** nas duas colunas (`tem_0003` e `tem_0004`). Se alguma estiver **false**, repita o passo daquela migração.
7. Depois que o site novo estiver publicado, abra `https://uaiflow-divinetones.netlify.app/api/health`. Em 1 ou 2 minutos deve aparecer `"ok":true`.

## Se aparecer erro

- **`syntax error`**: o arquivo não foi copiado inteiro. Apague o editor, copie o arquivo de novo do começo ao fim e rode outra vez.
- **`relation "public.content_posts" does not exist`**: o projeto aberto não é o do UaiFlow. Confira o nome do projeto no alto da tela.
- Qualquer outro erro: tire um print da mensagem e peça ajuda antes de tentar outra coisa.

## Bom saber

- Migrações coladas à mão no SQL Editor não ficam registradas na tabela `schema_migrations`. Por isso o comando `npm run db:status` vai mostrar a 0003 e a 0004 como pendentes. É normal. Se alguém rodar `npm run db:migrate` depois, não tem problema: as migrações podem rodar de novo sem mudar nada.
- O resto da configuração (avisos no Telegram, monitor e cópia do banco) está em `docs/AVISOS_E_COPIA.md`.
