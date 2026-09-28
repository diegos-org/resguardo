"use client";

import { useActionState } from "react";
import { testarConexaoBeds24 } from "@/beds24/acoes";
import styles from "@/components/formularios.module.css";

export function TestarBeds24() {
  const [resultado, acao, pendente] = useActionState(testarConexaoBeds24, null);
  return (
    <form action={acao}>
      <p>Confira o acesso aos imóveis no Beds24. O teste só faz leitura e não importa reservas.</p>
      <button className={styles.botao} type="submit" disabled={pendente}>
        {pendente ? "Testando conexão…" : "Testar conexão com Beds24"}
      </button>
      <p role="status" aria-live="polite" className={resultado && !resultado.ok ? styles.erro : undefined}>
        {resultado?.mensagem}
      </p>
    </form>
  );
}
