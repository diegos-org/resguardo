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


## Beds24: autenticação e teste de conexão

- Recomendado: `BEDS24_REFRESH_TOKEN`, obtido após trocar o invite code. O cliente faz
  `GET /authentication/token` com o cabeçalho `refreshToken` e usa somente o `token`
  retornado nas consultas. A validade vem de `expiresIn`, com margem de renovação.
- Alternativa: `BEDS24_API_KEY` contém um token direto, nunca convite ou refresh token.
  Long life tokens são somente leitura. Com ambas configuradas, o refresh tem prioridade;
  falha de refresh não cai silenciosamente para a credencial antiga.
- Cache em memória por processo/cliente (não compartilhado entre instâncias Vercel),
  com uma renovação em andamento por cliente. Um 401 permite uma renovação/repetição do
  GET; 403, 429 e 5xx não geram essa repetição. Respostas/credenciais não são logadas.
- Configurações → Integrações → **Testar conexão com Beds24**: somente administrador,
  consulta imóveis/quartos e retorna apenas contagem ou mensagem sanitizada. Sem gravação
  no banco nem leitura de hóspedes/preços. Não valida a sincronização M3.3 nem escrita.
- Salvar a variável no ambiente do deploy e fazer um novo deploy. A presença da variável
  é exibida como **configurada**, não como conexão verificada.
- Referências oficiais consultadas em 27/09/2026:
  https://beds24.com/api/v2/apiV2.yaml e https://wiki.beds24.com/index.php/Category:API_V2.
