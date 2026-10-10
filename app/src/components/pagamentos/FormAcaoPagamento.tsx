"use client";

import { type ReactNode, startTransition, useActionState, useRef } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
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
  /**
   * Nome do campo em reais cujo valor digitado entra na pergunta, no lugar de `{valor}` (ex.: "R$ 1.806,00"), na hora
   * do clique: quem confirma vê o valor que vai ser gravado.
   */
  valorNaPergunta?: string;
  /** Nome do campo de data (AAAA-MM-DD) cujo valor entra na pergunta no lugar de `{data}` (dd/mm/aaaa), na hora do clique. */
  dataNaPergunta?: string;
  /** Botão secundário (ações raras ou de correção). */
  discreto?: boolean;
  children?: ReactNode;
};

/**
 * Um formulário de ação do pagamento no site (M8.2a): campos, o botão (com confirmação quando mexe em dinheiro) e a
 * mensagem que o servidor devolveu — de sucesso ou a recusa do domínio, como veio. Envia pelo `onSubmit` (não pelo
 * `action` do formulário) para o React não limpar os campos: numa recusa, o que foi digitado continua ali para corrigir.
 */
export function FormAcaoPagamento({ acao, rotulo, nome, pagamentoId, pergunta, valorNaPergunta, dataNaPergunta, discreto, children }: Props) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  const formulario = useRef<HTMLFormElement>(null);
  const classe = discreto ? styles.pequeno : undefined;
  const perguntaComValor = () => {
    if (!pergunta || !formulario.current) return pergunta ?? "";
    const dados = new FormData(formulario.current);
    let texto = pergunta;
    if (valorNaPergunta) {
      const bruto = String(dados.get(valorNaPergunta) ?? "").trim();
      const centavos = reaisParaCentavos(bruto);
      texto = texto.replace("{valor}", typeof centavos === "number" ? formatBRL(centavos) : `"${bruto}"`);
    }
    if (dataNaPergunta) {
      const data = String(dados.get(dataNaPergunta) ?? "").trim();
      texto = texto.replace("{data}", /^\d{4}-\d{2}-\d{2}$/.test(data) ? data.split("-").reverse().join("/") : `"${data}"`);
    }
    return texto;
  };
  return (
    <form
      ref={formulario}
      aria-label={nome}
      className={styles.linha}
      style={{ alignItems: "flex-end", margin: 0 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        const dados = new FormData(ev.currentTarget);
        startTransition(() => enviar(dados));
      }}
    >
      {pagamentoId && <input type="hidden" name="pagamentoId" value={pagamentoId} />}
      {children}
      <div className={discreto ? undefined : styles.acoes}>
        {pergunta ? (
          <BotaoConfirmar pergunta={valorNaPergunta || dataNaPergunta ? perguntaComValor : pergunta} disabled={enviando} className={classe}>
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
