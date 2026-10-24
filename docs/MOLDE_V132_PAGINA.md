# Molde v132 · o que a página precisa mandar ao UaiFlow

Para a frente que ajusta a página do Molde (`molde-do-avatar`). Precisa da migração 0012 no Supabase (`docs/ATUALIZACAO_0012.md`).
Sem a 0012 nada quebra: o UaiFlow aceita os campos, avisa em `warning` / `aviso` e segue como antes.

## 1. A sequência de DM do post (2-DM) — MUDA a página

**Por que a página precisa mudar:** hoje o `pubPacote` manda só o passo 1 (`dmText`) e o `fn129SemLinkNaDm` apaga o `linkUrl`
(o link não pode ir na 1ª mensagem). Os passos 2, 3 e 4 do roteiro (`S.funil` → `fn129Mensagens(isca)`) não chegam ao UaiFlow.
Os campos de hoje não bastam: a página precisa mandar a sequência, num campo novo **dentro de `automationOptions`**.

No `POST /api/molde/posts` (e no carrossel derivado, `lnkAutomacaoDerivado`), o pacote fica assim (só `automationOptions.sequencia`
é novo; o resto continua igual):

```json
{
  "externalRef": "<pubRef(R)>",
  "keyword": "ORACAO",
  "dmText": "Valeu por comentar! O que te fez comentar?",
  "linkUrl": "",
  "automationOptions": {
    "quickReplyLabel": "Quero",
    "linkText": "",
    "publicReplies": ["…"],
    "sequencia": {
      "mensagem2": "Uma dica: reze 3 minutos antes de dormir…",
      "mensagem3": "Aqui está o guia completo:",
      "linkUrl": "https://uaiflow-divinetones.netlify.app/l/abc1234?de=dm",
      "linkLabel": "Abrir o guia",
      "linkAposSegundos": 60,
      "lembrete": "Passando para lembrar do guia 🙏",
      "lembreteHoras": 22
    }
  }
}
```

Campo por campo de `automationOptions.sequencia`:

| Campo | Obrigatório | De onde vem na página | Regra no UaiFlow |
| --- | --- | --- | --- |
| `mensagem2` | não* | `fn129Mensagens(isca)` → o item com `passo: 2` («quando a pessoa responder»), passado pelo `pubLimparDm` | texto, até 1000 letras. Sai **assim que a pessoa responde** (toca no botão da 1ª mensagem ou escreve). Sem link. |
| `mensagem3` | sim, se houver `linkUrl` | o item com `passo: 3` («depois do valor») | texto, até 1000 letras. Vai com o botão do link. |
| `linkUrl` | não | o link que conta cliques do post com `?de=dm` — o mesmo que `lnkPrepararPacote` põe hoje em `pacote.linkUrl` **antes** de o `fn129SemLinkNaDm` apagar | precisa começar com `https://`. Quando é um link `/l/<código>` do UaiFlow, o UaiFlow acrescenta `&s=<chave da pessoa>` (o toque no link tira o lembrete da fila). |
| `linkLabel` | não | `pk.linkLabel` (o texto do botão, `P.botao`) | até 20 letras. Padrão: «Abrir link». |
| `linkAposSegundos` | não | — (fixo) | 0 a 3600. Padrão **60**: o link sai 60 s depois da mensagem 2. |
| `lembrete` | não | o item com `passo: 4` («antes de fechar as 24 h») | texto, até 1000 letras. Sai só se a pessoa **não** tocou no link **nem** escreveu de novo. |
| `lembreteHoras` | não | — (fixo) | 1 a 23. Padrão **22**: horas depois da resposta da pessoa (antes de fechar a janela de 24 h da Meta). |

\* Pelo menos um de `mensagem2`, `mensagem3` ou `lembrete`. Todos vazios = sem sequência (como hoje).

- `dmText` continua sendo o **passo 1** (a resposta privada ao comentário, sem link) e `quickReplyLabel` o botão dele. Tocar no botão
  ou escrever qualquer coisa conta como a resposta que abre a janela de 24 h.
