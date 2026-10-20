# Escada de vendas, obrigado, depoimentos, pré-venda e destino do post

Esta atualização traz, tudo **opcional** e desligado até você criar um produto:

1. **Escada no checkout** (Money Models): produto de entrada → order bump → upsell → downsell → assinatura → página de obrigado, com **prazo real** de desconto e o **valor médio por comprador** no painel.
2. **Página de obrigado** configurável por produto, com o **próximo passo** (oferta, curso por e-mail ou convite) e o **e-mail do comprador guardado na lista própria** do UaiFlow.
3. **Pedido de depoimento automático**: N dias depois (padrão 7), um e-mail com o link de um formulário simples, com a caixa **«autorizo usar»**. As respostas ficam no painel, com botão de copiar e exportar.
4. **Modo pré-venda**: página de uma tela marcada como pré-venda, com o prazo de entrega e a lista de quem comprou para avisar na entrega.
5. **Publicador**: a **foto do feed** também pode sair na **Página do Facebook**, e todo post ganha o campo **«destino»** (quiz, página de venda, isca de e-mail, palavra-chave na DM, só valor) com o link.

O pagamento **continua na sua plataforma** (Stripe, Whop, Gumroad, Payhip ou Cakto, as mesmas das vendas por webhook — [redes-e-vendas.md](redes-e-vendas.md)). O UaiFlow mostra as páginas, decide o próximo passo, conta os eventos e guarda a lista própria.

## 1 · Atualização do banco: 0011

Cole `supabase/migrations/0011_vendas_funil.sql` no editor SQL do Supabase (ou `npm run db:migrate`). Pode ser colada mais de uma vez. Ela cria:

- `produtos`, `funil_sessoes`, `funil_eventos`, `compradores`, `depoimentos` (todas com RLS ligada e sem políticas: só o servidor lê e grava);
- em `content_posts`: `destino_tipo` e `destino_link`.

Sem ela: a tela **Vendas** avisa "Falta colar a atualização 0011", as páginas `/p/...` respondem 404, o relógio segue normal e o post salva sem o destino (com aviso).

A 0010 (vendas por webhook) **não é obrigatória**, mas sem ela o painel só mostra o valor médio **estimado** (pelos aceites), não o **real** (pelas vendas).

## 2 · Endereços de cada produto

Cada produto tem um endereço curto (`slug`). Com `guia-sono`:

| Endereço | Para quê |
| --- | --- |
| `https://SEU-SITE/p/guia-sono` | Página de uma tela: nome, promessa, preço, o que recebe, botão de pagamento (e a caixa do order bump). Em pré-venda, mostra o selo e o prazo de entrega. |
| `https://SEU-SITE/p/guia-sono/oferta?compra=ID-DA-COMPRA` | **Depois do pagamento.** Cole este endereço na plataforma como o link de redirecionamento depois da compra (da entrada **e** de cada degrau da escada). Ele leva ao passo certo: upsell, downsell, assinatura ou obrigado. |
| `https://SEU-SITE/p/guia-sono/obrigado` | Página de obrigado (texto, próximo passo e o formulário do e-mail). |
| `https://SEU-SITE/depoimento/<código>` | Formulário do depoimento (vai no e-mail; cada comprador tem o seu). |

O painel **Vendas** mostra esses links com o botão de copiar.

## 3 · Como a escada funciona

1. A pessoa compra a entrada na plataforma (com ou sem o bump) e volta para `/p/<slug>/oferta`.
2. O UaiFlow abre uma **sessão** para essa compra e mostra o **upsell**. Se o upsell tem prazo (ex.: 15 min), o fim do prazo é gravado **naquele momento** no banco (`funil_sessoes.oferta_expira_em`).
3. «Sim» → o UaiFlow confere o prazo **na hora do clique** e manda para o link de pagamento do upsell. «Não, obrigado» → **downsell** (só para quem recusou o upsell).
4. Depois vem a **assinatura** (se houver) e, por fim, a página de **obrigado**.
5. Cada passo é contado uma vez por sessão: `entrada`, `viu_upsell`, `aceitou_upsell`, `recusou_upsell`, `viu_downsell`, ..., `viu_obrigado`, `email_capturado`, mais os cliques de compra (com e sem bump).

**Valor médio por comprador** (painel, últimos 30 dias):

- **Real**: soma líquida (sem reembolsos e contestações) das vendas por webhook com a referência (`produtoRef`) da entrada e de cada degrau, dividida pelo número de vendas da entrada. Preencha a «Referência da venda» de cada degrau com o mesmo valor que chega no webhook (ex.: `client_reference_id` da Stripe — veja a tabela de referências em [redes-e-vendas.md](redes-e-vendas.md)).
- **Estimado**: preço da entrada + o valor dos «Sim» clicados, dividido pelos compradores que chegaram na oferta. Serve enquanto as vendas por webhook não estão ligadas.

### «Upsell de 1 clique»

