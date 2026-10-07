# Avisos no celular, monitor e cópia do banco

Este guia liga três proteções do UaiFlow. Nenhuma delas é obrigatória: sem elas o UaiFlow funciona igual, só não avisa.

- **Avisos no Telegram.** O UaiFlow manda mensagem quando um post não sai, quando a renovação da conexão do Instagram falha e quando uma conexão vence em menos de 10 dias.
- **Monitor (GitHub, a cada hora, no minuto 17).** Ele confere se o relógio do UaiFlow (que publica os posts e manda as DMs) está rodando. Se não estiver, avisa no Telegram, e o GitHub também manda um e-mail.
- **Cópia do banco (GitHub, todo domingo às 03:23 de Brasília).** Guarda uma cópia criptografada do banco por 90 dias.

Você vai precisar de uns 30 minutos, do celular com o Telegram e do computador.

---

## Parte 1: criar o robô no Telegram

1. No celular, abra o Telegram e procure **@BotFather** (tem o selo azul de verificado).
2. Toque em **Começar** e mande a mensagem `/newbot`.
3. Ele pede um nome. Mande, por exemplo: `Avisos UaiFlow`.
4. Ele pede um nome de usuário, que precisa terminar em `bot`. Mande, por exemplo: `uaiflow_avisos_nicolas_bot`. Se já existir, tente outro.
5. O BotFather responde com um **token**, parecido com `123456789:AAH...`. Esse é o **TELEGRAM_BOT_TOKEN**. Copie e guarde num lugar seguro (quem tem o token consegue mandar mensagens em nome do robô).
6. Na mesma resposta há um link `t.me/...` para o seu robô. Abra esse link e toque em **Começar**. Sem isso o robô não consegue falar com você.

## Parte 2: descobrir o número da conversa

1. No Telegram, procure **@userinfobot** e toque em **Começar**.
2. Ele responde com várias linhas. O número ao lado de **Id** (por exemplo `987654321`) é o **TELEGRAM_CHAT_ID**.

## Parte 3: colar no Netlify (avisos do site)

1. Entre em https://app.netlify.com e abra o site **uaiflow-divinetones**.
2. Vá em **Site configuration** → **Environment variables** → **Add a variable**.
3. Em **Key**, escreva `TELEGRAM_BOT_TOKEN`. Em **Value**, cole o token da Parte 1. Se aparecer a opção **Contains secret values**, marque. Salve.
4. Repita com **Key** `TELEGRAM_CHAT_ID` e o número da Parte 2.
5. As variáveis só valem depois de publicar o site de novo. Se o Netlify está ligado ao GitHub, vá em **Deploys** → **Trigger deploy** → **Deploy site** e espere ficar verde (**Published**). Se a publicação é feita pelo Terminal, rode a publicação de novo.
6. Abra o UaiFlow → **Configurações** → quadro **Avisos no celular** → **Enviar aviso de teste**.
   - "Aviso enviado! Confira o Telegram.": pronto, chegou uma mensagem do seu robô.
   - "Falta configurar TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no Netlify.": confira os nomes das variáveis e se o deploy novo terminou.
   - "...não aceitou o TELEGRAM_BOT_TOKEN...": o token foi copiado pela metade. Copie de novo no @BotFather.
   - "...não achou a conversa..." ou "...O robô ainda não pode falar com você...": abra o seu robô no Telegram, toque em **Começar** (Parte 1, passo 6) e confira o número da Parte 2.

## Parte 4: colar as migrações no Supabase

O monitor depende da migração 0004. Cada arquivo pode ser colado mais de uma vez sem problema.

1. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
2. No menu da esquerda, abra **SQL Editor** → **New query**.
3. Abra o arquivo `supabase/migrations/0003_publicacao_segura.sql` do UaiFlow, copie tudo, cole no editor e clique em **Run**. Deve aparecer "Success. No rows returned".
4. Faça o mesmo com `supabase/migrations/0004_saude.sql`.
5. Para conferir, abra no navegador `https://uaiflow-divinetones.netlify.app/api/health`. Depois de 1 ou 2 minutos deve aparecer `"ok":true`.

## Parte 5: segredos no GitHub (monitor e cópia)

1. Abra o repositório do UaiFlow no GitHub.
2. Vá em **Settings** → **Secrets and variables** → **Actions** → aba **Secrets** → **New repository secret**. Crie um segredo por vez. Em **Name** vai o nome exato abaixo e em **Secret** vai o valor:
   - `TELEGRAM_BOT_TOKEN`: o mesmo token da Parte 1.
   - `TELEGRAM_CHAT_ID`: o mesmo número da Parte 2.
   - `SUPABASE_DB_URL`: o endereço do banco para a cópia (veja o passo 3).
   - `BACKUP_PASSPHRASE`: a senha que tranca as cópias (veja o passo 4).
3. **SUPABASE_DB_URL tem que ser a do Session pooler**, porque o GitHub não consegue usar a conexão direta do Supabase (ela é IPv6).
   1. No Supabase, clique no botão **Connect** (no alto da tela do projeto).
   2. Escolha **Session pooler** e copie o endereço. Ele termina em `pooler.supabase.com:5432/postgres`, com a **porta 5432**.
   3. Troque `[YOUR-PASSWORD]` pela senha do banco (a mesma que está no `DATABASE_URL` do Netlify).
   4. O resultado fica parecido com `postgresql://postgres.abcdefgh:SUA-SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`.
   5. Dica: é o mesmo endereço do `DATABASE_URL` do Netlify, mas com a porta trocada de 6543 para 5432.
