# Atualização do banco: migração 0012 (vendas por post, 10 plataformas novas e a sequência de DM)

Esta atualização acompanha a versão 132 da página do Molde. O arquivo `0012_origem_vendas_e_sequencia_dm.sql` tem tudo junto: **você cola o arquivo inteiro** (pode colar de novo, não apaga nada).

O que muda com ela:

- **Vendas por post:** o link que conta cliques (`/l/…`) passa a levar a pessoa ao checkout com um código curto do post (começa com `mo`). A plataforma devolve esse código no aviso de venda e o Molde mostra **quais Reels vendem**.
- **10 plataformas novas de venda:** Hotmart, Kiwify, Eduzz, Monetizze, Braip, Ticto, Perfect Pay, Digistore24, ClickBank e Lemon Squeezy (Stripe, Whop, Gumroad, Payhip e Cakto continuam como estão). Reembolso e chargeback mudam a mesma venda; venda de teste fica de fora dos números.
- **Clique do story:** o link colado no adesivo do story com `?de=story` passa a contar como "story".
- **Sequência de DM do post:** a 1ª mensagem automática continua sem link. Quando a pessoa responde, o UaiFlow manda a mensagem 2 (o valor), depois o link (passo 3) e, se ela não tocar no link nem responder, um lembrete antes de fechar as 24 horas que o Instagram dá para conversar.

Sobre a migração:

- Não apaga nada: cria uma tabela nova (`dm_sequencias`) e algumas colunas novas (nos links, nos cliques, nas vendas e nas automações).
- Cole a 0006 e a 0010 antes desta (se ainda não colou). Sem elas, a 0012 pula a parte dos links e das vendas sem dar erro; depois de colar a que faltava, cole a 0012 de novo.
- O site continua funcionando mesmo antes dela, **mas sem ela**: as 10 plataformas novas respondem "Falta colar a atualização 0012" (a plataforma tenta de novo mais tarde, nada se perde por umas horas); o link continua levando ao checkout de sempre (sem o código do post); o clique do story conta como "outro"; e a DM do post sai só com a 1ª mensagem.
- Pode ser colada **antes ou depois** de publicar a versão nova do site. De preferência antes.

Leva uns 5 minutos para colar, e mais uns 5 minutos por plataforma de venda que você for usar.

## Passo 1 — colar a 0012 no Supabase

1. Pegue o arquivo do UaiFlow: `supabase/migrations/0012_origem_vendas_e_sequencia_dm.sql` (na pasta do projeto no Mac, ou no GitHub com o botão **Copy raw file**). Não precisa trocar nada nele.
2. Entre em https://supabase.com/dashboard e abra o projeto do UaiFlow.
3. No menu da esquerda, clique em **SQL Editor** e depois em **New query**.
4. Cole o arquivo inteiro e clique em **Run** (ou Cmd+Enter).
   - O que esperar: **Success. No rows returned**.
   - Se colar de novo, pode aparecer "already exists, skipping". Não é erro.
5. **Confira.** Numa **New query**, cole e rode:

   ```sql
   select count(*) from public.dm_sequencias;
   ```

   Deve aparecer **uma linha com o número 0**. Se aparecer `relation "public.dm_sequencias" does not exist`, repita o passo 4.

   E para conferir as vendas (deve aparecer **uma linha** com `origem`; se não aparecer nada, cole a 0010 e depois a 0012 de novo):

   ```sql
   select column_name from information_schema.columns where table_name = 'vendas' and column_name = 'origem';
   ```

## Passo 2 — ligar só as plataformas que você usa

Você **não precisa** configurar todas. Cada plataforma só liga quando o segredo dela está no Netlify; as outras ficam desligadas (respondem "desligada" e nada é gravado).

Para cada plataforma que for usar:

1. Copie o segredo dela (a tabela abaixo diz onde fica).
2. Entre em https://app.netlify.com, abra o site **uaiflow-divinetones** → **Site configuration** → **Environment variables** → **Add a variable** → **Add a single variable**, ponha o **nome** da tabela e cole o segredo como valor. Não mande o segredo para ninguém nem coloque no GitHub.
3. Na plataforma, cadastre o **endereço do aviso de venda** da tabela (webhook / postback / notificação), marcando os eventos de **compra aprovada**, **reembolso** e **chargeback**.
4. Depois de pôr todas as variáveis: **Deploys** → **Trigger deploy** → **Deploy site** (as variáveis só valem depois de publicar de novo).

O endereço do site é `https://uaiflow-divinetones.netlify.app` (se mudar de domínio, troque o começo).

