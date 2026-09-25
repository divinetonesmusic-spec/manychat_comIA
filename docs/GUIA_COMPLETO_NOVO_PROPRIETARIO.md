# Guia completo: crie seu proprio manychat_comIA

Este guia foi escrito para quem nao e programador. Siga as etapas na ordem. Reserve de 60 a 120 minutos. Nao use credenciais de outra pessoa: sua copia deve ter GitHub, banco, deploy, app Meta e Instagram proprios.

## 1. O que voce vai criar

| Conta | Para que serve | Site | Custo inicial |
|---|---|---|---|
| GitHub | Guarda o codigo | https://github.com | Gratuito |
| Supabase | Login e banco de dados | https://supabase.com | Plano gratuito disponivel |
| Vercel | Coloca o site no ar | https://vercel.com | Plano gratuito disponivel |
| Meta for Developers | Autoriza a API do Instagram | https://developers.facebook.com | Gratuito |
| Instagram profissional | Perfil que sera automatizado | App Instagram | Gratuito |

Use um e-mail ao qual voce sempre tera acesso. Ative autenticacao em dois fatores nas contas Meta, GitHub, Supabase e Vercel.

> **Nunca compartilhe:** senha do banco, `DATABASE_URL`, chaves secretas do Supabase, `INSTAGRAM_APP_SECRET`, token do Instagram, `WORKER_SECRET` ou `ADMIN_SESSION_SECRET`. Nao coloque esses valores no GitHub.

## 2. Antes de comecar

1. No Instagram, abra **Configuracoes e privacidade > Tipo e ferramentas da conta**.
2. Confirme que a conta e **Criador** ou **Empresa**. Conta pessoal nao funciona com a API.
3. Instale no computador:
   - Git: https://git-scm.com/downloads
   - Node.js 20 LTS: https://nodejs.org
   - Visual Studio Code: https://code.visualstudio.com
4. Reinicie o terminal depois de instalar.
5. Confirme com `node --version` e `npm --version`.

## 3. Copiar o projeto para seu GitHub

### Opcao recomendada: template ou fork

1. Abra o repositorio original no GitHub.
2. Se houver o botao **Use this template**, clique nele; caso contrario, clique em **Fork**.
3. Escolha sua conta.
4. Nome sugerido: `manychat_comIA`.
5. Mantenha o repositorio **Private** durante a configuracao.
6. Clique em **Create repository**.

### Baixar para o computador

No repositorio novo, clique em **Code**, copie a URL HTTPS e execute:

```bash
git clone https://github.com/msgsolucoes/exemplo_manychat_comIA
cd exemplo_manychat_comIA
npm install
```

Nao envie `.env.local`, `.next`, `.vercel` ou `node_modules` ao GitHub. O projeto ja os ignora.

## 4. Criar o Supabase

1. Entre em https://supabase.com/dashboard.
2. Clique em **New project**.
3. Escolha sua organizacao.
4. Preencha o nome, por exemplo `manychat_comIA`.
5. Crie uma senha forte para o banco e guarde-a em um gerenciador de senhas.
6. Escolha a regiao mais proxima dos seus usuarios.
7. Aguarde o projeto ficar pronto.

### Copiar as chaves

No painel do projeto, abra **Project Settings > API** (em interfaces novas, procure **Connect** ou **API Keys**). Guarde:

- Project URL;
- chave publica `anon` ou `publishable`;
- chave secreta `service_role` ou `secret`.

Abra **Connect > Connection string > URI** e copie a conexao Postgres. Substitua `[YOUR-PASSWORD]` pela senha criada. Se a senha tiver caracteres especiais, use a URI que o Supabase gera ou aplique URL encoding.

## 5. Criar o arquivo local de configuracao

Na pasta do projeto, execute no Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

No macOS/Linux:

```bash
cp .env.example .env.local
```

Abra `.env.local` no Visual Studio Code e preencha inicialmente:

| Variavel | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL do Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave publica anon/publishable |
| `SUPABASE_URL` | a mesma Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | chave secreta service_role/secret |
| `DATABASE_URL` | connection string Postgres |
| `DATABASE_POOL_MAX` | `1` |
| `APP_BASE_URL` | por enquanto `http://127.0.0.1:3000` |

Para gerar segredos, execute tres vezes:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use valores diferentes em:

- `ADMIN_SESSION_SECRET`;
- `WORKER_SECRET`;
- `WEBHOOK_VERIFY_TOKEN`.

Crie uma senha com pelo menos 12 caracteres para `ADMIN_PASSWORD`.

As variaveis da Meta serao preenchidas na etapa 9. Por enquanto, deixe os placeholders e nao rode `setup:check` ainda.

## 6. Criar o banco com migrations

No terminal, dentro da pasta do projeto:

```bash
npm run db:migrate
npm run db:status
```

Resultado esperado:

```text
[aplicada] 0001_initial_schema.sql
0001_initial_schema.sql: aplicada em ...
```

Execute `npm run db:migrate` novamente. O resultado esperado e “Nenhuma migration pendente”. Nunca edite uma migration ja aplicada.

