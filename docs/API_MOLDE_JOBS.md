# API da fila de trabalho do Molde (`/api/molde/jobs`)

Para quem for fazer o **robô do Mac** ("Estúdio do Molde") e a **página do Molde**. Precisa da migração 0008 (`docs/ATUALIZACAO_0008.md`).

A ideia: a página põe trabalhos na fila; o robô pede o próximo sozinho (mesmo com a página fechada), avisa o andamento, pede aprovação com uma prévia (que chega no Telegram com «Aprovar» / «Refazer») e, no fim, conclui ou registra o erro. O relógio do UaiFlow (a cada minuto) devolve para a fila o trabalho de um Mac que sumiu e manda os avisos.

## Regras gerais

- Endereço base: `https://<site do UaiFlow>`. Tudo em JSON (`content-type: application/json`).
- **Autenticação:** cabeçalho `x-molde-token: <MOLDE_API_TOKEN>` (ou `Authorization: Bearer <MOLDE_API_TOKEN>`) em **todas** as rotas. Sem ele: `401 {"error":"Token do Molde invalido.","codigo":"token_invalido"}`.
- **Erros:** sempre `{"error": "<frase em português para mostrar à dona>"}`, às vezes com `data` (o trabalho como está agora) e `estado`. Os 401/503 trazem também `codigo`, para o robô decidir sem ler a frase:

  | HTTP | `codigo` | o que é | o que o robô faz |
  |---|---|---|---|
  | 401 | `token_invalido` | o `MOLDE_API_TOKEN` do robô não é o do servidor | parar e mostrar "confira o token" (não adianta repetir) |
  | 503 | `fechado` | o servidor está sem `MOLDE_API_TOKEN` | esperar (recuo longo) |
  | 503 | `falta_0008` | a migração 0008 não foi colada | esperar (recuo longo) |
  | 503 | `falta_0006` | (só `/api/molde/dms` e `/api/molde/links`) a 0006 não foi colada | esperar |
  | 409 | `sem_posse` | (batimento, aprovacao, concluir, erro) o `posse` não é o do último claim deste trabalho | parar o que estiver fazendo nesse trabalho (outro claim pegou) |

  Os campos são novos e só acrescentam: a frase (`error`) continua a mesma de antes.
  - `400` pedido errado (a frase diz o quê); `404` trabalho não encontrado; `409` o trabalho não está no estado certo para isso (veja abaixo); `500` falha passageira (tente de novo).
  - `503 {"error":"Falta colar a atualização 0008 no Supabase (veja docs/ATUALIZACAO_0008.md)."}`: a 0008 ainda não foi colada. O robô deve esperar uns minutos e tentar de novo, sem insistir em loop rápido.
- Datas em ISO 8601 (UTC). Dinheiro em dólares (número).

## Ciclo de estados

```
na_fila ──claim──> rodando ──concluir──> pronto
   ^                 │  │
   │                 │  └──erro──> erro ──repetir──> na_fila
   │   (lease venceu │     (ou volta para a fila com tentarDeNovo, até 3 tentativas)
   │    ou erro com  │
   │    tentarDeNovo)└──aprovacao──> esperando_aprovacao ──Aprovar──> aprovado ──claim──> rodando ...
   │                                                     └─Refazer──> recusado ──claim──> rodando ...
qualquer estado não terminado ──cancelar──> cancelado ──repetir──> na_fila
```

- **Estados que o robô pega (claim):** `na_fila` (começar), `aprovado` (continuar depois do «Aprovar»), `recusado` (refazer depois do «Refazer»). O robô sabe o que fazer olhando o campo **`retomada`** do trabalho entregue (`comecar`, `continuar` ou `refazer`) e, para refazer, `aprovacao.nota`.
- **Terminados:** `pronto`, `erro`, `cancelado`.
- **Lease (prazo):** quem pega o trabalho é o dono dele por **10 minutos**. Cada `batimento` renova os 10 minutos. Se o prazo vence (o Mac desligou, perdeu a internet), o relógio devolve o trabalho para o estado de onde ele saiu (`na_fila`, `aprovado` ou `recusado`) e outro pedido pode pegá-lo.
- **Tentativas:** cada claim conta 1. Na 3ª vez que o prazo vence (ou no 3º `erro` com `tentarDeNovo`), o trabalho vira `erro` e chega um aviso no Telegram. Pedir aprovação e cada decisão zeram a contagem.

