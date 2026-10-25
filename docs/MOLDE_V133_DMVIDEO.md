# Molde v133 · a DM com o vídeo do avatar (K-DMVIDEO) — o que a página manda ao UaiFlow

Para a frente que ajusta a página do Molde (`molde-do-avatar`). Precisa da migração 0014 (`docs/ATUALIZACAO_0014.md`), que precisa da 0012.
Sem a 0014 nada quebra: o post em modo vídeo segue a sequência da 0012 (mensagem 2, o link e o lembrete) e as rotas novas avisam.

## O roteiro (6 passos)

1. Reel com a chamada «comenta SONO» (a página limita a 2–3 por semana, como aviso).
2. A 1ª mensagem (`dmText`, a resposta privada ao comentário — a única que a Meta deixa mandar a quem comentou) nomeia o que a
   pessoa fez e pergunta por quê: «Valeu por comentar no vídeo! O que te fez comentar?». Sem link. A resposta dela abre a janela de 24 h.
3. Quando ela responde: o aviso vai ao Nicolas no Telegram (relógio, a cada minuto) e a resposta automática fica na fila para
   `videoAposMinutos` depois (padrão 3, no máximo 15).
4. O link ainda não vai.
5. O vídeo do avatar (~2 min) escolhido pelas palavras da resposta (`dm_videos.palavras`; sem casar, o vídeo `geral`).
6. Só então o link do produto (`mensagem3` + `linkUrl`, o link que conta cliques com `?de=dm`), `linkAposSegundos` depois do vídeo.

## 1. O pacote do post — `automationOptions.sequencia` ganha 2 campos

| Campo | Valores | O que faz |
| --- | --- | --- |
| `modo` | `"link"` (padrão) ou `"video"` | `"video"` liga o roteiro com vídeo. Vale mesmo sem `mensagem2`/`mensagem3`/`lembrete`. Outro valor → 400. |
| `videoAposMinutos` | 0 a 15 (padrão 3) | minutos entre a resposta da pessoa e o vídeo. |

No modo vídeo, `mensagem2` vira a frase que sai junto do vídeo quando o vídeo não tem a dele (`dm_videos.texto`); `linkAposSegundos`
conta a partir do vídeo (sugestão: 150, o tempo de assistir). O resto é o da 0012 (`docs/MOLDE_V132_PAGINA.md`).

## 2. Cadastrar os vídeos — `POST /api/molde/dmvideo`

1. Suba cada vídeo pelo `POST /api/molde/upload` com `folder: "dmvideos"` (vai para `uaiflow/molde-dmvideos/`, pasta que a
   publicação de um post nunca apaga). MP4 ou MOV, **até 25 MB** (limite da Meta para vídeo na DM). O robô do Mac 1.4.1 faz isso
   com `ler_video {acao:'uaiflow', op:'midia_dm', path}`: diminui o vídeo no Mac quando passa de 24 MB e devolve `{url, key, bytes, dur, comprimido}`.
2. Mande a lista:

```json
{
  "accountId": "<uuid, opcional>",
  "externalRef": "<pubRef(R)>",
  "videos": [
    { "chave": "acorda-de-madrugada", "titulo": "Acorda de madrugada", "palavras": ["madrugada", "acordo", "3h"], "texto": "Gravei isto para você:", "videoUrl": "https://…/uaiflow/molde-dmvideos/…/madrugada.mp4", "tamanho": 18000000, "duracaoSeg": 118 },
    { "chave": "geral", "titulo": "O método em 2 minutos", "palavras": [], "geral": true, "videoUrl": "https://…/geral.mp4" }
  ]
}
```

- No lugar de `externalRef`, `keyword: "SONO"` cadastra os vídeos da palavra (valem para os posts dessa palavra sem vídeos próprios).
- A lista **troca** a de antes (o que saiu é apagado). 1 a 6 vídeos; no máximo 1 `geral`; cada um com palavras ou `geral`.
- As palavras casam sem acento e sem maiúsculas, pela raiz (`dorm` → «dormir», «dormindo»); uma expressão (2+ palavras) vale 2.
- Respostas: 200 `{data:{escopo, videos}}`; 400 com a frase; 503 `{codigo:"falta_0014"}`.
- `GET /api/molde/dmvideo?ref=<externalRef>` (ou `?keyword=`) devolve a lista (sem a 0014: `data.videos: []` e `data.aviso`).

## 3. O funil por post — `GET /api/molde/dmvideo/funil?refs=a,b&views=1200,300`

Tudo vem dentro de `data` (o robô do Mac entrega à página só o `data`):

```json
{ "data": {
  "posts": [{
    "ref": "…", "comentarios": 40, "responderam": 18, "videos": 17, "cliques": 6, "compras": 1, "views": 1200,
    "comSinalDeVisto": 7, "porVideo": [{ "chave": "acorda-de-madrugada", "enviados": 9, "cliques": 4 }],
    "gargalo": { "etapa": "clique", "tipo": "conversa", "frase": "Só 35 % …", "taxas": { "resposta": 0.45, "video": 0.94, "clique": 0.35, "compra": 0.17 } }
  }],
  "referencias": { "resposta": 0.35, "video": 0.9, "clique": 0.25, "compra": 0.05, "comentariosPorMilViews": 3, "minimoComentarios": 20, "minimoBase": 10 },
  "nota": "A Meta não informa se a pessoa assistiu ao vídeo na DM. …"
} }
```

- `comentarios` = pessoas que comentaram a palavra e receberam a 1ª DM; `responderam` = responderam a pergunta; `videos` = o envio
  do vídeo saiu (uma pessoa conta uma vez); `cliques` = tocaram no link da DM; `compras` = vendas aprovadas com a origem do post (0012).
- **Vídeo visto não existe na Meta.** `comSinalDeVisto` = recebeu o vídeo e depois tocou no link ou escreveu de novo. A página
  mostra a `nota` junto do número.
- `gargalo.tipo`: `trafego` (menos de 20 comentários, ou menos de 3 por mil views), `conversa` (resposta, vídeo ou clique abaixo
  da referência), `pagina` (compra abaixo de 5 % dos cliques), `nenhum`. A conta é a função pura `gargaloFunil` (`src/lib/db/dm-videos.ts`).
