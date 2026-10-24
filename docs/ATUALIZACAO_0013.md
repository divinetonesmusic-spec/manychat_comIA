# Atualização do banco: migração 0013 (o quiz, a página de entrega e a Lista própria)

Esta atualização acompanha a versão 133 da página do Molde. O arquivo `0013_quiz_entrega_e_lista.sql` tem tudo junto: **você cola o arquivo inteiro** (pode colar de novo, não apaga nada).

## O que muda com ela

- **Quiz do avatar** (`https://SEU-SITE/q/<nome-do-quiz>`): a página do Molde monta o quiz com o Claude e publica aqui. A pessoa responde de 6 a 8 perguntas no celular, vê a tela «analisando», deixa o e-mail e vê o resultado com o perfil dela e o botão para a oferta certa. O Molde mostra quantas pessoas começaram, terminaram, deixaram o e-mail e compraram, por perfil.
- **Pergunta do quiz na DM:** quando você escolhe «Começar pela pergunta do quiz» no post, quem comenta a palavra recebe a 1ª pergunta com botões. O toque marca o perfil da pessoa e leva o link do quiz.
- **Página de entrega do material grátis** (`https://SEU-SITE/e/<nome>`): no lugar do link do Claude, uma página bonita, no visual do avatar. A pessoa deixa o e-mail e baixa o PDF (e/ou abre a versão interativa). O arquivo fica guardado no seu armazenamento (R2), sem ficar público.
- **Lista própria:** todos os e-mails do quiz e da entrega ficam numa lista sua, com de onde a pessoa veio, o perfil do quiz, se ela aceitou receber dicas e ofertas, a data e o «sair da lista». O Molde baixa a lista em planilha.
- **Proteção dos formulários:** cada formulário de e-mail (o do quiz, o da entrega e o da página de obrigado da escada) aceita poucas tentativas seguidas da mesma internet e do mesmo e-mail, e ignora robôs. Ninguém consegue cadastrar a caixa de outra pessoa em série.

**Nenhum e-mail é enviado** por esta atualização. A sequência de e-mails fica para depois (você ainda vai decidir o canal). O campo já está pronto na lista, desligado.

Sobre a migração:

- Não apaga nada: cria tabelas novas (`quizzes`, `quiz_sessoes`, `quiz_origens`, `entregas`, `entrega_eventos`, `leads`, `formulario_limites`).
- Não precisa de outra antes (só as que você já colou). Sem a 0012, a contagem de compras do quiz fica em 0.
- O site continua funcionando sem ela: as páginas `/q/` e `/e/` dizem «página não encontrada», o Molde mostra «Falta colar a atualização 0013» e nada do que já existia muda.
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 3 minutos.

## Passo 1 — colar a 0013 no Supabase

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0013_quiz_entrega_e_lista.sql` (no GitHub, abra o arquivo e use o botão **Copy raw file**). Não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
4. Cole o arquivo inteiro e clique em **Run** (ou Cmd+Enter).
   - O que esperar: **Success. No rows returned**.
   - Se colar de novo, pode aparecer "already exists, skipping". Não é erro.
5. **Confira.** Numa **New query**, cole e rode:

   ```sql
   select count(*) from public.leads;
   ```

   Deve aparecer **uma linha com o número 0**. Se aparecer `relation "public.leads" does not exist`, repita o passo 4.

## Passo 2 (opcional) — confirmação dupla do e-mail

Desligada por padrão. Ligada, quem marca «quero receber dicas e ofertas» recebe **um** e-mail com um link para confirmar, e só conta na lista depois do toque (o resultado do quiz e o download nunca esperam). Precisa do envio de e-mail do Resend já configurado (as variáveis `RESEND_API_KEY` e `EMAIL_REMETENTE`, as mesmas do pedido de depoimento — veja `docs/vendas-escada.md`).

Para ligar: https://app.netlify.com → o site **uaiflow-divinetones** → **Site configuration** → **Environment variables** → **Add a variable** → nome `FUNIL_CONFIRMACAO_DUPLA`, valor `1` → depois **Deploys** → **Trigger deploy** → **Deploy site**.

## Passo 3 — publicar a página do Molde v133

Os botões «Montar o quiz», «Publicar o quiz no UaiFlow» e «Publicar a página de entrega» vêm na versão 133 da página do Molde. O envio do PDF passa pelo robô do Mac (o mesmo de sempre, nada a instalar).

## Bom saber

- A versão interativa do material precisa ser **um arquivo HTML só** (com as imagens dentro). Se o material tiver várias pastas, mande só o PDF.
- O link de download vale 10 minutos (o PDF baixa na hora); a versão interativa abre por 6 horas. A pessoa pode voltar à página e baixar de novo por 30 dias, no mesmo celular.
- A lista mostra quem **aceitou** receber dicas e ofertas. Quem só deixou o e-mail para ver o resultado ou baixar o material também fica na planilha, mas sem o «aceita e-mails»: não mande ofertas para essas pessoas.