## O trabalho (objeto `data`)

```json
{
  "id": "2b6c0d6e-8a51-4c41-9a39-7c1d1c1b0f10",
  "accountId": "9f1e…", "username": "birdie.lanier",
  "projeto": "birdie-lanier", "tipo": "reel_pipeline", "ref": "cena-2026-10-16-01", "titulo": "Birdie no lago",
  "estado": "rodando", "etapa": "Gerando a voz", "progresso": 40, "prioridade": 0,
  "payload": { "roteiro": "…" },
  "resultado": null,
  "previa": null,
  "erro": null,
  "tentativas": 1, "worker": "Mac do Nicolas", "leaseAte": "2026-10-16T13:10:00.000Z",
  "custoEstimadoUsd": 1.2, "forcarCusto": false,
  "rodada": 0, "aprovacao": null, "aprovacoes": [],
  "retomarEstado": "na_fila", "retomada": "comecar", "previaApagada": false,
  "iniciadoEm": "2026-10-16T13:00:00.000Z", "concluidoEm": null,
  "criadoEm": "2026-10-16T12:58:00.000Z", "atualizadoEm": "2026-10-16T13:00:00.000Z"
}
```

- `previa`: `{ "texto"?, "imagem"?, "video"?, "audio"?, "link"? }` (links `https://`, de preferência do R2).
- `aprovacao` (a última decisão da rodada atual) e cada item de `aprovacoes`: `{ "decisao": "aprovar"|"refazer", "via": "pagina"|"telegram", "por": "@nicolas"|null, "em": "<ISO>", "nota": "Mais curto"|null, "rodada": 1 }`.
- `rodada`: quantas vezes o trabalho já pediu aprovação (1 na primeira prévia).
- **`retomada`** — o que o robô faz com o trabalho que acabou de pegar (é o campo para olhar; os outros são o detalhe):
  - `"comecar"`: do zero, com o `payload` (primeiro claim, ou de volta à fila depois de um erro/Mac sumido antes de qualquer decisão);
  - `"continuar"`: a dona tocou em «Aprovar» na prévia **atual** (`aprovacao.rodada == rodada`): siga sem refazer (ex.: conferir os arquivos de `resultado` e concluir);
  - `"refazer"`: tocou em «Refazer» na prévia atual: faça de novo levando em conta `aprovacao.nota`, e peça aprovação outra vez.
- `retomarEstado`: de onde o trabalho saiu no último claim (`na_fila`, `aprovado` ou `recusado`); `null` antes do primeiro claim. Se o Mac sumir, é para lá que o trabalho volta.
- `previaApagada`: `true` quando o relógio já apagou a prévia do R2 (30 dias depois, veja abaixo).

## Rotas da página

### Pôr na fila — `POST /api/molde/jobs`

```json
{
  "projeto": "birdie-lanier",
  "tipo": "reel_pipeline",
  "ref": "cena-2026-10-16-01",
  "titulo": "Birdie no lago",
  "accountId": "9f1e…",
  "payload": { "roteiro": "…", "voz": "…" },
  "custoEstimadoUsd": 1.2,
  "prioridade": 0
}
```

- Obrigatórios: `tipo` (minúsculas, números e `_`, 2–40 letras: `reel_pipeline`, `narrar`, `montar`, `versoes`…) e `ref` (até 200 letras).
- Opcionais: `projeto` e `titulo` (até 200 letras), `accountId` (uuid de um perfil do UaiFlow), `payload` (objeto até 64 KB), `custoEstimadoUsd` (0–1000, padrão 0), `prioridade` (inteiro −100 a 100, maior sai primeiro; padrão 0), `forcarCusto: true` **com** `confirmo: "passar do teto"` (só depois de a dona confirmar na tela).
- Respostas: `201 {"data": <trabalho>, "criado": true}`. O mesmo `(projeto, tipo, ref)` de novo devolve o que já existe, sem mudar nada: `200 {"data": <trabalho>, "criado": false}`. `404` se o `accountId` não existe.

### Listar — `GET /api/molde/jobs?projeto=&estado=&tipo=&limite=`

