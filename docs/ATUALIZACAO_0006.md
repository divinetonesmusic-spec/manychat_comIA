# Atualização do banco: migração 0006 (aviso de "feito com IA", limite de publicações, links rastreados e DMs sem resposta)

Esta atualização prepara o UaiFlow para quatro coisas da Fase 5. O arquivo `0006_fase5.sql` tem as quatro seções juntas: **você cola o arquivo inteiro uma vez só** e vale para tudo.

- **Aviso de "feito com IA":** o Instagram passou a aceitar que o post leve o aviso "feito com IA". A atualização cria uma coluna nova no post para guardar se o aviso vale ou não.
- **Limite de publicações:** o Instagram aceita no máximo 100 posts por perfil a cada 24 horas. O UaiFlow passa a segurar em 95 e cria um "atalho de busca" (índice) para contar rápido os posts já publicados.
- **Links rastreados:** cada Reel pode ter um link curto próprio (`/l/` e um código de 7 letras e números) que leva à loja e conta quantas pessoas clicaram, e de onde (bio, mensagem direta ou comentário). A atualização cria as duas tabelas disso: uma para os links e outra para os cliques.
- **DMs sem resposta:** quando alguém manda uma mensagem direta e nenhuma automação responde, o UaiFlow guarda a conversa para o Molde. O Molde escreve um rascunho com a IA, você aprova, e só então a resposta sai (pela fila normal de envios, com o limite de 200 por hora e o prazo de 24 horas do Instagram). A atualização cria uma tabela para guardar essas mensagens.

- Não apaga nem muda nada do que já existe: só cria uma coluna, um atalho e três tabelas novas (duas dos links e uma das DMs sem resposta).
- Pode ser colada mais de uma vez sem problema.
- O site continua funcionando mesmo antes dela, **mas sem ela o aviso de "feito com IA" não vai para o Instagram**: o post é criado e publicado normalmente, só que sem o aviso. Cole a atualização antes de marcar "Feito com IA" em qualquer post. **Também sem ela os links rastreados não funcionam:** o Molde recebe o aviso "Falta colar a atualização 0006 no Supabase" ao pedir um link, e qualquer endereço `/l/…` responde "Link não encontrado". **E as DMs sem resposta não são guardadas:** o Instagram e as automações continuam funcionando igual, mas o Molde recebe o mesmo aviso ao pedir a lista de mensagens.
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

   Para conferir as tabelas dos links rastreados, rode esta consulta. Deve aparecer **uma linha com o número 0** (ainda não há nenhum link; o zero mostra que a tabela existe). Se aparecer o erro `relation "public.tracked_links" does not exist`, repita o passo 4:

   ```sql
   select count(*) from public.tracked_links;
   ```

   Para conferir a tabela das DMs sem resposta, rode esta consulta. Deve aparecer **uma linha com o número 0** (ainda não há nenhuma mensagem guardada). Se aparecer o erro `relation "public.dm_pending" does not exist`, repita o passo 4:

   ```sql
   select count(*) from public.dm_pending;
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

- **Links rastreados.** O Molde pede um link por Reel (algo como `https://seu-site/l/k3x9q2a`). Quem clica nele (na bio, numa mensagem direta ou num comentário) é levado para a loja na mesma hora, e o UaiFlow soma 1 clique. Ele **não guarda IP, aparelho nem navegador** de ninguém: só o momento do clique e de onde veio (bio, mensagem, comentário ou outro). Os programas que só espiam o link para mostrar a prévia (WhatsApp, Telegram, Slack, Facebook) não contam como clique; o navegador de dentro do Instagram conta. Se o banco estiver com problema na hora, a pessoa ainda é levada à loja **se aquele link já tinha sido aberto antes** (o UaiFlow lembra, por um tempo, dos links que já abriu); se não, ela vê uma página curta "Estamos com um problema agora. Tente de novo em instantes.". Nesse momento o clique pode não ser contado. Trocar o endereço da loja de um Reel mantém o mesmo link e os cliques já contados. Link que não existe mostra "Link não encontrado." **Sem a 0006** os links não são criados e `/l/…` mostra "Link não encontrado.".
- **DMs sem resposta.** Uma mensagem de texto (DM ou resposta a um story) que **nada respondeu** fica guardada esperando o Molde: nenhuma palavra-chave serviu, não há automação padrão ligada, e não é "parar" nem "começar", reação, foto sem texto ou clique em botão. Cada pessoa tem uma linha só; as mensagens seguintes dela entram na mesma (as 10 mais novas). O Molde mostra o rascunho, **você aprova**, e a resposta entra na fila normal: respeita o limite de 200 mensagens por hora (se bater nele, espera a vez, sem dar erro), o prazo de 24 horas do Instagram (passou do prazo, não sai e o Molde avisa) e a conta pausada. Mandar resposta por aqui **não** pausa a automação daquela pessoa. Quem escreve "parar" sai da lista: as mensagens dela que estavam esperando são descartadas e nenhuma resposta é enviada, nem a que você já tinha aprovado e ainda estava na fila (o Molde mostra "A pessoa pediu para não receber mensagens."). A confirmação de que ela saiu da lista, se você tiver uma, continua sendo enviada. Depois de 90 dias as mensagens já tratadas (respondidas, não enviadas, descartadas ou vencidas) somem desta lista de DMs. O texto das mensagens recebidas continua guardado também no histórico de eventos do UaiFlow, como já era antes; essa limpeza não mexe nele. O UaiFlow nunca responde sozinho. **Sem a 0006** nada é guardado e o Molde mostra "Falta colar a atualização 0006".
- **Resultados para o Molde.** O Molde passou a poder ler todos os posts já publicados (também os feitos à mão na tela **Conteúdo**), com as curtidas, alcance e visualizações já guardadas. Não precisa da 0006 e não muda nada na tela.

## Bom saber

- Migrações coladas à mão no SQL Editor não ficam registradas na tabela `schema_migrations`. Por isso o comando `npm run db:status` vai mostrar a 0006 como pendente. É normal. Se alguém rodar `npm run db:migrate` depois, não tem problema: a migração pode rodar de novo sem mudar nada.
- As migrações anteriores estão em `docs/ATUALIZACAO_0003_0004.md` e `docs/ATUALIZACAO_0005.md`.