Se aparecer erro de senha, copie novamente a Connection string do Supabase. Se aparecer timeout, use a conexao do pooler recomendada pelo painel.

## 7. Configurar login no Supabase

1. No Supabase, abra **Authentication > URL Configuration**.
2. Em **Site URL**, coloque temporariamente `http://127.0.0.1:3000`.
3. Em **Redirect URLs**, adicione:

```text
http://127.0.0.1:3000/auth/callback
http://localhost:3000/auth/callback
```

4. Em **Authentication > Providers > Email**, mantenha e-mail ativado.
5. Para um MVP, voce pode desativar confirmacao de e-mail; em producao aberta, mantenha confirmacao ativa e configure o provedor de e-mail.

## 8. Fazer o primeiro deploy na Vercel

1. Entre em https://vercel.com e escolha **Continue with GitHub**.
2. Clique em **Add New > Project**.
3. Importe seu repositorio `manychat_comIA`.
4. A Vercel deve detectar **Next.js** automaticamente.
5. Antes de clicar em Deploy, abra **Environment Variables**.
6. Copie todas as variaveis de `.env.example` e seus valores atuais.
7. Ainda nao use placeholders da Meta como valores definitivos; o primeiro deploy pode falhar em telas que exigem Meta, mas servira para obter o dominio.
8. Clique em **Deploy**.
9. Ao finalizar, copie o dominio, por exemplo `https://meu-manychat_comIA.vercel.app`.

Agora altere na Vercel:

```text
APP_BASE_URL=https://meu-manychat_comIA.vercel.app
INSTAGRAM_REDIRECT_URI=https://meu-manychat_comIA.vercel.app/api/oauth/callback
```

Atualize tambem esses dois valores no `.env.local`.

## 9. Criar o app na Meta

Os nomes dos menus da Meta mudam com frequencia. Procure pelos termos em negrito quando a posicao for diferente.

1. Entre em https://developers.facebook.com/apps/.
2. Clique em **Create App**.
3. Escolha um caso de uso que permita **Instagram API / Instagram Login**.
4. Nome sugerido: `manychat_comIA - Seu Nome`.
5. Informe e-mail de contato e conclua a criacao.
6. No painel do app, adicione/configure **Instagram** e **API setup with Instagram login**.
7. Copie o **Instagram App ID** e o **Instagram App Secret**.
8. Em OAuth/Instagram Login, adicione exatamente:

```text
https://meu-manychat_comIA.vercel.app/api/oauth/callback
```

9. Configure as URLs publicas:

```text
Privacy Policy: https://meu-manychat_comIA.vercel.app/privacy-policy
Data Deletion: https://meu-manychat_comIA.vercel.app/data-deletion
```

10. As permissoes usadas pelo manychat_comIA sao:

```text
instagram_business_basic
instagram_business_manage_messages
instagram_business_manage_comments
instagram_business_content_publish
instagram_business_manage_insights
```

Durante o desenvolvimento, adicione sua conta como tester/usuario do app quando solicitado e aceite o convite no Instagram.

### Preencher as variaveis Meta

No `.env.local` e na Vercel, preencha:

| Variavel | Onde obter |
|---|---|
| `META_API_VERSION` | use `v25.0` enquanto suportada pelo app |
| `INSTAGRAM_APP_ID` | painel do app Meta |
| `INSTAGRAM_APP_SECRET` | painel do app Meta |
| `INSTAGRAM_REDIRECT_URI` | dominio Vercel + `/api/oauth/callback` |
| `WEBHOOK_VERIFY_TOKEN` | segredo aleatorio criado por voce |

Depois execute localmente:

```bash
npm run setup:check
```

O resultado deve terminar em `Ambiente configurado corretamente.`

Na Vercel, clique em **Redeploy** depois de mudar variaveis.

## 10. Configurar o webhook na Meta

1. No app Meta, abra **Webhooks** ou a configuracao de webhooks do Instagram.
2. Use como Callback URL:

```text
https://meu-manychat_comIA.vercel.app/api/webhook
```

3. Em Verify Token, cole exatamente o valor de `WEBHOOK_VERIFY_TOKEN` da Vercel.
4. Clique em **Verify and Save**.
5. Assine pelo menos os campos `comments` e `messages`.

Se a verificacao falhar, confira se o deploy mais recente terminou e se o token da Meta e identico ao da Vercel, sem espacos.

## 11. Atualizar URLs do Supabase

Em **Authentication > URL Configuration**:

1. troque Site URL para `https://meu-manychat_comIA.vercel.app`;
2. mantenha as URLs locais;
3. adicione:

```text
https://meu-manychat_comIA.vercel.app/auth/callback
```

## 12. Configurar os jobs automaticos

Os jobs drenam a fila a cada minuto e renovam o token semanalmente.

1. No Supabase, habilite as extensoes `pg_cron` e `pg_net` em **Database > Extensions**.
2. Abra `supabase/cron.sql` no computador.
3. Substitua `https://SEU-DOMINIO-VERCEL` pelo seu dominio.
4. Substitua `SEU_WORKER_SECRET` pelo mesmo `WORKER_SECRET` cadastrado na Vercel.
5. Copie todo o SQL.
6. No Supabase, abra **SQL Editor > New query**, cole e clique em **Run**.