| Plataforma | Nome da variável no Netlify | Onde achar o segredo na plataforma | Endereço para colar na plataforma |
| --- | --- | --- | --- |
| Hotmart | `HOTMART_HOTTOK` | Ferramentas → Webhook (API e notificações) → o **hottok** (token de verificação). Use a versão **2.0.0** do webhook. | `https://uaiflow-divinetones.netlify.app/api/webhooks/hotmart` |
| Kiwify | `KIWIFY_WEBHOOK_TOKEN` | Apps → Webhooks → criar webhook → o **token** que a Kiwify mostra | `https://uaiflow-divinetones.netlify.app/api/webhooks/kiwify` |
| Eduzz | `EDUZZ_WEBHOOK_SECRET` | Console da Eduzz (developers) → Webhooks → o **segredo** da assinatura | `https://uaiflow-divinetones.netlify.app/api/webhooks/eduzz` |
| Monetizze | `MONETIZZE_CHAVE_UNICA` | Ferramentas → Postback → a **chave única** | `https://uaiflow-divinetones.netlify.app/api/webhooks/monetizze` |
| Braip | `BRAIP_AUTH_KEY` | Ferramentas → Postback → a **chave única de autenticação** | `https://uaiflow-divinetones.netlify.app/api/webhooks/braip` |
| Ticto | `TICTO_WEBHOOK_TOKEN` | Produto → Postback / Webhook → o **token** | `https://uaiflow-divinetones.netlify.app/api/webhooks/ticto` |
| Perfect Pay | `PERFECTPAY_WEBHOOK_TOKEN` | Ferramentas → Webhook → o **token** | `https://uaiflow-divinetones.netlify.app/api/webhooks/perfectpay` |
| Digistore24 | `DIGISTORE24_IPN_PASSPHRASE` | Settings → Integrations (IPN) → nova conexão "Generic" → a **senha (passphrase)** que você cria lá | `https://uaiflow-divinetones.netlify.app/api/webhooks/digistore24` |
| ClickBank | `CLICKBANK_SECRET_KEY` | Vendor Settings → My Site → **Secret Key** (até 16 letras maiúsculas e números) | Em **Instant Notification URL**, versão 6.0 ou mais nova: `https://uaiflow-divinetones.netlify.app/api/webhooks/clickbank` |
| Lemon Squeezy | `LEMONSQUEEZY_WEBHOOK_SECRET` | Settings → Webhooks → criar → o **Signing secret** que você escolhe (eventos `order_created` e `order_refunded`) | `https://uaiflow-divinetones.netlify.app/api/webhooks/lemonsqueezy` |

Para conferir, use o botão de **enviar teste** do webhook de cada plataforma. A venda de teste não entra nos números do Molde; se a plataforma responder **erro 401**, o segredo no Netlify não é o mesmo da plataforma (copie de novo, sem espaço no começo nem no fim, e publique de novo). Rodar `npm run setup:check` também avisa segredo com espaço ou curto demais.

## Passo 3 — publicar a página do Molde v132

A página precisa mandar a sequência de DM (mensagem 2, link e lembrete) junto com o post. Isso vem na versão 132 da página (veja `docs/MOLDE_V132_PAGINA.md`). Os posts publicados antes continuam com a 1ª mensagem só, como hoje.

## A conferir com um aviso real («conferir com um webhook real»)

O formato dos avisos foi escrito pela documentação pública de cada plataforma, sem um aviso de verdade em mãos. Assim que a primeira venda (ou o primeiro teste) de cada plataforma chegar, vale conferir estes pontos. Se algo estiver diferente, a venda **não se perde**: o aviso responde erro e a plataforma tenta de novo depois, então dá tempo de corrigir.

| Plataforma | O que conferir |
| --- | --- |
| Hotmart | Se o valor certo é `full_price` (com juros do parcelamento) ou `price`; se existe um campo que marca a venda de teste. |
| Kiwify | O nome do parâmetro `signature` no endereço e o cálculo (HMAC-SHA1 do corpo); se `Commissions.charge_amount` vem em centavos; o campo de teste. |
| Eduzz | O nome do cabeçalho `x-signature` e o cálculo (HMAC-SHA256); os nomes dos eventos (`myeduzz.invoice_paid`, `…_refunded`, `…_chargeback`); onde vêm o valor (`paid`/`price`) e a origem (`utm.content`). O postback antigo da Eduzz (`trans_cod`, `api_key`) **não** é lido. |
| Monetizze | O código de `tipoPostback` do chargeback; se a origem volta em `venda.src` ou `venda.utm_content`. |
| Braip | Se `trans_total_value` vem em centavos; onde volta a origem (`src` / `utm_content`). |
| Ticto | Se `order.paid_amount` vem em centavos; o id do pedido (`order.hash`); onde voltam os parâmetros do link (`query_params` / `tracking`). |
| Perfect Pay | Os números de `sale_status_enum` (2 aprovada, 7 devolvida, 9 chargeback, 10 completa); se `sale_amount` vem em reais; a origem em `metadata.src`. |
| Digistore24 | O cálculo do `sha_sign` (SHA-512 dos campos em ordem alfabética com a senha); o campo de teste; se o valor certo é `amount` ou `transaction_amount`. |
| ClickBank | Se o `tid` volta em `trackingCodes` (versão 8) ou em `vendorVariables.tid_` (versões antigas). |
| Lemon Squeezy | Se existe um evento de chargeback (hoje só a venda e o reembolso são lidos). |

Em todas, o código do post (`mo…`) também é procurado em qualquer campo de rastreio do aviso (`src`, `sck`, `utm_content`, `custom`, `tid`…), então um nome de campo diferente do esperado não perde a venda do post.
