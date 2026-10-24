# Atualização do banco: migração 0015 (segurança da versão 133)

O arquivo `supabase/migrations/0015_seguranca.sql` tem tudo junto: **você cola o arquivo inteiro** (pode colar de novo, não apaga nada).

O que muda com ela:

- **Reel nunca sai duas vezes:** o UaiFlow passa a guardar, para cada perfil, a referência de cada item do Molde que já foi mandado para o Instagram. Se o mesmo item chegar de novo (por exemplo, depois de você apagar o post do UaiFlow), ele não vira um segundo Reel: o Molde recebe a resposta "Este item já foi publicado" e o post, se existir, fica "Com erro" com essa explicação. Os posts que já saíram entram nessa lista na hora em que você cola a migração.
- **Banco fechado para a chave pública:** a chave pública do Supabase (a "anon", que vai para o navegador para o login funcionar) perde a permissão de ler ou mexer em qualquer tabela do UaiFlow. Hoje ela já não conseguia (a proteção por linha estava ligada em todas as tabelas); agora são duas travas em vez de uma, e tabelas novas já nascem fechadas.

Sobre a migração:

- Não apaga nada: cria uma tabela nova (`content_refs_publicadas`) e só tira permissões da chave pública.
- O site continua funcionando mesmo antes dela; só o caso "post apagado e mandado de novo pelo Molde" fica sem proteção.
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.
- Leva uns 3 minutos.

## Passo a passo

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0015_seguranca.sql` (na pasta do projeto no Mac, ou no GitHub com o botão **Copy raw file**). Não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
4. Cole o arquivo inteiro e clique em **Run** (ou Cmd+Enter).
   - O que esperar: **Success. No rows returned**.
   - Se colar de novo, pode aparecer "already exists, skipping". Não é erro.
5. **Confira.** Numa **New query**, cole e rode:

   ```sql
   select count(*) from public.content_refs_publicadas;
   ```

   Deve aparecer **uma linha com um número** (0 ou mais: quantos posts do Molde já saíram). Se aparecer `relation "public.content_refs_publicadas" does not exist`, repita o passo 4.

   E para conferir que a chave pública ficou sem acesso (deve aparecer `false`):

   ```sql
   select has_table_privilege('anon', 'public.instagram_accounts', 'select');
   ```

## Se precisar postar de novo o mesmo item

Mande do Molde como um **item novo** (outra referência). O UaiFlow só bloqueia a mesma referência no mesmo perfil.
