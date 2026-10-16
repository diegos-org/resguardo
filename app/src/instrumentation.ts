import * as Sentry from "@sentry/nextjs";
import { avisoDoSentryDesligado, opcoesDoSentry } from "./observabilidade/sentry";

/**
 * Avisos de erro do servidor pelo Sentry (M0.9), no Node e no Edge. Os erros que escapam para o Next (páginas, ações e
 * rotas da API) chegam pelo `onRequestError`; os que o próprio código pega e responde com 500 ou registra (as rotinas
 * automáticas e o aviso do Mercado Pago) são avisados por `src/observabilidade/aviso-do-servidor.ts`. As opções (e a
 * regra de quando liga) ficam em `src/observabilidade/sentry.ts`; aqui só se liga. Sem `NEXT_PUBLIC_SENTRY_DSN`, ou fora
 * da produção e das prévias da Vercel, nada é ligado nem enviado; um endereço estranho deixa um aviso no registro do
 * servidor (sem o valor) e aparece como problema na página Sistema.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs" && process.env.NEXT_RUNTIME !== "edge") return;
  const variaveis = {
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  };
  const opcoes = opcoesDoSentry(variaveis);
  if (opcoes) {
    Sentry.init(opcoes);
    return;
  }
  const aviso = avisoDoSentryDesligado(variaveis);
  if (aviso) console.warn(aviso);
}

/** Erros que o Next captura ao atender um pedido (renderização, ações, rotas da API). Sem o Sentry ligado, não faz nada. */
export const onRequestError = Sentry.captureRequestError;
