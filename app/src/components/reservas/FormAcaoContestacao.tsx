"use client";

import { type ReactNode, startTransition, useActionState, useRef } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
import type { EstadoContestacaoPainel } from "@/pagamentos/acoes-contestacao";

export type AcaoContestacao = (estado: EstadoContestacaoPainel, form: FormData) => Promise<EstadoContestacaoPainel>;

type Props = {
  acao: AcaoContestacao;
  rotulo: string;
  /** Nome do formulário para leitores de tela. */
  nome: string;
  /** A disputa a que a ação se aplica (o servidor a resolve na empresa da sessão). */
  contestacaoId?: string;
  /** O pagamento (o registro da disputa pela equipe). */
  pagamentoId?: string;
  /**
   * A pergunta do BotaoConfirmar, montada no servidor: toda ação da disputa mexe em dinheiro ou fica registrada. `{valor}` e
   * `{data}` recebem, na hora do clique, o que foi digitado nos campos `valorNaPergunta` (reais) e `dataNaPergunta`
   * (AAAA-MM-DD); `{opcao}`, o texto da opção escolhida no campo `opcaoNaPergunta`.
   */
  pergunta: string;
  valorNaPergunta?: string;
  dataNaPergunta?: string;
  opcaoNaPergunta?: { campo: string; textos: Readonly<Record<string, string>> };
  /** Botão secundário (ações raras ou de correção). */
  discreto?: boolean;
  /**
   * Campos que aparecem depois de uma recusa com este código do domínio e ficam na tela dali em diante (ex.: a caixa da
   * nota reforçada depois de `nota_reforcada`): a ação nunca fica travada sem o campo que o domínio pede.
   */
  aposRecusa?: { codigo: string; campos: ReactNode };
  children?: ReactNode;
};

/** A pergunta com os valores digitados (a mesma regra de `FormAcaoPagamento`): quem confirma vê o que vai ser gravado. */
export function perguntaComCampos(pergunta: string, dados: FormData, o: Pick<Props, "valorNaPergunta" | "dataNaPergunta" | "opcaoNaPergunta">): string {
  let texto = pergunta;
  if (o.valorNaPergunta) {
    const bruto = String(dados.get(o.valorNaPergunta) ?? "").trim();
    const centavos = reaisParaCentavos(bruto);
    texto = texto.replaceAll("{valor}", typeof centavos === "number" ? formatBRL(centavos) : `"${bruto}"`);
  }
  if (o.dataNaPergunta) {
    const data = String(dados.get(o.dataNaPergunta) ?? "").trim();
    texto = texto.replaceAll("{data}", /^\d{4}-\d{2}-\d{2}$/.test(data) ? data.split("-").reverse().join("/") : `"${data}"`);
  }
  if (o.opcaoNaPergunta) {
    const v = String(dados.get(o.opcaoNaPergunta.campo) ?? "");
    texto = texto.replaceAll("{opcao}", o.opcaoNaPergunta.textos[v] ?? "(escolha uma opção)");
  }
  return texto;
}

/**
 * Um formulário de ação da disputa do pagamento (M8.2e): os campos, o botão com a confirmação e a mensagem que o servidor
 * devolveu (a recusa do domínio, como veio; feito, a ação volta para a ficha com o resultado). Envia pelo `onSubmit` (não
 * pelo `action` do formulário) para o React não limpar os campos: numa recusa, o que foi digitado continua ali.
 */
export function FormAcaoContestacao({ acao, rotulo, nome, contestacaoId, pagamentoId, pergunta, valorNaPergunta, dataNaPergunta, opcaoNaPergunta, discreto, aposRecusa, children }: Props) {
  const [estado, enviar, enviando] = useActionState(
    async (anterior: EstadoContestacaoPainel & { recusouPor?: boolean }, f: FormData) => {
      const r = (await acao({}, f)) ?? {};
      return { ...r, recusouPor: !!anterior.recusouPor || (!!aposRecusa && r.codigo === aposRecusa.codigo) };
    },
    {} as EstadoContestacaoPainel & { recusouPor?: boolean },
  );
  const formulario = useRef<HTMLFormElement>(null);
  const comCampos = valorNaPergunta || dataNaPergunta || opcaoNaPergunta;
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
      {contestacaoId && <input type="hidden" name="contestacaoId" value={contestacaoId} />}
      {pagamentoId && <input type="hidden" name="pagamentoId" value={pagamentoId} />}
      {children}
      {estado.recusouPor && aposRecusa?.campos}
      <div className={discreto ? undefined : styles.acoes}>
        <BotaoConfirmar
          pergunta={comCampos ? () => (formulario.current ? perguntaComCampos(pergunta, new FormData(formulario.current), { valorNaPergunta, dataNaPergunta, opcaoNaPergunta }) : pergunta) : pergunta}
          disabled={enviando}
          className={discreto ? styles.pequeno : undefined}
        >
          {enviando ? "Aguarde…" : rotulo}
        </BotaoConfirmar>
      </div>
      {estado.mensagem && (
        <p role={estado.ok ? "status" : "alert"} className={estado.ok ? styles.sucesso : styles.alerta} style={{ flexBasis: "100%", margin: 0 }}>
          {estado.mensagem}
        </p>
      )}
    </form>
  );
}
