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
- Vercel
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
- [Vercel](docs/VERCEL.md)
- [Onboarding](docs/ONBOARDING.md)
- [Transferencia](docs/TRANSFER.md)
- [Checklist de release](docs/RELEASE_CHECKLIST.md)
- [Avisos no Telegram, monitor e cópia do banco](docs/AVISOS_E_COPIA.md)

## Segredos

Nunca envie ao GitHub `.env.local`, tokens do Instagram, `DATABASE_URL`, chaves secretas do Supabase, `INSTAGRAM_APP_SECRET` ou segredos de worker/sessao. Confira `npm run release:check` antes de publicar.

## Licenca

MIT. Consulte [LICENSE](LICENSE).