Com o checkout na plataforma, o «Sim» é **um clique até o checkout do upsell** (a plataforma pode pedir o cartão de novo, conforme ela guarde ou não o cartão). A cobrança **sem nova tela de pagamento** (cartão salvo, cobrado pelo UaiFlow) exigiria a API da Stripe com a chave secreta e pagamentos "off-session"; isso **não** foi feito (o UaiFlow nunca guarda chave de cobrança).

## 4 · Compliance (EUA)

- **Urgência só real (FTC):** o prazo do desconto é gravado uma vez e **não reinicia**: a mesma compra (o `?compra=` do link de retorno) ou o mesmo navegador (cookie de 30 dias) voltam sempre para a mesma sessão e o mesmo prazo. Depois do prazo, o link com desconto **não é mais entregue** (o servidor confere no clique): aparece o preço cheio (se configurado) ou "A oferta com desconto terminou". O painel recusa "preço cheio" sem prazo (desconto fictício).
  - Para o prazo ficar preso à compra também em outro aparelho, configure o link de retorno com o id da compra. Stripe: `?compra={CHECKOUT_SESSION_ID}`. Outras plataformas: o UaiFlow também lê `session_id`, `order_id`, `sale_id`, `payment_id`, `transaction_id` e `refId`.
- **Assinatura (ROSCA):** a assinatura só salva com o **link de cancelamento** (ex.: portal do cliente da Stripe). Na oferta aparecem, **antes do «Sim»**, o preço por mês, os termos e o link de cancelamento, e o «Sim» só passa com a caixa **«Li os termos e concordo...»** marcada (conferida também no servidor). A página de obrigado repete o link de cancelamento para quem assinou. Na plataforma, ligue o e-mail de confirmação da assinatura com o link de cancelamento.
- **E-mail (CAN-SPAM):** todo e-mail tem o link «Sair da lista» (e o cabeçalho de cancelar inscrição de um clique). Preencha `EMAIL_ENDERECO_POSTAL` com um endereço postal válido. A caixa «Quero receber novidades e ofertas» começa **desmarcada**.
- **Depoimentos:** só os com «autorizo usar» marcado entram no texto para colar no Banco de provas. A data e a hora da autorização ficam guardadas.

## 5 · O que configurar na plataforma

Em todas: o **link de pagamento** de cada degrau (entrada, entrada + bump, upsell com desconto, upsell com preço cheio, downsell, assinatura) e o **redirecionamento depois da compra** para `https://SEU-SITE/p/<slug>/oferta` (com o id da compra, se a plataforma deixar).

| Plataforma | Onde |
| --- | --- |
| **Stripe** (Payment Links) | Em cada Payment Link: "Após o pagamento" → "Não mostrar a página de confirmação" → redirecionar para `https://SEU-SITE/p/<slug>/oferta?compra={CHECKOUT_SESSION_ID}`. **Bump:** crie um Payment Link com os 2 itens (entrada + bump) e cole como "Link de pagamento da entrada + bump". **Assinatura:** Payment Link de preço recorrente; o **link de cancelamento** é o do Portal do cliente (Configurações → Billing → Portal do cliente → link de login). Referência: `?client_reference_id=` no link ou o id do Payment Link. |
| **Whop** | No produto/plano: o endereço de redirecionamento depois do checkout. O order bump pode ser feito na própria Whop; nesse caso deixe o bump do UaiFlow vazio. Cancelamento: o link da área de assinaturas da Whop. |
| **Cakto** | Na oferta: a página de obrigado personalizada → `https://SEU-SITE/p/<slug>/oferta`. A Cakto tem order bump e upsell próprios; use o do UaiFlow **ou** o da Cakto, não os dois no mesmo produto. |
| **Gumroad / Payhip** | Se a plataforma não redirecionar depois da compra, ponha o link `https://SEU-SITE/p/<slug>/oferta` no conteúdo/recibo do produto ("Próximo passo"). |

Teste com o modo de teste da plataforma antes de divulgar.

## 6 · Pedido de depoimento

- Na página de obrigado a pessoa deixa o e-mail (a lista própria, `compradores`). O pedido fica agendado para **N dias** depois (padrão 7; de 1 a 90, por produto; dá para desligar).
- O envio usa o **mesmo relógio de sempre** (`/api/queue/drain`, a cada minuto pelo pg_cron do Supabase — `supabase/cron.sql`). **Nenhum cron novo.** Ele pega até 5 pedidos vencidos por minuto, trava cada um por 10 min (dois relógios nunca mandam o mesmo e-mail) e, se o envio falhar, tenta de novo em 1 h e 6 h; depois desiste (o painel mostra o erro e o link para mandar à mão).
- **E-mail:** pela API do Resend (`RESEND_API_KEY` + `EMAIL_REMETENTE`, com o domínio verificado no Resend). Sem essas variáveis **nada sai sozinho**: na aba «Lista própria» do painel, cada comprador tem o botão «Link do depoimento» para mandar à mão (WhatsApp, DM, e-mail pessoal).
- **DM:** não há ligação entre o e-mail da compra e o contato do Instagram, então o pedido automático não sai por DM.
- O formulário pede: o que funcionou, um depoimento (opcional), um print (opcional, imagem até 4 MB, guardado **privado** no R2 em `uaiflow/depoimentos/`; o painel abre por link de 1 hora), como quer aparecer, e a caixa «Autorizo usar».

