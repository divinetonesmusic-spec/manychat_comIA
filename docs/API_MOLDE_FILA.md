# API da fila única do Molde (`/api/molde/fila`, migração 0016)

Para quem for fazer a **página do Molde**, o **orquestrador** (próxima rodada) e o **MCP** (depois). Precisa da migração 0016 (`docs/ATUALIZACAO_0016.md`). Molde v134, etapas N1 · Fila única e F-MCP parte 1.

## A ideia

- **A página continua dona do pedido.** O conteúdo (o `pedidos/<id>` do banco do Artifact, as fotos, os vídeos) fica na página. Aqui fica o **espelho**: uma linha por pedido pago ou demorado, com o estado, o custo estimado, o projeto e o avatar, a prévia e a chave do núcleo da página (`Nucleo.pedido`, v132n).
- O espelho serve ao **Telegram** (aprovar e pedir), ao painel **Fila** da página e ao **orquestrador**.
- A fila do Mac (`/api/molde/jobs`, 0008) continua separada: ela é o que o robô do Mac pega para fazer. A fila única só espelha e decide; ela nunca é pega por um robô.

## Regras gerais

- Tudo em JSON, com `x-molde-token: <MOLDE_API_TOKEN>` (a página manda pelo robô do Mac, `uaiflow {op:'chamar'}`). Sem o token: `401 token_invalido`.
- Sem a 0016: `503 {"error":"Falta colar a atualização 0016 no Supabase (veja docs/ATUALIZACAO_0016.md).","codigo":"falta_0016"}`. A página guarda o espelho e manda depois.
- Erros: `{"error": "<frase em português>"}` (400 pedido errado, 404 não achou, 409 estado errado para a ação, 500 passageiro).

## Estados

```
(Telegram) rascunho ──2º toque «Confirmar · US$ X»──> na_fila ──a página cria o pedido──> produzindo ──> para_aprovar
                    └─«Cancelar» / 30 min──> cancelado                                                    │  │
                                                                               «Aprovar» (Telegram ou página)  │  └─«Refazer» + motivo──> refazer
                                                                                                    aprovado <─┘
na_fila · produzindo · para_aprovar · aprovado · refazer · pronto · erro · cancelado  (o que a página manda)
```

- `rascunho` só existe para os pedidos do Telegram antes do 2º toque. A página nunca vê nem muda um rascunho.
- **Rodada:** cada vez que um item entra em `para_aprovar` (ou troca a prévia nele) a rodada sobe 1 e a mensagem do Telegram sai de novo. Os botões levam a rodada: o botão de uma prévia antiga não decide a nova.
- **Decisão pendente:** a decisão (aprovar/refazer) fica `decisaoPendente: true` até a página dizer que aplicou (`aplicada`). Enquanto isso, um espelho atrasado que ainda diz `para_aprovar` com a mesma prévia **não** desfaz a decisão.

## O item (`data[]`)

```json
{
  "id": "2b6c0d6e-…", "ref": "pedido:pab12", "origem": "pagina", "pedidoId": "pab12", "chave": "k0123456789abcdef",
  "projeto": "birdie", "avatar": "Birdie", "tipo": "fotos", "titulo": "Fotos do ensaio",
  "estado": "para_aprovar", "etapa": null, "nota": null, "custoEstimadoUsd": 0.12,
  "previa": { "imagem": "https://…", "texto": "3 fotos" },
  "pedido": {},
  "rodada": 1, "decisao": null, "decisoes": [], "decisaoPendente": false, "esperaMotivo": false,
  "confirmadoEm": "…", "confirmadoVia": "pagina", "criadoEm": "…", "atualizadoEm": "…"
}
```

- `ref`: quem é na página. `pedido:<id do pedidos/<id>>`, `heygen:<video_id>`, `voz:<id do lançamento da carteira>`, `telegram:<uuid>` (o pedido do Telegram), `outro:<…>`.
- `pedido` (só `origem: "telegram"`): `{ "comando": "reel" | "fotos", "texto": "<o tema ou a descrição>", "n": 2, "opcoes": ["birdie","dell"] }`.
- `decisao`: `{ "decisao": "aprovar" | "refazer", "nota": "Mais luz no rosto" | null, "via": "telegram" | "pagina", "por": "@nicolas", "em": "<ISO>", "rodada": 1 }`.

## Rotas

### Espelhar — `POST /api/molde/fila`

```json
{
  "itens": [
    { "ref": "pedido:pab12", "pedidoId": "pab12", "chave": "k…", "projeto": "birdie", "avatar": "Birdie", "tipo": "fotos",
      "titulo": "Fotos do ensaio", "estado": "produzindo", "custoEstimadoUsd": 0.12, "etapa": null, "nota": null, "previa": null },
    { "id": "<uuid do pedido do Telegram>", "ref": "pedido:pxyz", "pedidoId": "pxyz", "tipo": "fotos", "estado": "produzindo", "…": "…" }
  ],
  "avatares": [ { "projeto": "birdie", "nome": "Birdie", "conta": "birdie.lanier" } ],
  "precos": { "foto": 0.04, "reel": 1.2 }
}
```

- Até 50 itens por vez. Obrigatórios: `ref`, `tipo` (minúsculas, números e `_`), `estado` (um dos 8 da página).
- Acha a linha por `id` (o do pedido do Telegram, que a página guarda no pedido dela), depois pelo `pedidoId`, depois pela `ref`. Não achou: cria (`origem: "pagina"`).
- `avatares` (opcional, até 20): a lista inteira dos projetos; quem saiu da lista sai dos botões do Telegram. `precos`: US$ por foto e para produzir um Reel (o custo dos pedidos do Telegram).
- Resposta: `200 {"data": [{"id","ref","estado","rodada","criado","mudou","avisar","decisaoPendente"} | {"erro","ref"}], "telegram": <quantas aprovações saíram agora>}`. As aprovações que não couberem saem pelo relógio no minuto seguinte (as funções do Netlify param em ~10 s).

