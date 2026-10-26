# API do orquestrador do Molde na fila única (`/api/molde/fila`, migração 0019)

O contrato **final** entre o «Orquestrador do Molde» (a tarefa agendada do Claude, `plugin-molde/ORQUESTRADOR.md` no repositório
`molde-do-avatar`) e a fila única do UaiFlow. Molde v135 (2-NUCLEO parte 4 e F-MCP parte 2). Precisa da 0016 e da 0019
(`docs/ATUALIZACAO_0019.md`). A parte da página e do Telegram da v134 continua em `docs/API_MOLDE_FILA.md` e não mudou.

Este contrato é um **superconjunto** do `ORQUESTRADOR.md`: tudo o que ele pede existe com o mesmo nome; o que é diferente ou a mais
está listado logo abaixo.

## As diferenças do `ORQUESTRADOR.md` (leia antes de escrever o orquestrador ou a página)

| # | `ORQUESTRADOR.md` diz | Aqui é | Por quê |
|---|---|---|---|
| 1 | `id: "f_…"` | `id` é um **uuid** (`2b6c0d6e-…`) | a fila da 0016 já usa uuid (o Telegram e a página guardam) |
| 2 | erro = `{erro: {codigo, mensagem}}` | `{erro: {codigo, mensagem}, error: mensagem}` e, nos 409/400 de um item, também `item` (o item atual) | `error` é o formato das outras rotas do Molde; o `item` no 409 poupa uma leitura |
| 3 | `GET /api/molde/fila?estado=…` devolve «os itens que o orquestrador pode pegar» | devolve `{itens}` **só dos itens do orquestrador** (os que têm `estacao`), os mais velhos primeiro; `?todos=1` traz também os espelhos da página e os pedidos do Telegram. Filtros a mais: `projeto`, `avatar`, `estacao`; `limite` 1–200 (padrão 50) | os espelhos da página (fotos, HeyGen, voz…) são feitos pela página, nunca pelo orquestrador |
| 4 | — | o **formato** da resposta do `GET` depende de quem pede: o token do orquestrador, `?formato=orquestrador` ou um estado do vocabulário do orquestrador (`novo`, `na-estacao`, `esperando-dono`…) → `{itens}`; senão, o formato da página (`{data, contagem, avatares}`). `?formato=pagina` força o da página | a mesma rota serve a página (v134) e o orquestrador |
| 5 | criar: `{projeto, estacao, tipo, detalhes, entrada, chave, origem}` | o mesmo, e mais `titulo`, `avatar`, `conta`, `custoEstimadoUsd` (opcionais). `estacao` é obrigatória (`molde-<nome>`); `chave` é opcional (sem ela, a fila faz uma: `k` + 16 letras do projeto, da estação, do tipo e dos detalhes) | sem `estacao` (e com `itens`) a rota é o espelho da página |
| 6 | criar devolve o item (e `{item, reaproveitado: true}` com a chave repetida) | novo → **201** `{item, reaproveitado: false}`; repetido → **200** `{item, reaproveitado: true}`. A chave só reaproveita **itens do orquestrador** vivos (não `pronto`, não `cancelado`) criados nas últimas 2 h; dois `POST` ao mesmo tempo com a mesma chave criam um só | o espelho da página tem a chave do `Nucleo.pedido`, mas é outra coisa (a página faz) |
| 7 | `tipo` = uma lista fixa | qualquer `tipo` em minúsculas, números e `_` (2 a 40) | a lista do `ORQUESTRADOR.md` cabe; uma estação nova não precisa de mudança aqui |
| 8 | estado `na-revisao` (sem dizer como entra) | o `passo` com `estacao: "molde-revisor"` deixa o item `na-revisao`; qualquer outro passo, `na-estacao` | |
| 9 | `aprovacao`: `{versao, motivo, pergunta, opcoes, custo, resumo}`; «os achados» sem campo | e mais **`achados`** (`[{lugar, trecho, porque, troca, nivel?}]`, até 30; aceita também `revisor.achados`) e `previa` (`{texto?, imagem?, video?, audio?, link?}`, links https). `motivo` também aceita **`pecas`** («Muda uma peça») | o Telegram mostra cada achado na hora (decisão do Nicolas de 25/10) |
| 10 | `opcoes` livres | `opcoes` são decisões: `aprovar`, `refazer`, `corrigir`, `publicar` («Publicar mesmo assim»), `gravar`, `nao-gravar`, `completar`, `cancelar` (aceita os rótulos: «Publicar mesmo assim», «Não gravar»…). Com `motivo: "revisor"`, **`corrigir`, `refazer` e `publicar` entram sempre**; `cancelar` entra sempre em todos. Sem `opcoes`, as do motivo (tabela abaixo) | decisão 21: «Publicar mesmo assim» sempre do dono |
| 11 | `decisao`: `{versao, decisao, nota}` → `aprovado`, `refazer` ou `cancelado` | o mesmo; `versao` é **opcional** aqui (a página nem sempre tem); `rodada` opcional; `por` opcional. `refazer` precisa da `nota` (400 `sem_motivo`); decisão fora das opções → 400 `opcao`; segunda decisão → 409 `ja_decidido` | a mesma regra do Telegram e do MCP |
| 12 | «Aprovar o gasto (2º toque)» | o pedido de aprovação **é** o 1º passo (a mensagem mostra o custo e o gasto do mês); o botão **«Aprovar o gasto · US$ X»** é o 2º. Só depois dele o custo entra no gasto do mês | o mesmo modelo do «Confirmar · US$ X» dos pedidos do Telegram |
| 13 | «Completar agora (abre a página)» | o Telegram **não** tem esse botão (só o texto «Abra a página do Molde para completar» e «Cancelar»); a página decide `completar` pela rota `decisao` | um botão do Telegram não abre a página do Claude |
| 14 | `erro`: «volta a `novo`, com `tentativas`+1, no máximo 2» | `tentarDeNovo: true` e `tentativas < 2` → `novo`; senão `erro`. **Todo** `erro` soma 1 em `tentativas`. O `erro` final manda um aviso no Telegram. A resposta traz `tentaDeNovo` | |
| 15 | — | rota a mais: **`soltar`** `{versao, nota?}` devolve o item ao estado de quando foi pego, **sem** contar tentativa (ex.: «Esperando o Mac ligar») | o `ORQUESTRADOR.md` pede «fica `novo` com "Esperando o Mac ligar", sem marcar erro» |
| 16 | `pegar` em `novo, aprovado, refazer` | também num item `na-estacao`/`na-revisao` cujo prazo venceu; o mesmo `quem` com o prazo vivo **renova**. `quem` padrão `orquestrador`; `prazoSeg` 60–3600 (padrão 900). Pegar um item decidido conta a decisão como aplicada | |
| 17 | o prazo «vence sozinho» | vence sem relógio: depois do `pegoAte`, o item **aparece** no estado de quando foi pego (`novo`, `aprovado` ou `refazer`), com `prazoVencido: true`, `pegoPor: null`, e pode ser pego de novo. Quem caiu e volta recebe 409 `versao` | |
| 18 | «acordada pelo UaiFlow quando entra item novo» | **não feito**: o UaiFlow não acorda a tarefa (o orquestrador lê a cada 15 min) | não há como o servidor disparar uma tarefa agendada do Claude sem servidor novo |
| 19 | o token «da conta» via `uaiChamar` | `x-molde-token: <token>` ou `Authorization: Bearer <token>`, com o `MOLDE_API_TOKEN` (o mesmo da página e do robô do Mac) **ou** o `MOLDE_ORQUESTRADOR_TOKEN` (opcional; só abre a fila; com ele as respostas já vêm no formato do orquestrador) | um token só para a fila, que pode ir nos segredos da tarefa |
| 20 | a página e o Telegram decidem | e o Claude (o conector MCP, `docs/MOLDE_MCP.md`, ferramenta `decidir`). `via` na decisão: `telegram`, `pagina` ou `mcp` | F-MCP parte 2 |
| 21 | — | a página (`?decisoes=pendentes`) **não** recebe as decisões dos itens do orquestrador: quem aplica é o orquestrador (ao pegar o item de novo) | um só aplicador por item |

