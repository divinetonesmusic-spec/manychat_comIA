# Testes do UaiFlow

Os testes usam o executor que já vem no Node (`node --test`) e o `tsx` (só para desenvolvimento) para ler TypeScript e os atalhos `@/` do projeto. Nenhum teste fala com a internet: a Meta (Instagram), o login do Instagram e o R2 são simulados por um `fetch` falso (`tests/helpers/fake-meta.mts`), que recusa qualquer outro endereço.

## Rodar só os testes rápidos (sem banco)

```bash
npm test
```

Os testes que precisam de Postgres aparecem como `# SKIP sem TEST_DATABASE_URL`. Os de unidade rodam normalmente.

## Rodar tudo (com Postgres local)

1. Tenha um Postgres 14 ou mais novo rodando no computador (por exemplo, o Postgres.app no Mac, ou `brew install postgresql@16`).
2. Use um usuário que possa criar bancos (no Postgres.app, o seu próprio usuário já pode).
3. Rode:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm test
```

Cada arquivo de teste cria um banco novo e vazio (`uaiflow_teste_...`), aplica `supabase/migrations/*.sql` em ordem, roda e apaga o banco no fim. O banco apontado em `TEST_DATABASE_URL` não é alterado. **Nunca** use o endereço do Supabase de produção aqui.

Se o Postgres local não tiver SSL (o normal), o teste já liga `sslmode=disable` sozinho.

## Onde fica cada coisa

- `tests/helpers/env.mts`: variáveis falsas (nada é segredo real).
- `tests/helpers/db.mts`: cria o banco de teste e aplica as migrações. `createTestDatabase({ ate: "0002" })` simula um Supabase em que a 0003 ainda não foi colada.
- `tests/helpers/fake-meta.mts`: Meta/Instagram/R2 falsos, com contagem de chamadas (ex.: quantas vezes o `media_publish` foi chamado) e opção de simular o corte do Netlify logo depois de a Meta publicar.
- `tests/*.test.mts`: os testes.
