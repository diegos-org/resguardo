import * as Sentry from "@sentry/nextjs";
import { opcoesDoSentry } from "./observabilidade/sentry";

// Avisos de erro do navegador pelo Sentry (M0.9), ligados antes de a página ficar interativa. As opções (e a regra de
// quando liga) ficam em src/observabilidade/sentry.ts. As variáveis NEXT_PUBLIC_ entram no código na publicação: sem
// NEXT_PUBLIC_SENTRY_DSN, ou fora da produção e das prévias da Vercel, nada é ligado nem enviado.
const opcoes = opcoesDoSentry({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  ambiente: process.env.NEXT_PUBLIC_VERCEL_ENV,
  versao: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
});
if (opcoes) Sentry.init(opcoes);