## Regras gerais

- JSON. Token: `x-molde-token` ou `Authorization: Bearer` com `MOLDE_API_TOKEN` ou `MOLDE_ORQUESTRADOR_TOKEN`.
- Toda escrita do orquestrador manda a **`versao`** que leu. A versão sobe a cada mudança do item (um gatilho do banco; o número
  da mensagem do Telegram e a hora do aviso não contam). Outra escrita no meio → **409 `versao`** com o `item` atual: releia e decida de novo.
- Erros: `{"erro": {"codigo": "…", "mensagem": "<frase em português>"}, "error": "<a mesma frase>", "item"?: <item>}`.

| status | `codigo` | quando |
|---|---|---|
| 400 | `pedido_invalido` | corpo errado (a frase diz o campo); `versao` faltando |
| 400 | `sem_motivo` | `refazer` sem `nota` |
| 400 | `opcao` | decisão fora das opções do item |
| 401 | `token_invalido` | token errado (aqui também vem `codigo` no topo, como nas outras rotas) |
| 404 | `nao_achou` | o item não existe (ou é um rascunho do Telegram) |
| 409 | `versao` | a versão mandada não é a atual |
| 409 | `pego` | outro `quem` está com o item e o prazo não venceu |
| 409 | `estado` | o item não está no estado certo para a ação (ex.: `passo` sem `pegar`; `erro` de item pronto) |
| 409 | `pagina` | o item é um espelho da página (sem `estacao`): o orquestrador não mexe |
| 409 | `ja_decidido` / `rodada` | a decisão desta rodada já foi dada / a rodada mandada é velha |
| 503 | `falta_0016` / `falta_0019` | a migração não foi colada |
| 503 | `fechado` | o servidor está sem `MOLDE_API_TOKEN` |
| 500 | `passageiro` | tente de novo |