4. **BACKUP_PASSPHRASE** é uma senha forte, só para as cópias.
   1. No Mac, abra o **Terminal** e rode `openssl rand -base64 24`. Use o texto que aparecer.
   2. **Guarde essa senha no gerenciador de senhas** (Chaves do iCloud, 1Password etc.). Sem ela, ninguém consegue abrir as cópias, nem você.
   3. O repositório é público e qualquer pessoa com conta no GitHub consegue baixar o arquivo da cópia. A senha é o que protege os dados. Nunca a coloque em arquivo do projeto.
5. (Opcional) Se o endereço do site mudar, vá na aba **Variables** → **New repository variable**, com nome `UAIFLOW_URL` e o endereço novo (ex.: `https://meu-dominio.com.br`). Sem essa variável o monitor usa `https://uaiflow-divinetones.netlify.app`.

Sem `SUPABASE_DB_URL`, a cópia só avisa que não foi feita e termina sem erro. Com `SUPABASE_DB_URL` e sem `BACKUP_PASSPHRASE`, ela falha de propósito, porque nunca guarda cópia sem criptografia.

## Parte 6: rodar o monitor e a cópia na mão

1. No GitHub, abra a aba **Actions** do repositório.
2. Na lista da esquerda, clique em **Monitor do UaiFlow** (ou **Cópia semanal do banco**).
3. Clique em **Run workflow** → **Run workflow** (botão verde).
4. Espere 1 ou 2 minutos e atualize a página.
   - Bolinha verde: tudo certo.
   - Bolinha vermelha: clique nela para ver o motivo. O mesmo motivo chega no Telegram, se os segredos estiverem criados.

## Parte 7: baixar e abrir uma cópia

1. No GitHub: **Actions** → **Cópia semanal do banco** → clique numa execução verde.
2. No fim da página, em **Artifacts**, clique em `uaiflow-banco-AAAA-MM-DD`. Vai baixar um `.zip`.
3. Dê dois cliques no `.zip`. Sai o arquivo `uaiflow-banco-AAAA-MM-DD.sql.gz.enc` (ele continua trancado).
4. Abra o **Terminal** e vá para a pasta Downloads:
   ```bash
   cd ~/Downloads
   ```
5. Destranque com a senha (troque `AAAA-MM-DD` pela data do arquivo):
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -in uaiflow-banco-AAAA-MM-DD.sql.gz.enc -out uaiflow-banco.sql.gz
   ```
   O Terminal pede a senha (`enter AES-256-CBC decryption password`). Digite a **BACKUP_PASSPHRASE** e aperte Enter. Nada aparece enquanto você digita, e isso é normal.
   - Se aparecer `bad decrypt`, a senha está errada.
   - Se o Mac reclamar de `-pbkdf2`, instale o OpenSSL completo com `brew install openssl` e troque `openssl` por `$(brew --prefix openssl)/bin/openssl` no comando.
6. Descompacte:
   ```bash
   gunzip uaiflow-banco.sql.gz
   ```
   Agora existe o arquivo `uaiflow-banco.sql`, em texto, com as tabelas e os dados do UaiFlow (schema `public`).
7. Para olhar os dados num Postgres do próprio Mac (por exemplo, o Postgres.app):
   ```bash
   createdb uaiflow_copia
   psql -d uaiflow_copia -f uaiflow-banco.sql
   psql -d uaiflow_copia -c "select status, count(*) from content_posts group by status;"
   ```
   Alguns erros como `schema "auth" does not exist` ou `schema "public" already exists` são normais. A parte `auth` só existe dentro do Supabase, e as tabelas e os dados do UaiFlow entram assim mesmo.
8. Para recolocar a cópia num Supabase (numa emergência), crie um projeto novo e rode `psql "ENDEREÇO-DO-SESSION-POOLER-DO-PROJETO-NOVO" -f uaiflow-banco.sql`. Não faça isso por cima do banco que está em uso sem pedir ajuda antes.

## Parte 8: o que fazer quando chega um aviso

| Aviso | O que fazer |
|---|---|
| "o post ... não saiu. Motivo: ..." | Toque no link, leia o motivo no post e use **Tentar de novo** (ou troque o vídeo). |
| "atenção com a conexão do Instagram" | Abra **Perfis** no UaiFlow e reconecte a conta citada. |
| Monitor: "O relógio ... não roda há X minutos" | No Supabase, veja se o projeto não está pausado (botão **Restore**) e se o agendamento `uaiflow-drain-every-minute` continua ativo na área **Cron** (em **Integrations** → **Cron**; em painéis mais antigos, **Database** → **Cron Jobs**). |
| Monitor: "Falta aplicar a migração 0004_saude.sql" | Faça a Parte 4. |
| Monitor: "O banco de dados (Supabase) não respondeu" | Normalmente é o projeto pausado no Supabase. Abra o painel e clique em **Restore**. |
| Monitor: "O site não respondeu" ou "respondeu com erro" | Veja no Netlify se o último deploy está verde. Se o próximo monitor (na hora seguinte) passar, foi uma falha passageira. |
| "a cópia semanal do banco falhou" | Toque no link e veja o passo vermelho. O mais comum é senha do banco trocada: atualize o segredo `SUPABASE_DB_URL`. |

## Bom saber

- O GitHub desliga os agendamentos (monitor e cópia) de repositórios públicos depois de **60 dias sem nenhuma alteração** no repositório. Ele manda e-mail antes. Para religar: **Actions** → clique no workflow → **Enable workflow**.
- Os horários do GitHub podem atrasar alguns minutos em horários de pico.
- Os avisos do site saem do Netlify (variáveis da Parte 3). Os do monitor e da cópia saem do GitHub (segredos da Parte 5). Por isso o token e o número aparecem nos dois lugares.