- `estado`: um ou vários separados por vírgula (`na_fila,rodando,esperando_aprovacao`). `limite`: 1–200 (padrão 50). Mais recentes primeiro.

```json
{
  "data": [ <trabalho>, … ],
  "gastos": { "mes": "2026-10", "gastoUsd": 12.4, "tetoUsd": 50 },
  "mac": { "ultimaVez": "2026-10-16T13:00:05.000Z", "worker": "Mac do Nicolas" }
}
```

`mac.ultimaVez` é a última vez que um robô pediu trabalho (claim), com ou sem trabalho para entregar: serve para a página mostrar "Mac acordado / desligado".

### Ler um — `GET /api/molde/jobs/<id>` → `{"data": <trabalho>}`

### Ações — `POST /api/molde/jobs/<id>/<acao>`

| ação | corpo | o que faz | 409 quando |
|---|---|---|---|
| `decidir` | `{"decisao":"aprovar"\|"refazer", "nota"?, "por"?, "rodada"?}` | «Aprovar» → `aprovado`; «Refazer» → `recusado` (a `nota` vai para o robô). A mensagem do Telegram passa a mostrar a decisão. Mande `rodada` (a que a tela mostrou) para não decidir uma prévia mais nova sem ver. | já decidido (a frase diz quando e por onde), prévia antiga, ou não está esperando aprovação |
| `cancelar` | `{}` | `cancelado`. Se estiver `rodando`, o robô descobre no próximo batimento (409) e para. Cancelar de novo devolve 200. | já `pronto` ou `erro` |
| `repetir` | `{}` | Depois de `erro` ou `cancelado`: volta para `na_fila` do começo, tentativas zeradas. A última decisão (`aprovacao`) sai (o histórico fica em `aprovacoes`), então o robô recebe `retomada: "comecar"` e refaz de verdade, mesmo que o trabalho tivesse sido aprovado antes. | qualquer outro estado |
| `forcar` | `{"confirmo":"passar do teto"}` | Libera este trabalho a passar do teto do mês. Sem a frase: 400. | — |

## Rotas do robô

O robô se identifica com `worker` (o nome do Mac, 1–80 letras, sempre o mesmo). As ações sobre um trabalho só valem para o Mac que o pegou e enquanto ele está `rodando`; senão vem `409` com `estado` e a frase — **o robô deve parar o que estiver fazendo nesse trabalho** (foi cancelado, o prazo venceu e voltou para a fila, ou está com outro Mac).

**Código de posse (`posse`):** cada claim gera um código novo (uuid) e o devolve no trabalho entregue (`data.posse`; ele só aparece na resposta do claim). As 4 ações do robô (`batimento`, `aprovacao`, `concluir`, `erro`) precisam mandar `"posse": "<o código>"` no corpo. Sem ele, ou com um código de um claim antigo, vem `409 {"codigo": "sem_posse", "estado": "rodando", …}`: isso acontece quando o prazo venceu e o trabalho foi pego de novo (até pelo mesmo Mac, depois de dormir) — o processo antigo para e deixa o novo trabalhar. Precisa da 0008 com a coluna `posse` (a 0008 foi atualizada; colar de novo não estraga nada).

### Pegar o próximo — `POST /api/molde/jobs/claim`

```json
{ "worker": "Mac do Nicolas", "tipos": ["reel_pipeline", "narrar", "montar", "versoes"] }
```

- `tipos`: de 1 a 30, só os que este robô sabe fazer. Trabalho de outro tipo nunca sai para ele. O robô 0.10.0 pede `["montar", "versoes", "narrar_tratar"]` (veja "Tipos e payload" abaixo).
- Entrega o de maior `prioridade` e, entre iguais, o mais antigo. Dois Macs pedindo ao mesmo tempo nunca recebem o mesmo (`for update skip locked`).
- Resposta com trabalho: `200 {"data": <trabalho em "rodando"> + "posse": "<uuid>", "gastos": {...}}`. Guarde o `posse` para as ações deste trabalho.
- Sem trabalho: `200 {"data": null, "gastos": {...}}`.
- Teto atingido: `200 {"data": null, "gastos": {...}, "aviso": "Teto de gastos do Molde em outubro: …"}` (1 aviso por mês também no Telegram).
- **Teto de gastos:** o gasto do mês é a soma de `custoEstimadoUsd` dos trabalhos **começados** no mês (horário de São Paulo; zera no dia 1º). Um trabalho que ainda não começou só sai se `gasto + custo <= MOLDE_TETO_USD` (padrão 50), ou se custa 0, ou se tem `forcarCusto`. Trabalho já começado (voltando de aprovação, por exemplo) não conta de novo e não é barrado.
- Cada claim grava "o Mac pediu trabalho agora" (aparece em `/api/health` → `mac`). Se nenhum Mac pedir trabalho por 30 min com trabalho esperando há 30 min, chega no Telegram "O Mac parece desligado: tem N coisas esperando".
- Sugestão: pedir a cada 30–60 s quando estiver livre.