## Os estados

O banco guarda um estado só; cada lado vê no seu vocabulário. O item do orquestrador traz os dois (`estado` e `estadoPagina`); o da
página traz `estado` e `estadoOrquestrador`.

| orquestrador (`estado`) | página (`estadoPagina`, `API_MOLDE_FILA.md`) | banco | quando |
|---|---|---|---|
| `novo` | `na_fila` | `na_fila` | criado; voltou do `erro` com `tentarDeNovo`; `soltar`; prazo vencido de um item pego em `novo` |
| `na-estacao` | `produzindo` | `produzindo` | `pegar`; `passo` de uma estação |
| `na-revisao` | `produzindo` | `na_revisao` | `passo` do `molde-revisor` |
| `esperando-dono` | `para_aprovar` | `para_aprovar` | `aprovacao` (rodada + 1, mensagem no Telegram) |
| `aprovado` | `aprovado` | `aprovado` | decisão `aprovar`, `corrigir`, `publicar`, `gravar` ou `completar` |
| `refazer` | `refazer` | `refazer` | decisão `refazer` (com a nota) |
| `pronto` | `pronto` | `pronto` | `resultado` |
| `erro` | `erro` | `erro` | `erro` final |
| `cancelado` | `cancelado` | `cancelado` | decisão `cancelar` ou `nao-gravar`; `POST …/cancelar` da página |
| — | — | `rascunho` | pedido do Telegram/MCP antes do 2º passo: nunca aparece para o orquestrador nem para a página |

```
criar ─> novo ──pegar──> na-estacao ──passo(revisor)──> na-revisao
           ^                │   ^                           │
           │   (prazo vence)│   └──────passo(estação)───────┘
           ├────────────────┤
           │                ├──aprovacao──> esperando-dono ──decisão do dono──> aprovado | refazer | cancelado
           │                │                                                      │
           │                │                      pegar (de novo, vê a decisão) <──┘
           │                ├──resultado──> pronto
           └─erro(tentarDeNovo, <2)─┤
                            ├──erro──> erro
                            └──soltar──> (o estado de quando pegou)
```

## O item