| Variável | O que é |
| --- | --- |
| `RESEND_API_KEY` | Chave da API do Resend. É segredo. |
| `EMAIL_REMETENTE` | Quem envia, ex.: `Nicolas <oi@seu-dominio.com>`. |
| `EMAIL_RESPONDER_PARA` | Opcional: para onde vão as respostas. |
| `EMAIL_ENDERECO_POSTAL` | Opcional (recomendado nos EUA): endereço postal no rodapé. |

## 7 · Pré-venda

Marque **Pré-venda** no produto e informe o **prazo de entrega**. A página mostra o selo "Pré-venda", o prazo e o botão «Garantir na pré-venda». Na página de obrigado, o formulário pede o e-mail "para avisar na entrega". No painel: **Lista da pré-venda (CSV)** e **Marcar todos como avisados da entrega**.

## 8 · Importar a escada do Molde

No editor do produto, **Importar a escada da página do Molde (JSON)**. Formato:

```json
{
  "entrada": { "nome": "Planner do Sono", "preco": 17, "promessa": "...", "link": "https://...", "itens": ["PDF", "Áudio"] },
  "meio":    { "nome": "Curso Sono Profundo", "preco": 67, "descricao": "...", "link": "https://..." },
  "topo":    { "nome": "Mentoria", "preco": 497, "texto": "...", "link": "https://..." },
  "obrigado": { "texto": "Bem-vinda!" }
}
```

Mapeamento: **entrada** = o produto; **meio** = upsell depois da compra; **topo** = próximo passo da página de obrigado (convite); **obrigado.texto** = texto do obrigado. Se o JSON trouxer `bump`, `downsell` ou `recorrencia`, eles entram como estão. Nada é salvo até você conferir e tocar em **Salvar** (os links de pagamento que faltarem aparecem como aviso).

## 9 · Publicador: foto na Página do Facebook e destino do post

- **Foto do feed → Página do Facebook:** na tela Conteúdo, num post do tipo **Foto**, marque «Facebook (Página)». Depois que o Instagram termina, o relógio publica a foto na Página (`POST /{page-id}/photos` com a legenda), com a mesma conexão e permissão do Reel na Página (`pages_manage_posts`). Threads e YouTube continuam só para Reel. Se a função cair no meio do envio, a foto **não é reenviada às cegas**: a rede fica "Com erro" pedindo para conferir a Página e tocar em «Tentar de novo».
- **Destino do post:** na tela Conteúdo (e pelo Molde: `destinoTipo` + `destinoLink`, ou `destino: { tipo, link }`): **Quiz**, **Página de venda**, **Isca de e-mail** (pedem o link), **Palavra-chave na DM** (usa o funil do comentário → DM) ou **Só valor** (sem link). O Molde recebe `destino` nas respostas.

### Pinterest (avaliado, não implementado)

A API oficial do Pinterest (v5, `POST /v5/pins`) exige um app com OAuth. Todo app novo começa no acesso **Trial**, em que os Pins criados **não são públicos** (ficam como "Sandbox", visíveis só para quem criou). Para os Pins aparecerem é preciso o acesso **Standard**, pedido em My apps → Upgrade, com um **vídeo mostrando o fluxo OAuth** do app e a política de privacidade, e aprovação do Pinterest. Por isso o conector **não foi feito agora** (publicaria só em sandbox). Caminho quando o app for aprovado:

1. Criar o app em developers.pinterest.com (precisa de conta Business), cadastrar `https://SEU-SITE/api/oauth/pinterest/callback` e pedir os escopos `boards:read`, `pins:read`, `pins:write`.
2. Gravar o vídeo do OAuth e pedir o acesso Standard.
3. No UaiFlow, seguir o mesmo padrão do Threads: `PINTEREST_APP_ID` / `PINTEREST_APP_SECRET` nas variáveis, tabela `pinterest_connections` (token de 30 dias + refresh), escolha do board, e a rede `pinterest` em `content_post_redes` publicando `media_source: { source_type: "image_url", url }` com `link` = o `destino_link` do post (o campo de destino já está pronto para isso).

## 10 · Painel e API

- Tela **Vendas** (menu principal): produtos (criar, editar, apagar, links, métricas), **Lista própria** (CSV, link do depoimento) e **Depoimentos** (copiar autorizados, CSV, ver print).
- API (com sessão do painel): `GET/POST /api/vendas/produtos`, `GET/PATCH/DELETE /api/vendas/produtos/<id>`, `POST /api/vendas/produtos/<id>` `{ "acao": "marcar_avisados" }`, `POST /api/vendas/escada-molde` `{ "json": ... }`, `GET /api/vendas/compradores?produtoId=&prevenda=1&formato=csv`, `GET /api/vendas/depoimentos?produtoId=&autorizados=1&formato=csv|texto`.