- Com sequência, continue mandando `linkUrl: ""` no topo (o `fn129SemLinkNaDm` já faz isso): o link vai só em `sequencia.linkUrl`.
- `sequencia: null` tira a sequência do post (só vale antes de publicar; depois de publicado o post não muda).
- Passos 5 e 6 (a isca aceita até 6) **não** são mandados: depois do lembrete, as mensagens da pessoa caem nas «DMs sem resposta»
  (`GET /api/molde/dms`) e o rascunho do Molde (v103_dms, `fn129DmsTxt`) continua de onde parou.
- Erros (400, frase em português): `sequencia` que não é objeto; texto com mais de 1000 letras; `linkUrl` sem `https://`; `linkUrl` sem
  `mensagem3`; sequência sem `keyword`.
- Sem a 0012: o post é salvo, `warning` traz «Falta colar a atualização 0012 no Supabase: a DM do post sai só com a 1ª mensagem (sem a
  sequência).» e a DM sai como hoje.

Sugestão de código na página (em `pubMandar`, depois do `lnkPrepararPacote` e antes do `fn129SemLinkNaDm`):

```js
var linkDm = pacote.linkUrl; /* o link que conta cliques + ?de=dm (lnkPrepararPacote) */
var is = fn129IscaDe(R), ms = is ? fn129Mensagens(is) : [];
var passo = function(n){ var m = ms.filter(function(d){ return d.passo === n; })[0]; return m ? pubLimparDm(m.texto).texto : ''; };
var seq = {mensagem2: passo(2), mensagem3: passo(3), lembrete: passo(4), linkLabel: pacote.linkLabel || undefined};
if (/^https:\/\//i.test(linkDm || '') && seq.mensagem3) seq.linkUrl = linkDm;
if (pacote.keyword && (seq.mensagem2 || seq.mensagem3 || seq.lembrete)) pacote.automationOptions.sequencia = seq;
```

## 2. O que já funciona com o que a página v131 manda (contrato `uaiflow-contrato-v131.md`) — NÃO muda a página

| Rota | O que o UaiFlow faz |
| --- | --- |
| `POST /api/molde/links` `{…, origem, destinoComOrigem}` | Guarda a `origem` (`mo` + até 7 letras/números) e o `/l/<código>` passa a levar ao `destinoComOrigem` (mesmo endereço do `destino`, https). Na resposta: `origem`, `destinoComOrigem` e, se algo foi ignorado ou falta a 0012, `aviso`. Trocar o `destino` sem `destinoComOrigem` volta a levar ao `destino`. |
| `/l/<código>?de=story` | Conta em `porOrigem.story` (o `GET /api/molde/links` traz `story` sempre, 0 quando não houve). No checkout com `sck=<origem>` (Hotmart, Kiwify), o UaiFlow junta de onde veio: `sck=mo1x2y3z-story`. |
| `GET /api/molde/vendas?refs=&desde=` | `{vendas:[{ref, plataforma, produto, valor, moeda, status, em, origem}], totais:{aprovadas, reembolsadas, chargebacks, receita}}` (sem `data`: o robô entrega igual). `status` = `aprovada` / `reembolsada` / `chargeback`. Venda sem origem conhecida: `ref: ""`. Sem a 0012: todas com `ref: ""` e `aviso`. O `?dias=` de antes continua igual. |
| `GET /api/molde/dms/contagem?refs=` | `{data:[{ref, disparadas, botao, responderam?, clicaram?}]}` → o robô entrega a lista. `disparadas` = respostas ao comentário que **saíram**; `botao` = pessoas que tocaram no botão da 1ª mensagem; com a sequência, `responderam` e `clicaram` (no link do passo 3). Post sem automação ainda não aparece. |

Os `refs` são cortados na vírgula **antes** de decodificar (um ref com `%2C` não vira dois), como a página já manda (`lnkRefs`).

Plataformas com aviso de venda no UaiFlow (endereço `/api/webhooks/<chave>`): `stripe`, `whop`, `gumroad`, `payhip`, `cakto` e, com a 0012,
`hotmart`, `kiwify`, `eduzz`, `monetizze`, `braip`, `ticto`, `perfectpay`, `digistore24`, `clickbank`, `lemonsqueezy` — as mesmas chaves de
`REC131_PLATAFORMAS`. O código da origem é lido nos parâmetros que `rec131Parametros` põe (`src`, `sck`, `utm_content`, `custom`, `tid`,
`client_reference_id`, `checkout[custom][molde_origem]`).
