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