### Batimento — `POST /api/molde/jobs/<id>/batimento`

```json
{ "worker": "Mac do Nicolas", "posse": "<do claim>", "etapa": "Gerando a voz", "progresso": 40 }
```

Renova o prazo (10 min) e grava `etapa` (1–120 letras, português simples) e `progresso` (0–100), os que vierem. Mande **pelo menos a cada 2–3 minutos** enquanto trabalha. → `200 {"data": <trabalho>}` ou `409` (pare).

### Pedir aprovação — `POST /api/molde/jobs/<id>/aprovacao`

```json
{
  "worker": "Mac do Nicolas",
  "posse": "<do claim>",
  "previa": { "texto": "Versão de 28 s, voz da Birdie.", "video": "https://midia.exemplo.com/previa.mp4" },
  "resultado": { "arquivos": ["…"] }
}
```

- `previa`: pelo menos um de `texto` (até 2000 letras) ou um link `https://` (`imagem`, `video`, `audio`, `link`).
- **Subir a prévia:** `POST /api/molde/upload {fileName, contentType, size, folder: "molde-previas"}` → `{data: {key, uploadUrl, publicUrl}}`; faça o `PUT` do arquivo em `uploadUrl` (com o `content-length` exato) e mande `publicUrl` na prévia. Tipos aceitos: MP4, MOV, JPG, PNG, WEBP (áudio ainda não: para a prévia de uma narração, mande um MP4 com o áudio, ou só o texto). O arquivo fica em `uaiflow/molde-previas/AAAA-MM/…` e o relógio o apaga **30 dias** depois da última mudança no trabalho (só o que está nessa pasta e só de trabalhos que não estão `rodando`). `folder: "previas"` dá no mesmo; `folder: "molde"` ou nenhum continua indo para `uaiflow/molde/`.
- O trabalho vai para `esperando_aprovacao` (sai do Mac: sem lease), `rodada` aumenta, e o UaiFlow manda no Telegram «O vídeo «Birdie no lago» ficou pronto.» + o link da prévia + «Aprovar» / «Refazer». Se o Telegram falhar, o relógio tenta de novo a cada 10 min por 1 dia.
- Resposta: `200 {"data": <trabalho>, "telegram": true|false}` (`telegram` = a mensagem saiu agora).
- Depois da decisão (pela página ou pelo Telegram), o trabalho volta a ser entregue pelo `claim` como `aprovado` ou `recusado`.

### Concluir — `POST /api/molde/jobs/<id>/concluir`

`{ "worker": "Mac do Nicolas", "posse": "<do claim>", "resultado": { "video": "https://…", "postId": "…" } }` → `pronto`, progresso 100.

### Erro — `POST /api/molde/jobs/<id>/erro`

`{ "worker": "Mac do Nicolas", "posse": "<do claim>", "erro": "O HeyGen ficou fora do ar.", "tentarDeNovo": true }`

- `erro`: frase em português para a dona (até 1000 letras).
- `tentarDeNovo: true` (erro passageiro: internet, site fora do ar) e ainda há tentativas: volta para a fila (para o mesmo ponto de onde saiu). Senão: `erro`, com aviso no Telegram (1 por trabalho).

## Tipos e payload

O UaiFlow guarda o `payload` como veio (objeto até 64 KB) e não confere os campos: quem confere é o robô (campo que falta → `erro` com a frase "O pedido do trabalho veio sem «partes»." etc.). Os caminhos são relativos a `Imagens/AvatarAI` (ou absolutos dentro dela), como a página já manda hoje. Em **negrito**, os obrigatórios. O robô ignora campos que não conhece.

