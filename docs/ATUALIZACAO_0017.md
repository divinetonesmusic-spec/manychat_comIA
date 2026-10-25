# Atualização do banco: migração 0017 (o desafio de 5 dias no Direct) e a contagem de visitas (Umami)

Esta atualização acompanha a versão 134 da página do Molde. O arquivo `0017_desafio_5_dias.sql` tem tudo junto: **você cola o arquivo inteiro** (pode colar de novo, não apaga nada).

## O que muda com ela

- **Desafio de 5 dias no Direct.** No lugar do curso por e-mail: quem comenta a palavra do post recebe o convite com o botão «Começar o dia 1». O toque manda o dia 1 na hora: o vídeo curto do avatar, o texto, a tarefa simples e o botão «Quero o dia 2 amanhã». Cada toque marca o dia seguinte para **23 horas depois** e ele sai sozinho.
- **Por que o botão:** o Instagram só deixa mandar mensagem automática até 24 horas depois do último toque ou mensagem da pessoa. O toque no botão renova essas 24 horas; por isso o dia seguinte sai com 23 horas, antes de fechar. Nada sai fora disso (o UaiFlow confere de novo na hora de mandar).
- **E-mail de reserva.** No dia 1, o desafio pede o e-mail «para não perder nenhum dia». Quem deu o e-mail e não tocou no botão em 24 horas recebe o dia seguinte **por e-mail** (um por dia, até o dia 5), com o link «Sair da lista» em todo e-mail. Se a pessoa voltar a tocar no botão no Direct, ela volta para o Direct.
- **A oferta no fim do dia 5**, com o link que conta o toque e leva ao checkout com o código do desafio. A venda que volta com esse código conta como compra do desafio.
- **Os números no Molde**, por desafio: quantos comentaram, se inscreveram, chegaram em cada dia (o funil dia a dia), deram o e-mail, receberam e-mails de reserva, tocaram na oferta e compraram; o **custo por venda** quando você informa o gasto de anúncio; e, com 2 versões (A e B), os números de cada uma. A versão vencedora só aparece com **200 inscritos ou mais em cada versão** e uma diferença clara de compras.

Sobre a migração:

- Não apaga nada: cria tabelas novas (`desafios`, `desafio_inscricoes`, `desafio_envios`, `desafio_origens`) e 2 colunas novas (`automations.desafio_id` e `leads.desafio_id`), e deixa a Lista própria aceitar e-mails vindos do desafio.
- Cole a 0013 antes desta (se ainda não colou): o e-mail de reserva vai para a Lista própria. Sem a 0013, cole a 0013 e depois a 0017 de novo. Sem a 0012, as compras do desafio aparecem como 0.
- O site continua funcionando sem ela: o Molde mostra «Falta colar a atualização 0017» e o post sai com a DM de sempre.
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 3 minutos.

## Passo 1 — colar a 0017 no Supabase

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0017_desafio_5_dias.sql` (no GitHub, abra o arquivo e use o botão **Copy raw file**). Não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
4. Cole o arquivo inteiro e clique em **Run** (ou Cmd+Enter).
   - O que esperar: **Success. No rows returned**.
   - Se colar de novo, pode aparecer "already exists, skipping". Não é erro.
5. **Confira.** Numa **New query**, cole e rode:

   ```sql
   select count(*) from public.desafio_inscricoes;
   ```

   Deve aparecer **uma linha com o número 0**. Se aparecer `relation "public.desafio_inscricoes" does not exist`, repita o passo 4.

## Passo 2 — o envio do e-mail de reserva (se ainda não tem)

O e-mail de reserva usa o mesmo envio de e-mail do pedido de depoimento (o Resend): as variáveis `RESEND_API_KEY` e `EMAIL_REMETENTE` no Netlify (veja `docs/vendas-escada.md`). Se já recebe os e-mails de depoimento, não precisa fazer nada.

**Sem essas variáveis**, o desafio funciona só pelo Direct: o dia 1 **não** pede o e-mail e nenhum e-mail sai. O painel do Molde mostra «O e-mail de reserva está desligado».

Opcional: `EMAIL_ENDERECO_POSTAL` (um endereço para o rodapé dos e-mails; nos Estados Unidos a lei pede).

## Passo 3 — a contagem de visitas com o Umami Cloud (grátis)

O Umami conta quantas pessoas abrem as páginas públicas do UaiFlow (o quiz `/q/…`, a página de entrega `/e/…` e as páginas de venda `/p/…`), sem cookies e sem guardar dados pessoais. É de código aberto e o Umami Cloud hospeda para você. Leva uns 5 minutos.

1. Entre em https://cloud.umami.is e clique em **Sign up** (o plano **Hobby** é grátis). Confirme o e-mail.
2. Dentro do Umami, vá em **Settings** → **Websites** → **Add website**.
   - **Name:** UaiFlow
   - **Domain:** o endereço do site, sem `https://` (ex.: `uaiflow-divinetones.netlify.app`)
   - Clique em **Save**.
3. Na linha do site, clique em **Edit** (ou no nome) e copie o **Website ID** (um código como `94db1cb1-74f4-4a40-ad6c-962362670409`).
4. Entre em https://app.netlify.com → o site **uaiflow-divinetones** → **Site configuration** → **Environment variables** → **Add a variable** → **Add a single variable**:
   - nome `UMAMI_WEBSITE_ID`, valor: o Website ID copiado.
5. **Deploys** → **Trigger deploy** → **Deploy site** (a variável só vale depois de publicar de novo).
6. Para conferir: abra um quiz ou uma página de entrega no celular e, em 1 minuto, veja a visita no painel do Umami (**Dashboard**).

- Sem a variável, nada muda: as páginas não carregam nenhum script de fora.
- Só se você usar um Umami próprio (não o Cloud): a variável `UMAMI_SRC` com o endereço do `script.js` dele (precisa começar com `https://`). Com o Umami Cloud, não precisa dela.
- O `/l/…` (o link que conta cliques) não tem página: ele só redireciona. Os cliques continuam no Molde, como antes.

## Passo 4 — publicar a página do Molde v134

O «Desafio de 5 dias» fica em Meus posts › Publicar e DM, na versão 134 da página do Molde: o Claude escreve os 5 dias, você confere, os vídeos saem pelo assistente de vídeo de sempre e «Publicar o desafio no UaiFlow» manda tudo. No cartão Publicar de cada post, «Começar pelo desafio de 5 dias» liga o desafio na palavra do post.

## O que o Instagram não deixa (e como o desafio respeita)

- **Mensagem automática só até 24 horas depois do último gesto da pessoa.** Cada dia sai 23 horas depois do toque no botão. Quem não toca não recebe mais nada no Direct (o dia vai por e-mail, se ela deu o e-mail).
- **Uma mensagem só para quem comentou**, até a pessoa responder: é o convite com o botão «Começar».
- **Vídeo na DM até 25 MB** (mp4 ou mov). O Molde já manda o vídeo do tamanho certo.
- **O botão some quando chega outra mensagem.** Por isso o botão do dia vai sempre na última mensagem do dia, e o «Anotado!» do e-mail volta com o botão.
- **Se a pessoa assistiu ao vídeo** a Meta não informa. O funil conta quem **recebeu** cada dia.
