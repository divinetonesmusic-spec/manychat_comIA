# Atualização do banco: migração 0019 (o orquestrador e o Molde no Claude)

Esta atualização acompanha a versão 135 do Molde. O arquivo `0019_orquestrador.sql` tem tudo junto: **você cola o arquivo inteiro** (pode colar de novo, não apaga nada). Precisa da 0016 colada antes.

O que muda com ela:

- **O orquestrador tem onde trabalhar.** O «Orquestrador do Molde» (a tarefa agendada do Claude que chama as skills do Molde: roteirista, fotógrafo, revisor…) usa a mesma fila do Telegram e do painel **Fila**. Cada item guarda o que cada skill fez, os problemas que o revisor achou e o resultado.
- **Quando o revisor reprova, você vê na hora.** Chega no Telegram a lista dos problemas (onde, o trecho, por quê e a troca permitida) com os botões **Corrigir** · **Refazer** · **Publicar mesmo assim** · **Cancelar**. «Corrigir» aplica só as trocas do revisor; «Refazer» pergunta o que mudar; «Publicar mesmo assim» está **sempre** lá e é escolha sua. Nada é refeito nem publicado sozinho.
- **Quando algo vai gastar,** a mensagem mostra o custo e quanto você já gastou no mês, e o botão é **Aprovar o gasto · US$ X**.
- **O Molde dentro do Claude (MCP).** Você pode ligar o UaiFlow no Claude como um conector e pedir em conversa: «o que está esperando por mim?», «aprova o item da Birdie», «pede 2 fotos da Birdie tomando café». Pedir é sempre em 2 passos (o Claude mostra o custo e só confirma com o seu sim). Passo a passo: `docs/MOLDE_MCP.md`.
- **O `/status` do Telegram** agora mostra também o gasto do mês contra o seu limite (`MOLDE_TETO_USD`).

Sobre a migração:

- Não apaga nada: acrescenta colunas novas na tabela `molde_fila` (da 0016) e troca a regra dos estados pela mesma, com um estado novo («na revisão»).
- Precisa da 0016. Se ainda não colou a 0016, cole a 0016 primeiro (`docs/ATUALIZACAO_0016.md`).
- O site continua funcionando sem ela: a página, o Telegram e o `/status` seguem iguais à v134. Só o orquestrador e o conector do Claude respondem «Falta colar a atualização 0019».
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 10 minutos (5 da migração e 5 das duas chaves).

## Passo 1 — colar a 0019 no Supabase

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0019_orquestrador.sql` (no GitHub, abra o arquivo e use o botão **Copy raw file**). Não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
4. Cole o arquivo inteiro e clique em **Run** (ou Cmd+Enter).
   - O que esperar: **Success. No rows returned**.
   - Se colar de novo, pode aparecer "already exists, skipping". Não é erro.
5. **Confira.** Numa **New query**, cole e rode:

   ```sql
   select count(*) from public.molde_fila where versao >= 1;
   ```

   Deve aparecer **uma linha com um número** (0 ou mais). Se aparecer `column "versao" does not exist`, repita o passo 4. Se aparecer `relation "public.molde_fila" does not exist`, falta a 0016.

## Passo 2 — as duas chaves novas no Netlify

São duas senhas compridas que só o servidor e quem usa conhecem. Para gerar cada uma no Mac, abra o **Terminal** e rode `openssl rand -hex 32`; copie o que aparecer (rode de novo para a segunda: elas precisam ser diferentes).

1. https://app.netlify.com → o site **uaiflow-divinetones** → **Site configuration** → **Environment variables** → **Add a variable**.
2. `MOLDE_MCP_TOKEN` = a primeira chave. É a chave do conector do Claude (passo 3). Sem ela, o conector fica desligado.
3. `MOLDE_ORQUESTRADOR_TOKEN` = a segunda chave (**opcional**). É a chave só do orquestrador: ela abre só a fila (não abre os posts, as DMs nem o resto do Molde). Vai nos segredos da tarefa agendada «Orquestrador do Molde» quando ela for criada. Sem ela, o orquestrador usa o mesmo `MOLDE_API_TOKEN` da página.
4. **Deploys** → **Trigger deploy** → **Deploy site** (as variáveis só valem depois de publicar).

## Passo 3 — ligar o Molde no Claude (opcional)

Siga `docs/MOLDE_MCP.md` (5 minutos): no Claude, **Configurações → Conectores → Adicionar conector personalizado**, com o endereço `https://SEU-SITE/api/mcp?chave=<a chave MOLDE_MCP_TOKEN>`.

## Bom saber

- **A página continua dona dos pedidos dela** (as fotos, os vídeos, a voz): o orquestrador só trabalha nos itens dele (os que têm uma estação), e a página só aplica as decisões dos pedidos dela.
- **Ninguém apaga o trabalho do outro:** cada item tem um número de versão; se duas coisas tentarem mudar o mesmo item ao mesmo tempo, a segunda recebe «o item mudou, leia de novo».
- **Se o orquestrador cair no meio,** o item volta sozinho para a fila quando o prazo dele vence (15 minutos, se ninguém disser outro). Depois de 2 tentativas com erro, o item fica «com erro» e o Telegram avisa.
- **A sua decisão vale uma vez só:** a primeira (Telegram, página ou Claude) vale; as outras veem «já decidido».
