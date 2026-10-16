import * as Sentry from "@sentry/nextjs";
import { opcoesDoSentry } from "./observabilidade/sentry";

/**
 * Avisos de erro do servidor pelo Sentry (M0.9): páginas, ações, rotas da API, rotinas e webhooks, no Node e no Edge.
 * As opções (e a regra de quando liga) ficam em `src/observabilidade/sentry.ts`; aqui só se liga. Sem
 * `NEXT_PUBLIC_SENTRY_DSN`, ou fora da produção e das prévias da Vercel, nada é ligado nem enviado.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs" && process.env.NEXT_RUNTIME !== "edge") return;
  const opcoes = opcoesDoSentry({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, ambiente: process.env.VERCEL_ENV, versao: process.env.VERCEL_GIT_COMMIT_SHA });
  if (opcoes) Sentry.init(opcoes);
}

/** Erros que o Next captura ao atender um pedido (renderização, ações, rotas da API). Sem o Sentry ligado, não faz nada. */
export const onRequestError = Sentry.captureRequestError;
