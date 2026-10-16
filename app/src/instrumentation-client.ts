import * as Sentry from "@sentry/nextjs";
import { opcoesDoSentry } from "./observabilidade/sentry";

// Avisos de erro do navegador pelo Sentry (M0.9), ligados antes de a página ficar interativa. As opções (e a regra de
// quando liga, a mesma do servidor) ficam em src/observabilidade/sentry.ts. No navegador só existem as variáveis
// NEXT_PUBLIC_, que entram no código na publicação: elas fazem o papel de VERCEL_ENV e VERCEL_GIT_COMMIT_SHA. Sem
// NEXT_PUBLIC_SENTRY_DSN, ou fora da produção e das prévias da Vercel, nada é ligado nem enviado.
const opcoes = opcoesDoSentry({
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_GIT_COMMIT_SHA: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
});
if (opcoes) Sentry.init(opcoes);
