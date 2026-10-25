# Atualização do banco: migração 0018 (o app por assinatura)

Esta atualização acompanha a versão 134 da página do Molde. O arquivo `0018_app_assinatura.sql` tem tudo junto: **você cola o arquivo inteiro** (pode colar de novo, não apaga nada).

## O que muda com ela

- **O app por assinatura** (`https://SEU-SITE/a/<nome-do-app>`): um produto pronto vira um app de 1 toque no celular. A pessoa toca o áudio da noite, vê «Noite 4 de 30» e quantos dias seguidos fez, e pode pedir um lembrete diário por e-mail. Ela põe o app na tela do celular («Adicionar à tela de início») e ele toca mesmo sem internet.
- **Quem assina entra sem senha:** digita o e-mail da compra e recebe um link e um código de 6 números. Quem não tem a assinatura vê o convite com o preço por mês e o botão «Assinar».
- **A assinatura vem da sua plataforma de pagamento** (Hotmart, Kiwify ou Stripe): a venda aprovada libera o acesso pelo e-mail da compra; a renovação mantém; cancelamento, atraso, reembolso ou chargeback tiram o acesso depois de 3 dias (a carência).
- **Os áudios ficam guardados no seu armazenamento (R2), sem ficar públicos:** só quem tem a assinatura ativa consegue baixar.
- **Os números do teste de 60 dias** aparecem na página do Molde: assinantes ativos, cancelamentos, quantos ficaram no 2º mês, o uso de cada dia e a receita do mês.

Sobre a migração:

- Não apaga nada: cria tabelas novas (`apps`, `app_assinantes`, `app_pagamentos`, `app_acessos`, `app_uso`).
- Não precisa de outra antes (só as que você já colou).
- O site continua funcionando sem ela: `/a/` diz «página não encontrada», o Molde mostra «Falta colar a atualização 0018» e as vendas continuam chegando como antes.
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 10 minutos (o passo 3 é na sua plataforma de pagamento).

## Passo 1 — colar a 0018 no Supabase

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0018_app_assinatura.sql` (no GitHub, abra o arquivo e use o botão **Copy raw file**). Não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
4. Cole o arquivo inteiro e clique em **Run** (ou Cmd+Enter).
   - O que esperar: **Success. No rows returned**.
   - Se colar de novo, pode aparecer "already exists, skipping". Não é erro.
5. **Confira.** Numa **New query**, cole e rode:

   ```sql
   select count(*) from public.app_assinantes;
   ```

   Deve aparecer **uma linha com o número 0**. Se aparecer `relation "public.app_assinantes" does not exist`, repita o passo 4.

## Passo 2 — o envio de e-mail (obrigatório para o app)

O link de entrar e o lembrete vão por e-mail, pelo Resend (o mesmo do pedido de depoimento — veja `docs/vendas-escada.md`). Sem ele, ninguém consegue entrar no app.

1. https://app.netlify.com → o site **uaiflow-divinetones** → **Site configuration** → **Environment variables**.
2. Confira que existem `RESEND_API_KEY` e `EMAIL_REMETENTE` (ex.: `Lua <oi@seu-dominio.com>`, com o domínio verificado no Resend). Se o app for para os EUA, preencha também `EMAIL_ENDERECO_POSTAL` (um endereço postal no rodapé do lembrete).
3. Se mudou alguma coisa: **Deploys** → **Trigger deploy** → **Deploy site**.

Confira também, no Cloudflare R2, em *Settings → CORS policy* do balde, que o endereço do UaiFlow está com `GET` (é o mesmo passo do planner: `docs/PLANNER_E_MOLDE.md`). O celular baixa o áudio direto do R2 para guardar.

## Passo 3 — o produto de assinatura na sua plataforma

Primeiro publique o app pela página do Molde (Loja › «Transformar em app por assinatura» › «Publicar o app no UaiFlow»): ela mostra o link do app e o passo a passo da plataforma escolhida. Em resumo:

- **Hotmart:** cadastre um produto do tipo **Assinatura**, plano **mensal** com o preço que a página propôs; na entrega, **link externo** = o link do app; em **Ferramentas → Webhook**, o endereço `https://SEU-SITE/api/webhooks/hotmart` (versão 2.0.0) com os eventos de compra, atraso, reembolso, chargeback e **cancelamento de assinatura**.
- **Kiwify:** produto de **Assinatura** mensal; entrega por **link externo** = o link do app; em **Apps → Webhooks**, `https://SEU-SITE/api/webhooks/kiwify` com compra aprovada, reembolso, chargeback e **assinatura renovada, atrasada e cancelada**.
- **Stripe:** produto com **preço recorrente mensal**, um **Payment Link** que, depois do pagamento, leva ao link do app; ligue o **Portal do cliente** (a pessoa cancela sozinha); em **Webhooks**, `https://SEU-SITE/api/webhooks/stripe` com `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed` e `customer.subscription.deleted`.

Depois, volte à página do Molde e cole **o link de pagamento** e **o código do produto** (o número do produto na Hotmart, o ID na Kiwify ou o `plink_…` da Stripe) e toque em **«Salvar o produto no app»**. É pelo código do produto que a venda acha o app; pela e-mail da compra, a pessoa.

Os segredos dos avisos de venda são os mesmos que você já usa (`HOTMART_HOTTOK`, `KIWIFY_WEBHOOK_TOKEN`, `STRIPE_WEBHOOK_SECRET` — `docs/ATUALIZACAO_0012.md`).

## Passo 4 — publicar a página do Molde v134

O botão «Transformar em app por assinatura» vem na versão 134 da página do Molde. Os áudios saem pela voz do avatar (a Oficina de áudio, pelo robô do Mac) ou de um arquivo que você já tem, e o robô manda cada um para o R2 (o mesmo de sempre, nada a instalar).

## Bom saber

- **No iPhone**, o aviso no celular só funciona com o app na tela de início; por isso o lembrete principal é o **e-mail**. O app explica o «Adicionar à Tela de Início» em português ou inglês, conforme o avatar.
- **No iPhone, o app da tela de início não enxerga o login do Safari:** a pessoa entra de novo lá dentro com o **código de 6 números** do e-mail (o link do e-mail abre no Safari).
- O e-mail do comprador só fica guardado para quem compra o app (é o que dá o acesso). Os avisos de venda continuam sem dado pessoal.
- **Teste de 60 dias:** a página do Molde mostra, aos 60 dias, o cartão «Decidir: loja de apps?» com o critério (retenção no 2º mês de 50% ou mais com 20+ pessoas; receita mensal de US$ 500 ou R$ 2.500; 40% dos ativos usando 4 dias ou mais na semana).
- Plataformas sem aviso de cancelamento (as outras 12): o acesso vence sozinho 31 dias depois do último pagamento, mais a carência.
