# Cópia de segurança do Molde (`/api/molde/backup`)

Os dados do Molde (coleções `moldes`, `partes`, `pedidos`, `fabrica`, `audio`, `biblioteca`, `versoes`…) moram só no banco do artifact do Claude. Se o artifact sumir, perde tudo. Estas rotas guardam uma cópia no **R2 do UaiFlow**, fora do Claude.

- **Não precisa de migração** nem de variável nova: usa o mesmo R2 das mídias (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`) e o mesmo `MOLDE_API_TOKEN`. Sem R2 configurado, as rotas respondem `503` com `codigo: "sem_r2"`; o resto do UaiFlow segue normal.
- Onde fica: `uaiflow/molde-backups/<projeto|tudo>/<AAAAMMDD-HHMMSS-mmm>-<20 letras aleatórias>.json.gz` (o JSON comprimido com gzip). Fica dentro de `uaiflow/`, como todas as outras chaves do UaiFlow no balde.
- **Quantas ficam (por projeto):** as 30 mais novas + a mais nova de cada mês dos últimos 12 meses. A limpeza roda a cada cópia nova daquele projeto (outros projetos não são tocados). Partes de envios que nunca terminaram são apagadas depois de 1 dia.
- O sufixo aleatório (80 bits) torna o endereço impossível de adivinhar. Isso importa porque o balde tem endereço público (`R2_PUBLIC_BASE_URL`) para a Meta ler as mídias dos posts: **quem tiver o endereço completo de uma cópia consegue baixá-la**. As rotas nunca devolvem esse endereço público (o `formato=link` é um link assinado do R2 que vence em 15 minutos).

## Regras gerais

- Autenticação igual à fila: `x-molde-token: <MOLDE_API_TOKEN>` (ou `Authorization: Bearer …`). Sem ele: `401 {"error":"Token do Molde invalido.","codigo":"token_invalido"}`; servidor sem token: `503 … "codigo":"fechado"`.
- Erros: `{"error": "<frase em português>", "codigo": "<código>"}`.

  | HTTP | `codigo` | o que é |
  |---|---|---|
  | 400 | `invalido` | projeto, corpo, gzip, JSON, parte ou envio errado (a frase diz qual) |
  | 404 | `nao_encontrada` | cópia não existe (id errado ou já apagada) |
  | 409 | `faltam_partes` | envio em partes: chegou a última, mas faltam outras (vem `faltam: [1, 2]`) |
  | 413 | `grande_demais` | pedido acima de 5,5 MB, parte acima de 3 MB, ou cópia aberta acima de 25 MB |
  | 502 | `r2_falhou` | o R2 não respondeu direito: tente de novo em alguns minutos |
  | 503 | `sem_r2` / `fechado` | falta configurar o R2 / o `MOLDE_API_TOKEN` no servidor |

- `projeto`: letras minúsculas, números e hífen (`birdie-lanier`), até 60 letras. Vazio = `tudo` (uma cópia de todos os projetos juntos).
- A cópia precisa ser um **objeto JSON** (`{ … }`). O formato de dentro é da página (sugestão abaixo); o UaiFlow só confere que é JSON e guarda.

## Rotas

### Guardar — `PUT /api/molde/backup?projeto=<projeto>` (ou `POST`, igual)

`POST` existe porque a ponte do robô (`uaiflow {op:'chamar'}`) só tem GET, POST, PATCH e DELETE. O corpo pode ser:

1. **`{ "projeto"?: "birdie-lanier", "gz64": "<o JSON comprimido com gzip, em base64>" }`** — o jeito da ponte do robô (ela só leva JSON);
2. o próprio JSON da cópia (o servidor comprime);
3. os bytes do gzip (`content-type: application/gzip`), para quem chamar direto (curl, scripts).

O `?projeto=` da rota vale mais que o `projeto` do corpo. Até **5,5 MB por pedido** (o Netlify recusa acima de 6 MB); maior que isso, use as partes.

Resposta `201`:

```json
{ "data": { "id": "birdie-lanier--20261016-130500-123-0a1b2c3d4e5f60718293", "projeto": "birdie-lanier", "criadoEm": "2026-10-16T13:05:00.123Z", "tamanho": 183422, "partes": 1 }, "apagadas": 0 }
```

`tamanho` = bytes comprimidos; `partes` = quantos pedaços de 2 MB a leitura tem; `apagadas` = quantas cópias antigas a limpeza tirou.

### Guardar em partes — `POST /api/molde/backup/partes`

Para quando o gzip passa de ~2 MB (cada chamada pela ponte do robô deve ficar perto de 3 MB, como o `ler_video` faz). Corte o **arquivo .json.gz** em pedaços de até 2 MB (máximo 3 MB, até 12 partes = 24 MB comprimidos) e mande na ordem:

```json
{ "projeto": "birdie-lanier", "envio": "k3j9x0a8f7d6s5a4q2w1", "parte": 0, "total": 3, "gz64": "<pedaço em base64>" }
```

- `envio`: um código aleatório que a página cria (16 a 40 letras minúsculas e números), o mesmo em todas as partes.
- Partes do meio → `202 {"data":{"envio","parte","total","pronto":false}}`. A última junta tudo, confere, guarda e responde igual ao PUT (`201`).
- Faltou alguma: `409 {"codigo":"faltam_partes","faltam":[1]}`: mande as que faltam e a última de novo.

### Listar — `GET /api/molde/backup?projeto=<projeto>`

`{ "data": [ <cópia>, … ], "total": 12 }`, mais novas primeiro. Sem `projeto`: as de todos os projetos (e as de `tudo`).

### Devolver — `GET /api/molde/backup/<id>?parte=0`

`{ "data": { ...<cópia>, "parte": 0, "gz64": "<pedaço de até 2 MB do .json.gz, em base64>" } }`. Peça `parte` de `0` a `partes - 1`, junte os bytes na ordem e descomprima (gzip) para ter o JSON. Cópia de até 2 MB comprimidos = 1 chamada só.

`GET /api/molde/backup/<id>?formato=link` → `{ "data": { ...<cópia>, "link": "https://…r2.cloudflarestorage.com/…", "expiraEm": "<ISO>" } }`: link de 15 minutos para baixar o `.json.gz` inteiro no computador (para guardar num pendrive, por exemplo).

## O que o robô e a página precisam fazer

**A ponte do robô (conferido no `mcpb/flow/server/index.mjs` e `uaiflow.mjs` da `fase10-robo`):** `ler_video {acao:'uaiflow', op:'chamar', metodo, rota, corpo}` repassa para o UaiFlow com o token do Mac. Limites: métodos só `GET`, `POST`, `PATCH`, `DELETE` (por isso o `POST` = `PUT`); rota `/api/molde/*` (menos `upload`) só com `a-z 0-9 / _ -` no caminho e `A-Za-z0-9=&%._,-` na query; `corpo` é um objeto JSON (nada de bytes); a resposta é o `data` do JSON (o robô faz `r.json()`, por isso a leitura vem em `gz64` e não em bytes); prazo de 45 s por chamada. As `acao:'gravar'/'baixar'` só aceitam vídeo, áudio, imagem ou legenda, então um `.json.gz` **não** passa por elas. Com as rotas acima, **o robô não precisa mudar nada**: tudo cabe na ponte `chamar`. (Um teste do UaiFlow, `tests/copia-molde.test.mts`, confere as rotas contra uma cópia da trava `ROTA_MOLDE` do robô.)

**A página (Bastidores › "Cópia de segurança"):**

1. Junta as coleções do projeto num objeto, por exemplo `{ "formato": "molde-copia-1", "projeto": "birdie-lanier", "criadoEm": "<ISO>", "colecoes": { "moldes": [ {id, ...} ], "partes": [...], "pedidos": [...], "fabrica": [...], "audio": [...], "biblioteca": [...], "versoes": [...] } }`.
2. Comprime no navegador: `new Response(new Blob([JSON.stringify(copia)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()` e passa para base64.
3. Gzip de até 2 MB → uma chamada:
   `ler_video {acao:'uaiflow', op:'chamar', metodo:'POST', rota:'/api/molde/backup?projeto=birdie-lanier', corpo:{ gz64 }}` → `resposta` = `{id, projeto, criadoEm, tamanho, partes}`.
   Maior → corta os **bytes do gzip** em pedaços de 2 MB e manda um por um:
   `ler_video {acao:'uaiflow', op:'chamar', metodo:'POST', rota:'/api/molde/backup/partes', corpo:{ projeto:'birdie-lanier', envio, parte:i, total:n, gz64:pedaco_i }}` (a última devolve a cópia).
4. Lista: `ler_video {acao:'uaiflow', op:'chamar', metodo:'GET', rota:'/api/molde/backup?projeto=birdie-lanier'}` → `resposta` = a lista (mais novas primeiro).
5. «Voltar para esta»: pergunta antes; **guarda uma cópia do estado atual** (passos 1–3); depois busca `parte` 0 até `partes-1`:
   `ler_video {acao:'uaiflow', op:'chamar', metodo:'GET', rota:'/api/molde/backup/<id>?parte=0'}` → junta os `gz64` na ordem, descomprime com `DecompressionStream('gzip')` e regrava as coleções daquele projeto.
6. Cópia automática 1×/dia com a página aberta: só se algo mudou desde a última (compare, por exemplo, o maior `atualizadoEm` das coleções ou um hash do JSON com o que ficou guardado na página). Não gasta nada além do R2 (centavos por mês).
7. Erros: mostre o `error` da resposta. Se o robô devolver erro com `503 sem_r2`, diga "A cópia fora do Claude ainda não está ligada (falta o R2 no UaiFlow)".

## Riscos e limites

- **Endereço público do balde:** quem tiver o endereço completo de uma cópia (com as 20 letras aleatórias) consegue baixá-la. As rotas nunca mostram esse endereço; não o copie para lugar nenhum. Cópia não é criptografada no R2.
- Quem tem o `MOLDE_API_TOKEN` lê e grava todas as cópias (é o mesmo token de toda a porta do Molde).
- A cópia aberta vai até 25 MB; o envio em partes vai até 24 MB comprimidos. Fotos em base64 dentro das coleções comprimem pouco: prefira guardar o link (R2) da imagem, não a imagem.
- Restaurar é coisa da página: o UaiFlow só guarda e devolve.
