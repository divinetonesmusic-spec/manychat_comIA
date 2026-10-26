# UaiFlow

Plataforma open source para automacoes de Instagram em PT-BR. O UaiFlow conecta contas profissionais do Instagram, recebe webhooks da Meta e executa respostas a comentarios, DMs, links, follow-ups e publicacoes.

## Quero instalar minha propria copia

Se voce nao e programador, siga este documento do inicio ao fim:

**[Guia completo para um novo proprietario](docs/GUIA_COMPLETO_NOVO_PROPRIETARIO.md)**

Cada instalacao usa banco, credenciais e conta do Instagram proprios; nenhum dado do dono anterior e copiado.

## Stack

- Next.js App Router e TypeScript
- Tailwind CSS
- Supabase Auth e Postgres
- Netlify (site no ar) e Cloudflare R2 (mídia)
- Meta/Instagram Graph API com Instagram Login

## Instalacao tecnica resumida

```bash
npm install
cp .env.example .env.local
npm run setup:check
npm run db:migrate
npm run dev
```

No Windows PowerShell, use `Copy-Item .env.example .env.local`. Acesse `http://127.0.0.1:3000`.

## Comandos

```bash
npm run dev           # desenvolvimento local
npm run build         # build de producao
npm run start         # inicia o build local
npm run lint          # lint
npm run setup:check   # valida variaveis de ambiente
npm run db:migrate    # aplica migrations pendentes
npm run db:status     # mostra migrations aplicadas/pendentes
npm run release:check # verifica o pacote antes de publicar
```

`npm run db:apply` continua disponivel como alias de `db:migrate`.

## Documentacao

- [Guia completo para novo proprietario](docs/GUIA_COMPLETO_NOVO_PROPRIETARIO.md)
- [Manual de uso](docs/MANUAL_DE_USO.md)
- [Instalacao tecnica](docs/INSTALLATION.md)
- [Supabase e migrations](docs/SUPABASE.md)
- [Meta e Instagram](docs/META_INSTAGRAM.md)
- [Netlify](docs/NETLIFY.md)
- [Onboarding](docs/ONBOARDING.md)
- [Transferencia](docs/TRANSFER.md)
- [Checklist de release](docs/RELEASE_CHECKLIST.md)
- [Avisos no Telegram, monitor e cópia do banco](docs/AVISOS_E_COPIA.md)
- [Música do Instagram nos Reels (Login do Facebook, migração 0009)](docs/musica-instagram.md)
- [Outras redes (Facebook/Página, Threads, YouTube Shorts) e vendas por webhook (migração 0010)](docs/redes-e-vendas.md)
- [Escada de vendas: página do produto, upsell/downsell/assinatura, obrigado, depoimentos, pré-venda e destino do post (migração 0011)](docs/vendas-escada.md)
- [Vendas por post, mais 10 plataformas de venda (Hotmart, Kiwify, Eduzz, Monetizze, Braip, Ticto, Perfect Pay, Digistore24, ClickBank, Lemon Squeezy) e a sequência de DM (migração 0012)](docs/ATUALIZACAO_0012.md)
- O que a página do Molde v132 manda (sequência de DM, campo por campo): [docs/MOLDE_V132_PAGINA.md](docs/MOLDE_V132_PAGINA.md)
- [A fila única do Molde e o Telegram para aprovar e pedir (/reel, /fotos, /status) (migração 0016)](docs/ATUALIZACAO_0016.md) · contrato: [docs/API_MOLDE_FILA.md](docs/API_MOLDE_FILA.md)
- [O quiz do avatar (/q/), a página de entrega do material grátis (/e/) e a Lista própria de e-mails (migração 0013)](docs/ATUALIZACAO_0013.md)
- [O orquestrador do Molde e o Molde no Claude (conector MCP) (migração 0019)](docs/ATUALIZACAO_0019.md) · contrato: [docs/API_MOLDE_ORQUESTRADOR.md](docs/API_MOLDE_ORQUESTRADOR.md) · conector: [docs/MOLDE_MCP.md](docs/MOLDE_MCP.md)
- Atualizações do banco: [0003 e 0004](docs/ATUALIZACAO_0003_0004.md), [0005](docs/ATUALIZACAO_0005.md), [0006](docs/ATUALIZACAO_0006.md), [0007](docs/ATUALIZACAO_0007.md), [0008](docs/ATUALIZACAO_0008.md), [0012](docs/ATUALIZACAO_0012.md), [0013](docs/ATUALIZACAO_0013.md), [0016](docs/ATUALIZACAO_0016.md), [0019](docs/ATUALIZACAO_0019.md)
- API da fila de trabalho do Molde (para o robô do Mac e a página): [docs/API_MOLDE_JOBS.md](docs/API_MOLDE_JOBS.md)

## Segredos

Nunca envie ao GitHub `.env.local`, tokens do Instagram, `DATABASE_URL`, chaves secretas do Supabase, `INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_SECRET` ou segredos de worker/sessao. Confira `npm run release:check` antes de publicar.

Revisão de segurança da versão 133 (o que foi corrigido e o que o dono precisa fazer): [docs/SEGURANCA_V133.md](docs/SEGURANCA_V133.md). Banco: [0015](docs/ATUALIZACAO_0015.md).

## Licenca

MIT. Consulte [LICENSE](LICENSE).