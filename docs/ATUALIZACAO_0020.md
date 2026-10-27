# Atualização do banco: migração 0020 (a página de venda no ar pelo UaiFlow e o progresso do vídeo no Telegram)

Esta atualização acompanha a versão 137 do Molde. O arquivo `0020_paginas_e_progresso.sql` tem tudo junto: **você cola o arquivo inteiro** (pode colar de novo, não apaga nada).

O que muda com ela:

- **A página de venda vai ao ar sozinha.** Antes, a Fábrica do Molde gerava a página de venda (`pagina-para-subir.html`) e você subia o arquivo no Cloudflare à mão. Agora o Molde manda a página para o UaiFlow e ela abre num endereço como `https://uaiflow-divinetones.netlify.app/v/oracao-da-manha` (ou no seu próprio domínio, veja abaixo). Atualizar a página é mandar de novo: o endereço continua o mesmo.
- **A página roda isolada.** O código da página de venda não consegue ver nada do painel do UaiFlow (nem o seu login), mesmo estando no mesmo site. Os botões de comprar (checkout) e o link que conta cliques (`/l/…`) continuam funcionando normalmente.
- **O Telegram mostra cada vídeo numa mensagem só.** Em vez de várias mensagens por vídeo, chega **uma** mensagem que vai se atualizando sozinha, por exemplo:

  ```
  Reel «Oração da manhã» · Birdie
  3 de 6 · Voz ✓ · Fazendo o vídeo…
  ```

  Quando o vídeo pede a sua aprovação, a mensagem com os botões **Aprovar** / **Refazer** continua chegando como hoje (nada muda no jeito de aprovar); a mensagem do vídeo mostra «esperando você aprovar» e, depois do seu toque, passa a mostrar o próximo passo.

Sobre a migração:

- Não apaga nada: cria duas tabelas novas (as páginas e as mensagens de progresso) e uma coluna nova na fila do Molde.
- A parte do Telegram precisa da 0016 (a fila do Molde). Se a 0016 ainda não foi colada, a 0020 cola sem erro e só a página de venda passa a funcionar.
- O site continua funcionando sem ela: o Molde mostra «Falta colar a atualização 0020» quando tentar pôr a página no ar, e o Telegram continua mandando as mensagens como antes.
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 5 minutos.

## Passo 1 — colar a 0020 no Supabase

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0020_paginas_e_progresso.sql` (no GitHub, abra o arquivo e use o botão **Copy raw file**). Não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
4. Cole o arquivo inteiro e clique em **Run** (ou Cmd+Enter).
   - O que esperar: **Success. No rows returned**.
   - Se colar de novo, pode aparecer "already exists, skipping". Não é erro.
5. **Confira.** Numa **New query**, cole e rode:

   ```sql
   select count(*) from public.molde_paginas;
   ```

   Deve aparecer **uma linha com o número 0** (ou mais). Se aparecer `relation "public.molde_paginas" does not exist`, repita o passo 4.

## Passo 2 — nada de variável nova obrigatória

Não precisa de variável nova no Netlify (a `PAGINAS_BASE_URL`, do domínio próprio, é opcional: veja «Usar o seu próprio domínio»). A página usa o mesmo armazenamento (Cloudflare R2) das mídias; sem o R2, ela fica guardada no próprio banco.

Opcional: se um dia quiser **desligar** a mensagem de progresso do Telegram (e voltar a receber só as aprovações), crie no Netlify a variável `TELEGRAM_PROGRESSO` = `0` e publique de novo (**Deploys** → **Trigger deploy** → **Deploy site**). Sem ela, fica ligada.

## Passo 3 — publicar a versão nova do site

Como sempre: juntar o ramo no `main` e esperar o Netlify ficar verde (**Published**).

## Usar o seu próprio domínio (opcional)

Com um domínio seu (ex.: `oracaodamanha.com.br`), as páginas de venda ficam em **`oracaodamanha.com.br/v/<nome-da-página>`**, que passa mais confiança do que o endereço do Netlify. Leva uns 20 minutos, mais a espera do domínio «pegar» (de minutos a algumas horas).

1. **Compre o nome.**
   - Para **.com.br**: no **Registro.br** (https://registro.br), com o seu CPF ou CNPJ. Cerca de R$ 40 por ano.
   - Para **.com**: na **Cloudflare** (https://dash.cloudflare.com → **Domain Registration** → **Register Domains**) ou na **Porkbun** (https://porkbun.com). Cerca de US$ 10 por ano.
2. **Ligue o domínio no Netlify.**
   1. https://app.netlify.com → o site **uaiflow-divinetones** → **Domain management** → **Add a domain**.
   2. Escreva o domínio (ex.: `oracaodamanha.com.br`) → **Verify** → **Add domain**.
   3. O Netlify mostra as **linhas de DNS** para copiar (normalmente uma linha do tipo **A** para o domínio sem `www`, com um número como `75.2.60.5`, e uma linha do tipo **CNAME** para o `www`, apontando para `uaiflow-divinetones.netlify.app`). Deixe essa tela aberta.
3. **Copie as linhas no painel de quem vendeu o domínio.**
   - **Registro.br:** entre, clique no domínio → **DNS** → **Editar zona** (se pedir, escolha «Utilizar os servidores DNS do Registro.br») → **Nova entrada** para cada linha que o Netlify mostrou (tipo, nome e valor iguais) → **Salvar**.
   - **Cloudflare:** o domínio → **DNS** → **Records** → **Add record** para cada linha. Em cada uma, deixe a nuvem **cinza** («DNS only»), senão o certificado do Netlify não sai.
   - **Porkbun:** **Domain Management** → **DNS** ao lado do domínio → apague as linhas de exemplo («parking») e adicione as do Netlify.
4. **Espere e confira.** Volte ao Netlify (**Domain management**): quando aparecer o cadeado (**HTTPS**, «certificate provisioned»), abra `https://oracaodamanha.com.br/v/<nome-da-página>`. Se ainda não abrir, espere mais um pouco (às vezes leva algumas horas).

