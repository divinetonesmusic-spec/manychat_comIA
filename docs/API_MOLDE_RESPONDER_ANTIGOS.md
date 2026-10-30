# «Responder quem já comentou neste post» (`/api/molde/responder-antigos`)

Para quando um post viralizou **antes** de a automação existir: os comentários antigos não chegaram pelo webhook,
então ninguém foi respondido. Esta porta lê os comentários do post na Meta, mostra os números e **só manda depois
da confirmação do dono**. Não precisa de migração (usa a `public.app_status`, da 0004, e as tabelas de sempre).

Na tela: abra a automação (Fluxos → a automação → Editar) e toque em **«Responder quem já comentou neste post»**.

## Como funciona (em 2 passos)

1. **Contar (nada sai).** Lê todos os comentários do post (50 por vez, com as respostas) e separa:
   - `lidos`: comentários lidos;
   - `combinam`: têm a palavra-chave (a **mesma** regra do webhook: `automationMatches` em `src/lib/db/repositories.ts`);
   - `jaRespondidos`: o comentário já tem envio na fila (o webhook respondeu, ou uma rodada anterior), ou a pessoa já recebeu esta automação;
   - `repetidos`: a mesma pessoa comentou mais de uma vez (recebe uma vez só);
   - `velhos`: comentário com mais de 7 dias (a Meta não deixa mais responder no direct);
   - `semTempo`: no ritmo de 200 por hora, a vez dele chegaria depois dos 7 dias;
   - `paraEnviar`: quem recebe se o dono confirmar.
2. **Confirmar.** Cada comentário escolhido passa pelo **mesmo caminho do webhook** (`runCommentAutomations` em
   `src/lib/comment-automation.ts`): a resposta privada (1ª mensagem), a resposta pública (se a automação tiver) e o
   fluxo desenhado. Os envios saem do mais antigo para o mais novo (o que vence primeiro sai primeiro), espaçados de
   18 s (= 200 por hora). A fila (`src/lib/queue/drain.ts`) continua segurando o limite de 200 por hora do perfil.

**Nunca manda duas vezes.** Antes de pôr um comentário na fila, o UaiFlow grava uma marca dele
(`public.events`, `instagram_event_id = 'responder-antigos:<id do comentário>'`, índice único por perfil). Dois pedidos ao
mesmo tempo, o relógio e a tela juntos, ou rodar de novo amanhã: o comentário entra na fila uma vez só. A fila também
já impede duas respostas privadas para o mesmo comentário (`queue_one_private_reply_per_comment`).

**7 dias.** O que entrou na fila por aqui leva `origem: "responder_antigos"` e `comentarioEm` no payload; se não sair
a tempo, a fila marca como `skipped` («Passaram 7 dias do comentário…») a resposta privada e a pública.

**Limite de tempo do Netlify.** Cada chamada trabalha no máximo ~7 s e guarda onde parou. O relógio de cada minuto
(`/api/queue/drain`) continua sozinho a contagem ou o envio que ficou pela metade, mesmo com a página fechada.

## Rotas

Autenticação: `x-molde-token: <MOLDE_API_TOKEN>` (ou `Authorization: Bearer …`), como as outras rotas `/api/molde`.
A tela usa a mesma lógica em `/api/automations/<id>/responder-antigos` (login do painel; mesmos parâmetros, sem `automationId`).

### Contar — `GET /api/molde/responder-antigos?automationId=&post=&accountId=&novo=1`

- `post`: o link do Reel/post (`https://www.instagram.com/reel/ABC123/`) ou o id da mídia (só números). O link é
  procurado nos posts do perfil (até 2.000 posts).
- `novo=1`: conta de novo do zero (para pegar quem comentou depois). Não muda nada enquanto o envio está acontecendo.
- Enquanto `data.estado = "lendo"`, chame de novo (uns 7 s de leitura por chamada).

Resposta `200 {"data": …}`:

```json
{
  "estado": "pronto",
  "mediaId": "17900000000000001",
  "permalink": "https://www.instagram.com/reel/ABC123/",
  "numeros": { "lidos": 12034, "combinam": 8120, "jaRespondidos": 310, "repetidos": 900, "velhos": 1500, "semTempo": 0, "paraEnviar": 5410 },
  "enfileirados": 0, "enviadas": 0, "naFila": 0, "naoSairam": 0,
  "tempoEstimado": "cerca de 27 h 3 min",
  "terminaPorVolta": "2026-10-31T23:10:00.000Z",
  "mensagem": "5410 pessoas podem receber agora. No ritmo de 200 por hora, leva cerca de 27 h 3 min. Nada foi mandado ainda.",
  "erro": null
}
```

`estado`: `lendo` (contando) · `pronto` (esperando a confirmação) · `enviando` · `concluido` · `erro` (a Meta recusou a leitura; conte de novo).

### Confirmar — `POST /api/molde/responder-antigos`

```json
{ "automationId": "<uuid>", "post": "<link ou id>", "paraEnviar": 5410 }
```

- `paraEnviar` é o número que o dono viu. Se a contagem mudou: `409` com os números novos em `data` (mostre de novo e peça outra confirmação).
- Chamar de novo continua o envio e mostra o andamento (`enviadas` de `numeros.paraEnviar`). Com `paraEnviar: 0`, só fecha.

Erros (`{"error": "<frase em português>"}`): `400` automação desligada / sem palavra-chave / não ligada a este post /
canal pausado · `404` automação ou post não encontrado · `409` contagem ainda acontecendo ou mudou · `503` Meta lenta.
Se a Meta pedir para esperar (limite de uso), `data.erro` diz o horário e o relógio continua sozinho depois.

## Limites (Meta)

- Resposta privada: **uma** mensagem por comentário, até **7 dias** depois do comentário
  ([Private Replies](https://developers.facebook.com/docs/instagram-platform/private-replies/)).
- `GET /{ig-media-id}/comments`: só comentários de primeiro nível (as respostas vêm por `replies`), no máximo 50 por
  página, do mais novo para o mais antigo, sem filtro por data; comentários de quem o perfil restringiu e de anúncios não vêm
  ([IG Media Comments](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/comments),
  [IG Comment](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-comment)).
- 200 mensagens automáticas por hora por perfil (a fila do UaiFlow já segura).
