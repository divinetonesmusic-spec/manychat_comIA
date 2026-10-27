# API das páginas de venda do Molde (`/api/molde/paginas` e `/v/<slug>`, migração 0020)

Para quem for ligar o lado do **Molde** (a Fábrica gera `pagina-para-subir.html`; a página do Molde manda para o UaiFlow pelo robô
do Mac, `uaiflow {op:'chamar'}`). Molde v137, etapa K12. Precisa da migração 0020 (`docs/ATUALIZACAO_0020.md`).

## A ideia

- A Fábrica continua gerando a página de venda como **um arquivo HTML só** (com as imagens embutidas, em `data:`).
- Em vez de o dono subir o arquivo no Cloudflare à mão, a página do Molde manda o HTML para `POST /api/molde/paginas`.
- O UaiFlow guarda o HTML **privado no R2** (`uaiflow/paginas/<id>.html`; sem o R2 configurado, no banco) e abre em
  **`https://<site do UaiFlow>/v/<slug>`** (ou `https://<domínio próprio>/v/<slug>`, veja «Usar o seu próprio domínio» na 0020).
- O HTML roda **isolado**: o navegador trata a página como de uma origem própria e vazia (CSP `sandbox` sem `allow-same-origin`).
  Ela não lê os cookies nem o armazenamento do UaiFlow e não chama as rotas do painel com o login do dono.

## Regras gerais

- Tudo em JSON, com `x-molde-token: <MOLDE_API_TOKEN>` (ou `Authorization: Bearer <MOLDE_API_TOKEN>`).
- Erros: `{"error": "<frase em português>", "codigo": "<código>"}`.

| status | `codigo` | quando |
|---|---|---|
| 400 | `pedido_invalido` | corpo errado (a frase diz o campo) |
| 400 | `conta` | o `accountId` não existe no UaiFlow |
| 401 | `token_invalido` | token errado ou faltando |
| 404 | `nao_achou` | `id` que não existe (ou é de outro projeto) |
| 413 | `grande_demais` | HTML acima de **5 MB** (5 242 880 bytes, contados em UTF-8). A frase diz o tamanho e pede imagens menores |
| 502 | `armazenamento` | o R2 não guardou agora (mande de novo: a página nova não fica no ar até dar certo) |
| 503 | `falta_0020` | a migração 0020 não foi colada |
| 503 | `fechado` | o servidor está sem `MOLDE_API_TOKEN` |
| 500 | `passageiro` | tente de novo |

O limite de 5 MB existe porque o Netlify recusa pedidos acima de ~6 MB (e o JSON é um pouco maior que o HTML). Para caber, a
Fábrica deve embutir as imagens em JPG ou WEBP (não PNG) com uns 1200 px de largura.

## Rotas

### Criar ou atualizar — `POST /api/molde/paginas`

```json
{ "titulo": "Oração da manhã — 7 dias", "html": "<!doctype html>…", "molde": "birdie",
  "id": "2b6c0d6e-8a51-4c41-9a39-7c1d1c1b0f10", "slug": "oracao-da-manha", "accountId": "…", "publicada": true }
```

| campo | obrigatório | regra |
|---|---|---|
| `titulo` | sim | texto, 1–200 letras |
| `html` | sim | o arquivo inteiro, texto, até 5 MB |
| `molde` | sim | o projeto do Molde: letras, números, `_ . : -` (1–80) |
| `id` | não | o `id` que o UaiFlow devolveu antes: atualiza **essa** página (de outro projeto → 404 `nao_achou`) |
| `slug` | não | o nome no endereço. É limpo (sem acento, minúsculo, espaços viram `-`) e precisa ficar com 3–60 letras/números/hífen. Sem ele, sai do título |
| `accountId` | não | a conta do Instagram do UaiFlow ligada à página (uuid) |
| `publicada` | não | `true` (padrão) põe no ar; `false` guarda sem pôr no ar (rascunho) |

Como acha a página:
1. com `id`: a página desse id no mesmo `molde`;
2. sem `id`: a página do mesmo `molde` com o mesmo `slug` (o mandado, ou o que sai do título);
3. não achou: cria. Se outro projeto já usa o endereço, o novo ganha `-2`, `-3`… (o `slug` da resposta é o que vale).

Mudar o `slug` de uma página que já existe (com o `id`) troca o endereço; o antigo deixa de abrir.

Resposta: **201** (criada) ou **200** (atualizada):

