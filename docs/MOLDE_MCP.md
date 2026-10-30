# O Molde dentro do Claude (conector MCP)

Desde a v135 o UaiFlow pode ser ligado no Claude como um **conector**. Aí, numa conversa, você pede e decide a fila do Molde sem abrir a página:

- «O que está esperando por mim?» · o Claude mostra a fila (de todos os avatares, ou de um).
- «Mostra o item da legenda da Birdie» · a prévia, os problemas que o revisor achou e as opções.
- «Publica mesmo assim» / «Pede para refazer com mais luz no rosto» / «Aprova» · a mesma decisão dos botões do Telegram.
- «Pede 2 fotos da Birdie tomando café na varanda» · o Claude mostra o custo e **só confirma depois do seu sim** (são sempre 2 passos, como o «Confirmar · US$ X» do Telegram).
- «Quanto já gastei este mês?» · o gasto do mês contra o seu limite e a fila de cada avatar.

O Telegram continua sendo o canal oficial: o que você pede pelo Claude também aparece lá.

## Antes: a chave

Precisa da variável `MOLDE_MCP_TOKEN` no Netlify (24 ou mais letras e números; gere no Terminal do Mac com `openssl rand -hex 32`) e da migração 0019 colada. Passo a passo: `docs/ATUALIZACAO_0019.md`, passos 1 e 2.

## Ligar no Claude (site e app)

1. Abra o Claude (https://claude.ai ou o app) → **Configurações** (Settings) → **Conectores** (Connectors).
2. Toque em **Adicionar conector personalizado** (Add custom connector).
3. **Nome:** `Molde`.
4. **URL:** `https://SEU-SITE/api/mcp?chave=SUA-CHAVE`
   - `SEU-SITE` é o endereço do UaiFlow (o mesmo do `APP_BASE_URL`, ex.: `uaiflow-divinetones.netlify.app`);
   - `SUA-CHAVE` é o valor do `MOLDE_MCP_TOKEN`.
   - Não preencha nada em «Configurações avançadas» (OAuth): a chave já vai no endereço.
5. **Adicionar**. Numa conversa nova, no botão de ferramentas (+ ou o ícone de conectores), confira que **Molde** está ligado.
6. Teste: «Molde: o que está na fila?».

**Cuidado:** o endereço com a chave é como uma senha. Não mande para ninguém nem cole em lugar público. Se vazar, troque o `MOLDE_MCP_TOKEN` no Netlify (publique de novo) e atualize o conector.

## No Claude Code (no Mac)

```bash
claude mcp add --transport http molde https://SEU-SITE/api/mcp --header "Authorization: Bearer SUA-CHAVE"
```

## As ferramentas (o que o Claude vê)

| Ferramenta | O que faz | Gasta? |
|---|---|---|
| `ver_fila` | a fila (filtros: avatar, estado) | não |
| `ver_item` | um item com a prévia, os achados do revisor e as opções | não |
| `pedir` | `/reel` ou `/fotos` (comando, texto, n, avatar): cria o pedido **como rascunho** e devolve o custo e o id | **não** |
| `confirmar` | o 2º passo, com o id do `pedir`: põe na fila (a página faz quando abrir naquele avatar) | sim (o custo mostrado) |
| `decidir` | aprovar · refazer (com o motivo) · corrigir · publicar (= «Publicar mesmo assim») · gravar · nao-gravar · cancelar | não |
| `status_do_mes` | gasto do mês x limite (`MOLDE_TETO_USD`) e a fila por avatar | não |

As regras são as mesmas do Telegram (o mesmo código): o rascunho vale 30 minutos; confirmar de novo não pede outra vez; refazer precisa do motivo; a primeira decisão vale; «Publicar mesmo assim» é sempre do dono (o Claude é instruído a nunca escolher isso sozinho).

### Responder quem já comentou (rotas para uma próxima ferramenta)

O conector ainda **não** tem ferramenta para isto. A página do Molde (pelo robô) já pode usar as rotas
`GET /api/molde/responder-antigos` (contar, nada sai) e `POST /api/molde/responder-antigos` (confirmar com o número que o
dono viu), com o `MOLDE_API_TOKEN`: veja `docs/API_MOLDE_RESPONDER_ANTIGOS.md`. Uma ferramenta no MCP deve seguir a mesma
regra do `pedir`/`confirmar`: primeiro mostrar os números ao dono e só confirmar depois do sim dele.

## Para quem mexe no código

- Rota: `src/app/api/mcp/route.ts` (POST com JSON-RPC 2.0; GET e DELETE respondem 405). Lógica: `src/lib/mcp/molde.ts`.
- Transporte: Streamable HTTP em modo simples (cada POST recebe `application/json`; sem sessão `Mcp-Session-Id`, sem fluxo SSE). Métodos: `initialize`, `ping`, `tools/list`, `tools/call`; notificações respondem `202` sem corpo; lote (lista) aceito, até 20.
- Versões do protocolo aceitas: `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` (outra: responde a mais nova).
- Sem SDK: o JSON-RPC é pequeno e foi feito à mão (sem dependência nova), com testes em `tests/molde-mcp.test.mts`.
- Token: `Authorization: Bearer <MOLDE_MCP_TOKEN>` ou `?chave=<MOLDE_MCP_TOKEN>`. O `MOLDE_API_TOKEN` (da página) **não** abre o MCP. Sem a variável: `503 fechado`.
