import * as Sentry from "@sentry/nextjs";

/** Quanto o envio pode esperar antes de a função da Vercel terminar (sem o `withSentryConfig`, nada esvazia a fila sozinho). */
export const PRAZO_DO_ENVIO_MS = 2000;

/**
 * Avisa o Sentry de um erro que o próprio código pegou no servidor (M0.9): as rotinas automáticas e o aviso do Mercado
 * Pago respondem 500 ou registram o erro em vez de deixá-lo escapar, então o `onRequestError` de `src/instrumentation.ts`
 * não os vê. `rotina` é o nome da automação em Sistema (por exemplo "agenda-diaria"), para achar o aviso. O aviso passa
 * pela limpeza de `./limpeza.ts` antes de sair e espera até `PRAZO_DO_ENVIO_MS` pelo envio. Sem o Sentry ligado (sem
 * `NEXT_PUBLIC_SENTRY_DSN`, no desenvolvimento e nos testes), não faz nada. Nunca lança: o aviso não muda o que a rotina
 * responde nem o que ela registra.
 */
export async function avisarErroDoServidor(erro: unknown, rotina: string): Promise<void> {
  try {
    Sentry.captureException(erro, { tags: { rotina } });
    await Sentry.flush(PRAZO_DO_ENVIO_MS);
  } catch {
    // O aviso é um extra: a resposta e o registro em Sistema seguem iguais.
  }
}
