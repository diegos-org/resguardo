"use client"; // As páginas de erro do Next são componentes de cliente.

import Link from "next/link";
import styles from "@/components/painel/painel.module.css";
import { useAvisoDeErro } from "@/observabilidade/aviso-de-erro";

/**
 * Erro inesperado numa tela do painel (M7.8): dentro da moldura do painel, com "tente de novo" e o código do erro (que
 * ajuda a achar o registro do que aconteceu, sem mostrar o detalhe na tela). Texto fixo: o erro pode ser o próprio banco.
 * O erro vai para o Sentry, sem dados pessoais (M0.9).
 */
export default function ErroNoPainel({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useAvisoDeErro(error);
  return (
    <>
      <h1>Algo não saiu como esperado</h1>
      <section className={styles.cartao}>
        <p style={{ marginTop: 0 }}>Esta tela não abriu agora. Tente de novo em instantes.</p>
        {error.digest && <p className={styles.muted}>Se o problema continuar, este código ajuda a encontrar o que aconteceu: {error.digest}</p>}
        <p style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 0 }}>
          <button type="button" onClick={() => retry()}>
            Tentar de novo
          </button>
          <Link href="/painel">Voltar ao início do painel</Link>
        </p>
      </section>
    </>
  );
}