```json
{ "id": "2b6c0d6e-…", "slug": "oracao-da-manha", "url": "https://uaiflow-divinetones.netlify.app/v/oracao-da-manha",
  "tamanho": 1834221, "publicada": true, "criada": true }
```

O começo da `url` é o `PAGINAS_BASE_URL` do Netlify (opcional, o domínio próprio do dono, ex.: `https://oracaodamanha.com.br`)
ou, sem ele, o endereço do UaiFlow (`APP_BASE_URL`). A página abre nos dois.

Guarde o `id` no projeto do Molde: é o jeito certo de atualizar a mesma página depois.

### Listar — `GET /api/molde/paginas?molde=<projeto>`

`200 {"data": [<página>]}`, as 100 mais recentes do projeto (também as fora do ar):

```json
{ "id": "…", "slug": "oracao-da-manha", "url": "https://…/v/oracao-da-manha", "titulo": "Oração da manhã — 7 dias",
  "molde": "birdie", "accountId": null, "tamanho": 1834221, "armazenamento": "r2", "publicada": true,
  "publicadaEm": "2026-10-27T13:00:00.000Z", "criadoEm": "…", "atualizadoEm": "…" }
```

Sem `molde`: 400 `pedido_invalido`.

### Tirar do ar — `DELETE /api/molde/paginas/<id>[?molde=<projeto>]`

`200 {"id", "slug", "url", "publicada": false}`. O endereço passa a responder «Página não encontrada». O conteúdo continua
guardado: um `POST` com o mesmo `id` (e `publicada` true ou sem ela) põe de volta. Com `?molde=`, só tira se for desse projeto.
Erros: 404 `nao_achou` (id que não existe, ou de outro projeto); 400 `pedido_invalido` (`molde` inválido).

## A página pública — `GET /v/<slug>` (e `HEAD`)

- **200** com o HTML guardado, `content-type: text/html; charset=utf-8` e:

  | cabeçalho | valor |
  |---|---|
  | `Content-Security-Policy` | `sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation; frame-ancestors 'none'` |
  | `X-Content-Type-Options` | `nosniff` |
  | `X-Frame-Options` | `DENY` |
  | `Referrer-Policy` | `strict-origin-when-cross-origin` |
  | `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), usb=(), payment=()` |
  | `Cache-Control` | `public, max-age=60` (uma atualização ou um «tirar do ar» chega a todos em até 1 minuto) |

- **404** (HTML curto em português, «Página não encontrada») quando não existe, não está no ar ou falta a 0020. **503** («Tente de
  novo em instantes») se o banco ou o R2 falharem.
- Não precisa de login (é pública, como `/q`, `/e`, `/a` e `/l`).

### O que funciona dentro da página (e o que não)

- **Funciona:** os scripts da página (contagem regressiva, perguntas, abrir/fechar), os formulários, as fontes e imagens de fora
  (Google Fonts, `data:`), os **links de checkout**: com `target="_blank"` abrem numa aba nova normal (fora do isolamento:
  `allow-popups-to-escape-sandbox`); sem `target`, o toque leva a página inteira ao checkout.
- **O link rastreado `/l/<código>` continua funcionando:** um link `href="/l/abc123?de=bio"` (ou o endereço completo do UaiFlow)
  conta o clique e leva ao checkout, igual a qualquer outro lugar.
- **Não funciona** (de propósito): `localStorage`, `sessionStorage`, cookies e `fetch` com o login do UaiFlow (a página tem uma
  origem vazia). Se a página precisar lembrar algo, use a URL (`?…`) ou o checkout. Abrir a página dentro de um `<iframe>` de outro
  site também não funciona (`frame-ancestors 'none'`).
- Um script que navega **sozinho** (sem toque, ex.: redirecionar depois de 5 s) não muda a página inteira; links e botões tocados
  pela pessoa, sim.

## O que o Molde faz (sugestão para a v137 do Molde)

1. Depois da Fábrica gerar `pagina-para-subir.html`: `POST /api/molde/paginas {titulo, html, molde, id?: <o id guardado>}`.
2. Guardar `id`, `slug` e `url` no projeto; mostrar a `url` com «Abrir» e «Copiar».
3. 413: mostrar a frase e pedir à Fábrica imagens menores. 503 `falta_0020`: mostrar a frase (o dono cola a 0020). 502/500:
   tentar de novo depois (a página fica guardada como antes, no Mac).
4. «Tirar do ar»: `DELETE /api/molde/paginas/<id>?molde=<projeto>`.
