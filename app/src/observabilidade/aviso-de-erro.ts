import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Avisa o Sentry do erro que uma página de erro está mostrando (M0.9), sem mudar o que a pessoa vê. Sem o Sentry ligado
 * (sem `NEXT_PUBLIC_SENTRY_DSN`, no desenvolvimento e nos testes), não faz nada. O aviso passa pela limpeza de
 * `./limpeza.ts` antes de sair. O código do erro (digest) vai junto: é o mesmo que a tela mostra e que ajuda a achar o
 * registro do servidor.
 */
export function useAvisoDeErro(erro: Error & { digest?: string }): void {
  useEffect(() => {
    Sentry.captureException(erro, erro.digest ? { tags: { digest: erro.digest } } : undefined);
  }, [erro]);
}