```json
{
  "id": "2b6c0d6e-8a51-4c41-9a39-7c1d1c1b0f10", "chave": "k0123456789abcdef", "versao": 7,
  "projeto": "birdie", "conta": null, "avatar": "Birdie",
  "estacao": "molde-roteirista", "tipo": "legenda", "titulo": "Legenda do Reel da oração",
  "estado": "esperando-dono", "estadoPagina": "para_aprovar",
  "origem": "pagina", "ref": "orq:…", "pedidoId": null,
  "detalhes": {},
  "entrada": {"pecas": {}, "pecasMarcas": {"ficha": "h…"}, "projeto": {"mercado": "EUA", "idioma": "en-US", "moeda": "US$", "garantiaDias": 7}},
  "passos": [{"estacao": "molde-roteirista", "em": "…", "saida": {}}, {"estacao": "molde-revisor", "em": "…", "saida": {}}],
  "aprovacao": {"necessaria": true, "motivo": "revisor", "pergunta": "", "opcoes": ["corrigir", "refazer", "publicar", "cancelar"],
                "achados": [{"lugar": "legenda, linha 2", "trecho": "cura a ansiedade", "porque": "promessa de saúde", "troca": "ajuda a acalmar a noite"}],
                "custo": null, "resumo": "", "canais": ["telegram", "pagina"], "pedidaEm": "…",
                "decisao": null, "decididaEm": null, "nota": "", "via": null, "por": null},
  "resultado": null,
  "previa": null, "custoEstimadoUsd": 0, "rodada": 1, "decisao": null,
  "tentativas": 0, "pegoPor": null, "pegoAte": null, "prazoVencido": false, "erro": null,
  "etapa": "Esperando o dono", "nota": null,
  "criadoEm": "…", "atualizadoEm": "…"
}
```

- `aprovacao.decisao` / `decididaEm` / `nota` / `via` (`telegram` | `pagina` | `mcp`) / `por`: preenchidos pela decisão do dono.
  `decisao` (no topo) é o mesmo registro no formato da v134 (`{decisao, nota, via, por, em, rodada}`).
- `resultado`: `{saida, pecasParaGravar}` depois do `resultado`.
- `custoEstimadoUsd`: 0 até o dono aprovar um pedido de `gasto` (aí vira o `custo` e entra no gasto do mês) ou o que veio no criar.
- `passos`: os 40 mais novos.
- Tamanhos: `detalhes` até 64 KB, `entrada` até 512 KB, cada `saida`/`pecasParaGravar` até 128 KB.

## As rotas

### Listar — `GET /api/molde/fila?estado=novo,aprovado,refazer&limite=5`

`{ "itens": [<item>] }`, os mais velhos primeiro (pelo `criadoEm`), pelo estado **efetivo** (com o prazo vencido já contado).
Filtros: `estado` (um ou vários, vírgula; os dois vocabulários valem), `projeto`, `avatar` (projeto ou nome), `estacao`, `todos=1`,
`limite` (1–200, padrão 50), `formato=orquestrador|pagina`.

### Um item — `GET /api/molde/fila/<id>`

`{ "item": <item> }` (qualquer item da fila, menos os rascunhos). 404 `nao_achou`.

### Criar — `POST /api/molde/fila`

```json
{ "projeto": "birdie", "estacao": "molde-roteirista", "tipo": "legenda", "titulo": "Legenda do Reel da oração",
  "detalhes": {"tema": "oração pela filha"}, "entrada": {"pecas": {}, "pecasMarcas": {}, "projeto": {}},
  "chave": "k0123456789abcdef", "origem": "pagina" }
```

`201 {item, reaproveitado: false}` · `200 {item, reaproveitado: true}`. `origem`: `pagina` (padrão), `telegram` ou `piloto`.
O avatar vem da lista que a página manda (`molde_avatares`) quando não vem no corpo.

### Ações — `POST /api/molde/fila/<id>/<acao>`

Todas respondem `{ "item": <item> }` (e o que estiver a mais na tabela).

