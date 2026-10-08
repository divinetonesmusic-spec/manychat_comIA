# Atualização do banco: migração 0006 (aviso de "feito com IA" e limite de publicações)

Esta atualização prepara o UaiFlow para duas coisas da Fase 5:

- **Aviso de "feito com IA":** o Instagram passou a aceitar que o post leve o aviso "feito com IA". A atualização cria uma coluna nova no post para guardar se o aviso vale ou não.
- **Limite de publicações:** o Instagram aceita no máximo 100 posts por perfil a cada 24 horas. O UaiFlow passa a segurar em 95 e cria um "atalho de busca" (índice) para contar rápido os posts já publicados.

Outras partes da Fase 5 vão acrescentar seções neste mesmo arquivo (`0006_fase5.sql`). Você cola **uma vez**, no fim, e vale para tudo.

- Não apaga nem muda nada do que já existe: só cria uma coluna e um atalho.
- Pode ser colada mais de uma vez sem problema.
- O site continua funcionando mesmo antes dela, **mas sem ela o aviso de "feito com IA" não vai para o Instagram**: o post é criado e publicado normalmente, só que sem o aviso. Cole a atualização antes de marcar "Feito com IA" em qualquer post.
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 3 minutos.

## Passo a passo

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0006_fase5.sql`.

   Ele está na pasta do projeto no Mac ou no GitHub (abra o arquivo e use o botão **Copy raw file**, de copiar).
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query** (consulta nova).
4. Copie o arquivo inteiro, do começo ao fim (as linhas que começam com `--` são comentários e podem ir juntas). Cole no editor e clique em **Run** (ou aperte Ctrl+Enter / Cmd+Enter).
   - O que esperar: embaixo aparece **Success. No rows returned**.
   - Se você colar de novo, pode aparecer um aviso dizendo que algo "already exists, skipping" (já existe, pulando). Isso não é erro.
5. **Confira se deu certo.** Abra mais uma **New query**, cole a consulta abaixo e clique em **Run**:

   ```sql
   select column_name from information_schema.columns where table_name='content_posts' and column_name='ai_generated';
   ```

   Deve aparecer **uma linha** com `ai_generated`. Se não aparecer nenhuma linha, repita o passo 4.

   Para conferir também o atalho de busca (deve aparecer **uma linha**):

   ```sql
   select indexname from pg_indexes where indexname = 'content_posts_published_window_idx';
   ```

## Se aparecer erro

- **`syntax error`**: o arquivo não foi copiado inteiro. Apague o editor, copie o arquivo de novo do começo ao fim e rode outra vez.
- **`relation "public.content_posts" does not exist`**: o projeto aberto não é o do UaiFlow. Confira o nome do projeto no alto da tela.
- Qualquer outro erro: tire um print da mensagem e peça ajuda antes de tentar outra coisa.

## O que muda no dia a dia

- **Feito com IA.** Na tela **Conteúdo**, o formulário do post ganhou a caixa **Feito com IA (o Instagram mostra o aviso)**. Ela começa desmarcada para o post feito à mão; o post que vem do Molde chega já com a resposta certa. Marcada, o Instagram mostra o aviso "feito com IA" no post.
  - No carrossel, o aviso vale para o carrossel inteiro.
  - Se o Instagram não aceitar o aviso, o post fica **Com erro** com a frase "O Instagram não aceitou o aviso de "feito com IA" neste post. Tente de novo mais tarde ou desmarque o aviso e publique." O UaiFlow **nunca** tira o aviso sozinho.
  - **Sem a 0006 o aviso não vai.** A caixa até aceita a marcação, mas nada é guardado e o post sai sem o aviso. Por isso, cole a atualização antes.
- **Limite de 100 publicações em 24 h.** O UaiFlow conta os posts publicados do perfil nas últimas 24 horas (mais os que estão sendo publicados). Chegando em 95, o próximo post **não começa**: continua agendado, com o horário novo e a nota "Limite de 100 publicações em 24 h do Instagram: sai às HH:MM." (horário de Brasília). Nunca vira "Com erro" por isso. Um carrossel conta como 1. Posts feitos fora do UaiFlow (direto no celular, por exemplo) não entram na conta. Isso funciona mesmo sem a 0006; a atualização só deixa a conta mais rápida.
- **Stories.** Story não tem comentário nem palavra-chave: o UaiFlow não faz 1º comentário nem liga automação em story, mesmo que o pacote venha com esses campos.

## Bom saber

- Migrações coladas à mão no SQL Editor não ficam registradas na tabela `schema_migrations`. Por isso o comando `npm run db:status` vai mostrar a 0006 como pendente. É normal. Se alguém rodar `npm run db:migrate` depois, não tem problema: a migração pode rodar de novo sem mudar nada.
- As migrações anteriores estão em `docs/ATUALIZACAO_0003_0004.md` e `docs/ATUALIZACAO_0005.md`.