Nao envie o `cron.sql` personalizado ao GitHub, pois ele passa a conter seu segredo. Depois de executar, desfaça as substituicoes locais ou descarte o arquivo modificado.

Para conferir os jobs no SQL Editor:

```sql
select jobname, schedule, active from cron.job order by jobname;
```

Devem existir `manychat_comIA-drain-every-minute` e `manychat_comIA-refresh-weekly`.

## 13. Primeiro acesso e conexao do Instagram

1. Abra seu dominio da Vercel.
2. Crie uma conta em **Cadastro** ou use a senha administrativa configurada.
3. Abra **Perfis**.
4. Clique em conectar Instagram.
5. Autorize a conta profissional e todas as permissoes solicitadas.
6. Volte a **Perfis** e confirme o username.
7. Abra o diagnostico. Perfil, mídia e webhook devem aparecer como OK.

Se a Meta disser que a conta e pessoal, converta-a para Criador/Empresa e tente novamente. Se o token expirar, reconecte o perfil.

## 14. Criar a primeira automacao

Use um post de teste e um segundo perfil controlado.

1. Abra **Automacoes** e crie uma nova.
2. Nome: `Teste - entrega de link`.
3. Gatilho: comentarios.
4. Palavra-chave: `queroteste`.
5. Resposta publica: `Enviei as informacoes no direct.`
6. DM: `Oi! Este e um teste do meu manychat_comIA.`
7. Botao: `Abrir site`.
8. URL: seu dominio Vercel.
9. Ative e salve.
10. Em outro perfil, comente `queroteste` no post escolhido.

Resultado esperado:

- evento aparece no dashboard;
- resposta publica aparece no comentario;
- resposta privada/DM e enviada;
- job da fila fica como `sent`.

Para testar DM manual, o outro perfil deve primeiro enviar uma mensagem. A Meta permite resposta comum somente dentro da janela de 24 horas iniciada pelo usuario.

## 15. Como usar no dia a dia

Para instrucoes tela por tela, consulte o [Manual de uso](MANUAL_DE_USO.md).

- **Dashboard:** saude da conta, eventos e fila.
- **Perfis:** conecta contas e define a conta padrao.
- **Automacoes/Fluxos:** cria gatilhos, mensagens, links, atrasos e follow-ups.
- **Caixa de entrada:** consulta conversas e responde manualmente.
- **Contatos:** tags e pausa de automacao durante atendimento humano.
- **Conteudo:** publica imagem, video, reel, story e carrossel usando URLs publicas.
- **Configuracoes:** canal, menu persistente, ice breakers e diagnostico.

Publicacoes precisam usar mídia acessivel publicamente. A Meta baixa o arquivo pelo URL. Nao feche o acesso ao arquivo durante o processamento.

## 16. Manutencao

### Atualizar o codigo

Depois de receber uma atualizacao:

```bash
git pull
npm install
npm run db:migrate
npm run build
```

A Vercel normalmente faz novo deploy automaticamente quando o GitHub recebe um push.

### Token do Instagram

O cron tenta renovar o token. Consulte periodicamente o diagnostico em **Perfis**. Se estiver expirado ou proximo do vencimento, reconecte o Instagram.

### Backup

Configure backups no Supabase de acordo com seu plano. Nunca copie tokens ou contatos para outra instalacao.

## 17. Problemas comuns

| Problema | O que fazer |
|---|---|
| Build da Vercel falha | Confira o log e se todas as variaveis foram cadastradas |
| `DATABASE_URL` falha | Copie novamente a URI do Supabase e confira a senha |
| OAuth volta com erro | Callback deve ser identico na Meta, Vercel e `.env.local` |
| Conta pessoal | Mude para Criador ou Empresa |
| Webhook nao verifica | Confira URL HTTPS, deploy e `WEBHOOK_VERIFY_TOKEN` |
| Eventos nao chegam | Confira inscricao em `comments` e `messages` |
| DM fora do periodo | O usuario precisa enviar mensagem nas ultimas 24 horas |
| Resposta privada falha | Use um comentario recente e respeite as politicas Meta |
| Publicacao fica processando | Aguarde alguns minutos e clique em atualizar |
| Token expirado | Reconecte a conta em Perfis |
| Menu nao aparece | Publique/sincronize o menu em Configuracoes |
| Migration divergente | Nao edite migration aplicada; restaure o arquivo e crie outra |

## 18. Checklist de pronto

- [ ] Repositorio esta na sua conta GitHub.
- [ ] Supabase e banco pertencem a voce.
- [ ] `npm run db:status` nao mostra pendencias.
- [ ] Vercel fez deploy sem erro.
- [ ] Login funciona.
- [ ] Instagram profissional aparece em Perfis.
- [ ] Diagnostico nao possui erros.
- [ ] Webhook recebe DM e comentario.
- [ ] Automacao de teste envia resposta.
- [ ] Cron possui os dois jobs ativos.
- [ ] Nenhuma credencial real esta no GitHub.

Quando todos os itens estiverem marcados, sua instalacao e independente e esta pronta para uso.
