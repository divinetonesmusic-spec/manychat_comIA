# Segurança do UaiFlow — versão 133 (etapa U-SEG)

Revisão de segurança pedida pelo Nicolas: «Tokens que vão para o navegador, login do Instagram sem "state", Reel duplicado, só a conta padrão renova o token. Conferir e corrigir.» Aqui está o que foi conferido, o que mudou e o que você precisa fazer.

## O que você precisa fazer (uns 10 minutos)

1. **Colar a migração 0015 no Supabase.** Passo a passo em [ATUALIZACAO_0015.md](ATUALIZACAO_0015.md).
2. **Publicar a versão nova do site** (como sempre: juntar no `main` e esperar o Netlify ficar verde).
3. **Nada de variável nova** no Netlify. Nada de reconectar contas: as conexões que já existem continuam valendo.
4. Se um dia aparecer «O link de conexão com o Instagram venceu ou não é válido» ao conectar um perfil: comece de novo pelo botão de Perfis **no mesmo navegador** em que vai terminar (veja o item 2 abaixo). Pelo «Copiar link» (outro computador) continua funcionando: o link abre e termina no mesmo navegador.
5. (Opcional, recomendado) Confira se o Telegram está configurado (Configurações → «Enviar aviso de teste»): é por ele que chegam os avisos de token vencendo.

## O que foi conferido e corrigido

### 1. Tokens que vão para o navegador — conferido; 2 vazamentos pequenos corrigidos

Já estava protegido desde a U-SEG-01: as telas e as respostas da API nunca levam o token do Instagram, do Facebook, do Threads ou do YouTube (há teste que sobe o site de verdade e procura os tokens no HTML). A única chave que vai para o navegador é a pública do Supabase (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), que só serve para o login. A chave secreta do Supabase (`SUPABASE_SERVICE_ROLE_KEY`), o `WORKER_SECRET`, o `MOLDE_API_TOKEN`, as chaves do R2 e os segredos de venda só existem no servidor.

Corrigido agora:
- **Respostas da Meta repassadas inteiras** (`/api/media` e a leitura do menu/iniciadores em Perfis): a Meta devolve um "próxima página" com o token dentro do endereço. Agora só a lista vai para o navegador.
- **Mensagens de erro**: o erro do login do Instagram, da lista de posts e da renovação passam por um filtro que apaga qualquer pedaço de token ou segredo antes de ir para a tela, o log ou o Telegram.
- **Banco fechado para a chave pública** (migração 0015): mesmo tendo a chave pública, ninguém consegue ler as tabelas do UaiFlow pela API do Supabase. Antes já era assim pela proteção por linha (RLS, ligada em todas as tabelas); agora há uma segunda trava, e a tabela de controle das migrações também ficou protegida.

### 2. Login do Instagram sem "state" — reforçado

O `state` já existia (assinado, vence em 30 min). Faltava **prender o login ao navegador**: um `state` válido podia ser usado em outro navegador. Agora:
- ao tocar em Conectar, o UaiFlow grava um cookie secreto (que o JavaScript da página não lê, só vai em navegação comum e vence em 30 min) com o resumo do número aleatório do `state`;
- na volta do Instagram, o `state` só vale se o cookie do mesmo navegador bater; o cookie é apagado em seguida (uso único);
- sem isso, o código do Instagram nem é trocado.
- **PKCE:** o Login do Instagram que o UaiFlow usa (`instagram.com/oauth/authorize`) não documenta PKCE; por isso não foi ligado (ligar sem a Meta aceitar quebraria a conexão). Facebook, Threads e YouTube já tinham o `state` em cookie.

### 3. Reel duplicado — corrigido

As travas de antes (da 0003) já impediam a mesma linha de post de sair duas vezes. Faltava o caso **«post apagado do UaiFlow e o Molde manda o mesmo item de novo»**, que virava um 2º Reel, e dois envios simultâneos do mesmo item davam erro 500. Agora:
- **trava no banco**: tabela `content_refs_publicadas` com chave única (perfil + referência do item no Molde). Ela fica guardada mesmo se o post for apagado;
- **conferência no relógio**: antes de criar o vídeo na Meta e de novo logo antes de publicar, o relógio reserva a referência; se ela já é de outro post, não publica (o post fica «Com erro» explicando);
- o Molde recebe **409 «Este item já foi publicado»** se mandar de novo um item que já saiu;
- dois envios do mesmo item ao mesmo tempo: um post só, sem erro 500.
- A fila de trabalho do Molde (`/api/molde/jobs`) já não duplicava (chave única projeto + tipo + ref).

### 4. Renovação do token — todas as contas, no relógio, com aviso