| tipo | rótulo no Telegram | o que o robô faz | `payload` | `resultado` (no `concluir` / `aprovacao`) |
|---|---|---|---|---|
| `montar` | "a montagem … ficou pronta" | junta as partes num vídeo (ação `montar` do `ler_video`) | **`partes`** (1–12 caminhos), **`saida`**, `narracao`, `marcas` `{ab:[ini,fim], fe:[ini,fim]}`, `largura`, `altura`, `fps`, `fusao`, `cauda`, `transicao`, `previa`, `legendas`, `saidaFinal`, `estilo` (objeto simples), `modelo`, `idioma`, `roteiro`, `retratar` `{entrada, saida, completa, ini, fim, …}`, `capaReel` `{saida, base, …}` | `{saida, final, semLegenda, previa, duracao, capa?, legenda?: {srt, ass, acerto}, audio?, avisos?, mac}` |
| `versoes` | "as versões … ficaram prontas" | versões para TikTok e Shorts (ação `versoes`) | **`entrada`**, **`pasta`**, **`nome`** (slug) | `{tiktok: {path, bytes, duracao}, shorts: {path, bytes, duracao, cortado}, mac}` |
| `narrar_tratar` | "o áudio da narração … ficou pronto" | trata o áudio da narração (ação `audio_tratar`) | **`entrada`**, **`saida`**, `completa`, `ini`, `fim`, `maxPausa`, `velocidade`, `ruido`, `lufs`, `palavras` | `{saida, mp3, previa, completa, completaMp3, mac}` |
| `reel_pipeline`, `narrar` | "o vídeo … ficou pronto" / "a narração … ficou pronta" | reservados (o robô 0.10.0 ainda não pega) | — | — |

Campos de controle, em qualquer tipo (dentro do `payload`): `pedirAprovacao` (true = pede aprovação com a prévia antes de concluir), `previaTexto` (o texto da prévia; padrão "«título» ficou pronto no Mac…"), `previaNaNuvem` (false = não sobe o vídeo da prévia, vai só o texto). Com aprovação, o link da prévia vai também em `resultado.links.previa`; depois do «Aprovar», o robô conclui com `{...resultado, aprovado: true}`. Outro tipo qualquer (minúsculas, números e `_`) é aceito na fila, mas só sai para um robô que o declare em `tipos`; no Telegram aparece como "o trabalho".

## Resposta de DM pelo Telegram (`/api/molde/dms`, 0006 + 0008)

`POST /api/molde/dms/<id>` `{"acao": "preparar", "texto": "…"}` guarda o rascunho que o Molde escreveu (1–1000 letras) e pergunta no Telegram com «Mandar» / «Não mandar». O toque em «Mandar» faz o mesmo que `{"acao": "enviar", "texto": <rascunho>}`. A página continua podendo mandar (ou mudar o texto) com `enviar`; aí a mensagem do Telegram passa a dizer "Mandada (pela página)". Cada `preparar` novo invalida os botões do rascunho anterior. O `GET /api/molde/dms` traz o campo `rascunho` (ou `null`). Sem a 0008: `preparar` responde 503 com a frase de falta; o resto segue igual.

## Exemplo: o laço do robô

```text
a cada 30–60 s, se estiver livre:
  r = POST /api/molde/jobs/claim {worker, tipos}
  se 401/503: esperar mais a cada falha (recuo até 10 min), olhando o "codigo"
  se r.data == null: continue
  job = r.data
  se job.retomada == "refazer": refazer usando job.aprovacao.nota
  se job.retomada == "continuar": seguir sem refazer (ex.: conferir os arquivos e concluir)
  senão ("comecar"): começar do zero com job.payload
  posse = job.posse   (vai em todas as ações abaixo)
  durante o trabalho, a cada 2 min: POST …/batimento {worker, posse, etapa, progresso}; se 409 (inclusive sem_posse), parar tudo
  para a dona ver: POST …/aprovacao {worker, posse, previa}; e voltar a pedir trabalho
  no fim: POST …/concluir {worker, posse, resultado}
  se falhar: POST …/erro {worker, posse, erro, tentarDeNovo}
```
