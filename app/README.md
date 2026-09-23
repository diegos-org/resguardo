# SCL — aplicativo

Next.js (App Router) + TypeScript. Node 22+.

```sh
cd app
npm ci
npm run dev        # http://localhost:3000
npm test           # Vitest
npm run lint
npm run typecheck
npm run build
```

- Código em `src/`. Utilitários de domínio em `src/lib/` (ex.: `money.ts`, valores em centavos).
- Testes ficam ao lado do código (`*.test.ts`) ou em `__tests__/`. Componentes React usam
  `// @vitest-environment jsdom` na primeira linha.
- `GET /api/health` responde `{ ok: true }` — usado para conferir deploys.
- Na Vercel, o *Root Directory* do projeto é `app`.

## Banco de dados (Drizzle + Neon)

- Esquema em `src/db/schema.ts`; migrações geradas em `drizzle/` com `npm run db:generate`.
- Aplicar migrações no Neon: `DATABASE_URL=... npm run db:migrate`.
- Código do app usa `getDb()` (`src/db/client.ts`), que lê `DATABASE_URL`.
- Testes usam `createTestDb()` (`src/db/testing.ts`): Postgres em memória (PGlite) com
  todas as migrações aplicadas — sem rede nem credenciais.

## Login (Auth.js + Google)

- Variáveis: ver `.env.example` (`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ADMIN_EMAILS`).
- Sem essas variáveis o login fica desligado e `/painel` redireciona para `/entrar`.
- Só entra quem está cadastrado e ativo em `usuarios`; e-mails em `ADMIN_EMAILS` são criados
  como admin no primeiro login. O painel aceita os papéis admin e operação.
- Toda página do painel chama `exigirSessaoPainel()` no servidor.

## Rodar no computador com dados fictícios

Precisa de um Postgres local (ex.: `postgres://usuario@localhost:5432/scl_dev`).

```sh
export DATABASE_URL=postgres://usuario@localhost:5432/scl_dev
npm run db:migrate
SCL_DEMO_EMAIL=dev@example.com npm run db:semear-demo   # 6 imóveis, proprietários, contratos e reservas fictícios
SCL_DEV_EMAIL=dev@example.com npm run dev               # entra direto como esse usuário (só em `next dev`)
```

- `SCL_DEV_EMAIL` só funciona com `next dev` (NODE_ENV=development); em produção/Vercel é ignorado.
- `db:semear-demo` só roda em banco local, ou no Neon de homologação com `SEMEAR_CONFIRMO=homologacao`,
  e não faz nada se já houver imóveis cadastrados.