| ação | corpo | o que faz | erros |
|---|---|---|---|
| `pegar` | `{versao, quem?, prazoSeg?}` | `na-estacao`, `pegoPor = quem`, `pegoAte = agora + prazoSeg` | 409 `pego`, `estado`, `versao`, `pagina` |
| `passo` | `{versao, estacao, saida, quem?}` | soma `{estacao, em, saida}` em `passos`; renova o prazo; `molde-revisor` → `na-revisao` | 409 `estado` (não pego), `pego`, `versao` |
| `aprovacao` | `{versao, motivo, pergunta?, opcoes?, achados?, custo?, resumo?, previa?, quem?}` | `esperando-dono`, rodada + 1, a posse acaba; manda a mensagem no Telegram. Resposta a mais: `telegram` (true = saiu agora; senão o relógio manda no minuto seguinte) | 409 `estado`, `pego`, `versao` |
| `decisao` | `{decisao, nota?, versao?, rodada?, por?}` | a decisão do dono (página); o Telegram passa a mostrar | 400 `opcao`, `sem_motivo`; 409 `ja_decidido`, `rodada`, `estado`, `versao` |
| `resultado` | `{versao, saida, pecasParaGravar?, quem?}` | `pronto` | 409 `estado`, `pego`, `versao` |
| `erro` | `{versao, motivo, tentarDeNovo?, quem?}` | `novo` (tentativas + 1, até 2) ou `erro` (aviso no Telegram). Resposta a mais: `tentaDeNovo` | 409 `estado` (já terminado), `pego`, `versao` |
| `soltar` | `{versao, nota?, quem?}` | volta ao estado de quando foi pego, sem tentativa; `etapa = nota` | 409 `estado`, `pego`, `versao` |

As ações da página da v134 (`decidir`, `aplicada`, `cancelar`, formato `{data}`) continuam iguais (`API_MOLDE_FILA.md`); `decidir`
aceita também as decisões novas.

### Os motivos e as opções padrão do `aprovacao`

| `motivo` | quando (ORQUESTRADOR.md) | opções padrão | botões no Telegram |
|---|---|---|---|
| `revisor` | o revisor reprovou | `corrigir`, `refazer`, `publicar`, `cancelar` (as 3 primeiras sempre) | **Corrigir** · **Refazer** / **Publicar mesmo assim** / **Cancelar** |
| `publico` | vai a público | `aprovar`, `refazer`, `cancelar` | Aprovar · Refazer / Cancelar |
| `gasto` | gasta (imagem, vídeo, voz) | `aprovar`, `cancelar` | **Aprovar o gasto · US$ X** / Cancelar |
| `faltam-dados` | faltam obrigatórios | `completar`, `cancelar` | Cancelar (completar é na página) |
| `pecas` | muda uma peça (`pecasParaGravar`) | `gravar`, `nao-gravar`, `cancelar` | Gravar · Não gravar / Cancelar |

A mensagem do Telegram: o título, o motivo, a `pergunta`, o `resumo`, **cada achado** (`lugar: «trecho» — porque`, e a troca), o custo
com o gasto do mês (quando há `custo`) e o link da prévia. «Refazer» pergunta o motivo em texto (a próxima mensagem, em até 15 min),
como na v134. Os botões são assinados e levam a rodada: o botão de um pedido antigo não decide o novo.

## O que cada decisão significa para o orquestrador (ao pegar o item de novo)

| `aprovacao.decisao` | estado | o orquestrador faz |
|---|---|---|
| `corrigir` | `aprovado` | aplica só as trocas dos achados, revisa de novo; limpo → `resultado` |
| `refazer` | `refazer` | a estação de novo com `aprovacao.nota` como ajuste |
| `publicar` | `aprovado` | `resultado` (a escolha é do dono: decisão 21) |
| `aprovar` / `gravar` | `aprovado` | `resultado` |
| `completar` | `aprovado` | lê o projeto de novo e roda a estação |
| `cancelar` / `nao-gravar` | `cancelado` | nada (não aparece em `novo,aprovado,refazer`) |

## O gasto do mês

`status_do_mes` (MCP) e o `/status` do Telegram usam a mesma conta: a soma do `custoEstimadoUsd` dos itens confirmados no mês
(São Paulo, zera no dia 1º) que não foram cancelados, contra `MOLDE_TETO_USD` (padrão 50). Um item do orquestrador só entra na conta
depois do «Aprovar o gasto».