Bom saber sobre o domínio próprio:

- O domínio fica ligado ao **mesmo site** do Netlify: toda página de venda abre nele (`seudominio.com/v/<nome>`) e também continua abrindo no endereço do Netlify.
- O painel do UaiFlow também responde nesse domínio (com o mesmo login de sempre). **Não troque** o `APP_BASE_URL` nem os endereços cadastrados na Meta: continue usando `https://uaiflow-divinetones.netlify.app` neles.
- **Para o Molde já mostrar o link com o seu domínio:** no Netlify, **Site configuration** → **Environment variables** → **Add a variable**: `PAGINAS_BASE_URL` = `https://oracaodamanha.com.br` (com `https://`, sem barra no fim) e publique de novo (**Deploys** → **Trigger deploy** → **Deploy site**). Sem ela, o link vem com o endereço do Netlify (e o seu domínio funciona do mesmo jeito: troque só o começo).

## Bom saber

- **Tamanho:** a página pode ter até **5 MB** (com as imagens). Se passar, o Molde mostra «A página tem X MB: o máximo é 5,0 MB» e pede imagens menores.
- **Tirar do ar:** pelo Molde («Tirar do ar»). O endereço passa a dizer «Página não encontrada»; publicar de novo põe de volta no mesmo endereço.
- **Atualizou a página?** Em até 1 minuto todo mundo vê a versão nova.
- **Mensagem de progresso:** ela é editada no máximo uma vez por segundo (regra do Telegram); várias mudanças rápidas aparecem juntas. Se o Telegram estiver fora do ar, a mensagem se atualiza sozinha no minuto seguinte.

## Por dentro (para quem mexer no código)

- Páginas: `src/lib/molde/paginas.ts`, rotas `src/app/api/molde/paginas/route.ts` (POST, GET), `src/app/api/molde/paginas/[id]/route.ts` (DELETE) e a página pública `src/app/v/[slug]/route.ts` (CSP `sandbox` sem `allow-same-origin`). R2: `uaiflow/paginas/<id>.html` (privado, protegido da limpeza das mídias). Contrato: `docs/API_MOLDE_PAGINAS.md`.
- Progresso: `src/lib/telegram/progresso.ts` (o grupo de cada item, o texto, 1 edição por segundo com a vez no banco, pendentes no relógio `src/lib/molde/relogio.ts`). Ligado no espelho (`POST /api/molde/fila`), nas decisões (`reflectFilaDecision`, os botões do Telegram, o motivo do «Refazer») e no `cancelar`. Campos novos no espelho: `grupo` e `passos` (`docs/API_MOLDE_FILA.md`).
- Testes: `tests/molde-paginas.test.mts`, `tests/molde-paginas-sem-0020.test.mts`, `tests/telegram-progresso.test.mts`.