O `/api/token/refresh` já renovava todas as contas, mas **uma vez por semana e todas numa função só** (o Netlify corta em ~10 s: com várias contas, as últimas podiam ficar sem renovar), e o botão «Renovar a conexão» de Configurações não funcionava (dava «Não autorizado»). Agora:
- o **relógio de cada minuto** renova, no tempo que sobrar, as conexões que precisam: **todas as contas do Instagram** (não só a padrão), as conexões pelo Facebook (música) e as do Threads. Uma por vez, as que vencem antes primeiro; renova quando o token tem mais de 7 dias; se der erro, tenta de novo em 6 h;
- **aviso no Telegram** quando a renovação falha ou falta menos de 10 dias para vencer (no máximo 1 aviso por conexão a cada 24 h);
- o botão **«Renovar a conexão»** funciona (renova todos os perfis e mostra o resultado na tela). Ele só aceita pedido feito pela própria tela (um site de fora não consegue disparar);
- o agendamento semanal do `supabase/cron.sql` continua, como reserva.

### 5. Outros achados

Corrigidos:
| Gravidade | Achado | O que mudou |
|---|---|---|
| Média | **SSRF** no envio para o YouTube: o servidor baixava o vídeo de qualquer endereço do post (inclusive da rede interna, ex.: `169.254.169.254`). | Só baixa de endereço público (o R2 passa direto); recusa localhost, IPs internos (também via DNS), usuário/senha no endereço e não segue redirecionamentos. |
| Baixa | Endereços de `/api` terminados em `.png`/`.svg`/`.jpg` pulavam a conferência de sessão (regra das imagens do proxy). | As imagens continuam abertas, mas dentro de `/api` tudo passa pela conferência. |
| Baixa | Redirecionamento do `/l/<código>`: o destino só era conferido ao criar o link. | Conferido de novo a cada clique: só `https://`, sem usuário/senha no endereço. |
| Baixa | Botão «Renovar a conexão» como link GET. | Virou formulário POST com conferência de origem. |

Conferidos e já certos: comparação de segredos em tempo constante (worker, Molde, webhook da Meta, Telegram, vendas, sessão de administrador), assinatura do webhook do Instagram, limite de 5 tentativas da senha de administrador, `next=` só com caminho interno, RLS ligado em todas as tabelas, Facebook/Threads/YouTube com `state` em cookie.

Ficam para depois (não corrigidos agora, para não mexer em áreas que outras frentes estão mudando):
| Gravidade | Achado | Sugestão |
|---|---|---|
| Média | `/p/<produto>/obrigado/email` é público e sem limite: dá para cadastrar e-mails de terceiros, que depois recebem o pedido de depoimento (abuso do envio de e-mail). | Limite por IP (como o da senha de administrador) e confirmar o e-mail antes de pedir depoimento. A frente da 0013 (entrega) mexe nesse fluxo. |
| Baixa | Formulário público do depoimento (upload de print) e cliques do `/l/` sem limite por IP. | Limite por IP numa tabela pequena. |
| Baixa | A sessão de administrador vale 30 dias e «Sair» não derruba cópias do cookie; o segredo da sessão usa o `WORKER_SECRET` quando falta o `ADMIN_SESSION_SECRET`. | Manter `ADMIN_SESSION_SECRET` próprio no Netlify (já é o recomendado); trocar o segredo derruba todas as sessões. |
| Baixa | Tokens guardados no banco sem criptografia própria (protegidos pelo acesso ao banco e pelo RLS). | Criptografar as colunas de token com uma chave do servidor, se um dia o banco for compartilhado. |
| Baixa | DNS rebinding no download do YouTube (entre a conferência e o download). | Baixar só do R2 (`R2_PUBLIC_BASE_URL`) para o YouTube. |

## Por dentro (para quem mexer no código)

- State do Instagram: `src/lib/oauth-state.ts` (`setInstagramStateCookie`, `verifyInstagramCallbackState`, cookie `uaiflow_ig_state`, caminho `/api/oauth`).
- Reel duplicado: `src/lib/db/refs-publicadas.ts`; usado em `src/lib/content/scheduler.ts` (`startPost`, ramo `FINISHED` do `advancePost`, `finishPublished`) e `src/lib/content/service.ts` (`savePostPackage`).
- Renovação no relógio: `src/lib/instagram/token-clock.ts` (estado em `public.app_status`, chaves `tokens_relogio` e `token:<tipo>:<conta>`), chamado em `src/app/api/queue/drain/route.ts`; prazo das chamadas à Meta por `withMetaDeadline` (`src/lib/instagram/client.ts`).
- SSRF: `src/lib/net/url-segura.ts`, usado em `src/lib/redes/youtube.ts`.
- Filtro de segredos: `redactSecrets` em `src/lib/secrets.ts`.
- Testes: `tests/oauth.test.mts`, `tests/reel-duplicado*.test.mts`, `tests/token-relogio.test.mts`, `tests/seguranca-v133.test.mts`, `tests/html/seguranca-v133.test.mts`.