### Listar — `GET /api/molde/fila?projeto=&estado=&origem=&semPedido=1&decisoes=pendentes&limite=`

- `estado`: um ou vários, separados por vírgula. `origem`: `pagina` ou `telegram`. `limite`: 1–200 (padrão 100). Os rascunhos nunca saem.
- **Os pedidos do Telegram para a página fazer:** `?origem=telegram&estado=na_fila&semPedido=1`.
- **As decisões para a página aplicar:** `?decisoes=pendentes`.
- Resposta: `{"data": [<item>], "contagem": {"birdie": {"avatar": "Birdie", "estados": {"produzindo": 1, "para_aprovar": 2}}}, "avatares": [{projeto, nome, conta}]}` (a contagem é dos últimos 30 dias).

### Ações — `POST /api/molde/fila/<id>/<acao>`

| ação | corpo | o que faz | erro |
|---|---|---|---|
| `decidir` | `{"decisao":"aprovar"\|"refazer", "nota"?, "por"?, "rodada"?}` | a decisão pela página (a mensagem do Telegram passa a mostrar). `refazer` precisa da `nota`. | 400 sem nota; 409 já decidido, prévia antiga, não espera aprovação |
| `aplicada` | `{"rodada": 1}` | a página aplicou a decisão daquela rodada no pedido dela | 409 rodada errada |
| `cancelar` | `{"nota"?}` | `cancelado` (ex.: o pedido do Telegram passou do limite do mês e o dono disse «Cancelar» na página) | — |

## O Telegram (`/api/telegram/webhook`)

- **Aprovar:** item em `para_aprovar` → mensagem com a prévia e **Aprovar** / **Refazer** (botões assinados, `f.a`/`f.r` + a rodada). **Refazer** pergunta o motivo; a próxima mensagem de texto da conversa (em até 15 min) vira a `nota` e decide. `/cancelar` larga a espera.
- **Pedir:** `/reel <tema>` (ou `/novo reel <tema>`), `/fotos [1–4] <descrição>`. Com vários avatares, botões de cada um (`f.v` + o índice). Depois, o custo e **Confirmar · US$ X** (`f.c`) / **Cancelar** (`f.x`). Só o 2º toque põe na fila. O rascunho vale 30 min.
- `/status` (a fila por avatar), `/ajuda`.
- **Só a conversa `TELEGRAM_CHAT_ID`** (e, com `TELEGRAM_ALLOWED_USER_IDS`, só essas pessoas). Mensagem de outra conversa: ignorada, sem resposta.
- O webhook precisa receber mensagens: o botão «Ligar os botões do Telegram» registra `allowed_updates: ["callback_query", "message"]` (toque de novo depois de publicar).

## O que a página faz (Molde v134, `molde/v134f_fila.js`)

1. **Espelhar:** todo pedido que nasce pelo núcleo (`Nucleo.pedido`: `enviarPedido`, `flowPedirNoMac`, a cópia dos áudios) e cada mudança que chega pelo snapshot dos pedidos; o HeyGen (`create_video_*`) e a voz (ElevenLabs) pelo ouvinte das chamadas pagas. Vai em lote pelo robô do Mac (sem pedir toque); se o UaiFlow ou o Mac não responderem, fica guardado no banco da página (`fila134/saida`) e vai depois.
2. **Ao abrir e ao atualizar:** lê `?decisoes=pendentes` e aplica com a regra da Caixa de aprovações (fotos: aprovar = aprovada; refazer = reprovada com o motivo; os outros: o pedido mostra o ajuste e o botão de refazer de sempre, que pergunta o custo), depois `aplicada`.
3. **Pedidos do Telegram:** lê `?origem=telegram&estado=na_fila&semPedido=1`; para o projeto aberto, faz o pedido como se o dono tivesse clicado (a confirmação já foi dada no Telegram), respeitando o limite do mês da carteira (passou: pergunta na página; «Cancelar» → `cancelar`). Os de outro avatar esperam ele abrir.

## Para o orquestrador e o Claude (v135, migração 0019)

O orquestrador usa esta mesma rota, com o contrato dele: **`docs/API_MOLDE_ORQUESTRADOR.md`** (criar com chave idempotente, `pegar`
com prazo, `passo`, `aprovacao` com os achados do revisor, `decisao`, `resultado`, `erro`, `soltar`, a `versao` com 409). O que muda
para a página (nada quebra):

- Cada item que a página recebe ganha `estadoOrquestrador` (e, com a 0019, `versao` e `estacao`). Os itens do orquestrador (com
  `estacao`) podem aparecer na lista; o estado `na_revisao` deles aparece como `produzindo`, e `?estado=produzindo` inclui os dois.
- `?decisoes=pendentes` **não** traz as decisões dos itens do orquestrador (quem aplica é ele).
- `decidir` aceita também as decisões novas (`corrigir`, `publicar`, `gravar`, `nao-gravar`, `completar`, `cancelar`) quando o item
  as oferece; nos espelhos da página continuam só `aprovar` e `refazer`.
- O espelho não muda um item do orquestrador (`{erro: "Este item é do orquestrador…"}`).
- O `/status` do Telegram mostra o gasto do mês contra o limite (`MOLDE_TETO_USD`).
- O Claude (conector MCP, `docs/MOLDE_MCP.md`) pede e decide pelas mesmas funções do Telegram. Os pedidos dele chegam como os do
  Telegram (`origem: "telegram"`, `confirmadoVia: "mcp"`): a página pega com o mesmo `?origem=telegram&estado=na_fila&semPedido=1`.
