"use client";

import { type ReactNode, useActionState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import type { EstadoAcaoPagamento } from "@/pagamentos/acoes-painel";

type Props = {
  acao: (estado: EstadoAcaoPagamento, form: FormData) => Promise<EstadoAcaoPagamento>;
  rotulo: string;
  /** Nome do formulário para leitores de tela. */
  nome: string;
  /** Tentativa a que a ação se aplica; sem ela, "Conferir agora" confere todas as pendentes da empresa. */
  pagamentoId?: string;
  /** Pergunta de confirmação: toda ação que mexe em dinheiro passa por ela. Sem pergunta, envio direto (conferir). */
  pergunta?: string;
  /** Botão secundário (ações raras ou de correção). */
  discreto?: boolean;
  children?: ReactNode;
};

/**
 * Um formulário de ação do pagamento no site (M8.2a): campos, o botão (com confirmação quando mexe em dinheiro) e a
 * mensagem que o servidor devolveu — de sucesso ou a recusa do domínio, como veio.
 */
export function FormAcaoPagamento({ acao, rotulo, nome, pagamentoId, pergunta, discreto, children }: Props) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  const classe = discreto ? styles.pequeno : undefined;
  return (
    <form action={enviar} aria-label={nome} className={styles.linha} style={{ alignItems: "flex-end", margin: 0 }}>
      {pagamentoId && <input type="hidden" name="pagamentoId" value={pagamentoId} />}
      {children}
      <div className={discreto ? undefined : styles.acoes}>
        {pergunta ? (
          <BotaoConfirmar pergunta={pergunta} disabled={enviando} className={classe}>
            {enviando ? "Aguarde…" : rotulo}
          </BotaoConfirmar>
        ) : (
          <button type="submit" disabled={enviando} className={classe}>
            {enviando ? "Conferindo…" : rotulo}
          </button>
        )}
      </div>
      {estado.mensagem && (
        <p role={estado.ok ? "status" : "alert"} className={estado.ok ? styles.sucesso : styles.alerta} style={{ flexBasis: "100%", margin: 0 }}>
          {estado.mensagem}
        </p>
      )}
    </form>
  );
}
