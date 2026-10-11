"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
import type { EstadoContestacaoPainel } from "@/pagamentos/acoes-contestacao";
import type { ResultadoNaTela } from "@/pagamentos/contestacao-tela";
import { type AcaoContestacao, perguntaComCampos } from "./FormAcaoContestacao";

const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;

/**
 * "Confirmar o resultado" (M8.2e; desenho "Confirmar o resultado"), para quem cuida do financeiro. C1: o formulário começa
 * **sem nada marcado** — Ganhou ou Perdeu é sempre da equipe —, com os fatos do Mercado Pago em palavras ao lado; datas e
 * valores vêm preenchidos (o valor em disputa, o líquido que não entrou, o dia do débito). No "Ganhou": o dia em que o
 * dinheiro voltou (com o retido realizado) e, sem recebimento do pagamento, a liberação ali mesmo (data e líquido em branco,
 * com o líquido lido ao lado: os dois ou nenhum). No "Perdeu": o valor que
 * a SCL perdeu, quanto nunca entrou na conta e o dia do débito. A tarifa do Mercado Pago pela disputa é opcional nos dois.
 * Com a leitura de agora podendo mostrar a disputa em andamento (e sempre depois da recusa `nota_reforcada`), a caixa da
 * nota reforçada ("o painel do Mercado Pago já mostra o resultado") aparece. O "nunca entrou na conta" é obrigatório (em
 * branco, nunca vira zero) e, quando o domínio pede a liberação antes, o texto dele aparece, com o atalho para "Registrar
 * liberação" do pagamento (`atalhoLiberacao`, quando a ação cabe). A pergunta do BotaoConfirmar vem do servidor, com a data
 * e os valores digitados.
 */
export function FormResultadoContestacao({
  contestacaoId,
  resultado: r,
  acao,
  hoje,
  atalhoLiberacao = null,
}: {
  contestacaoId: string;
  resultado: ResultadoNaTela;
  acao: AcaoContestacao;
  hoje: string;
  /** O endereço ("#…") do formulário "Registrar liberação" do pagamento na ficha; null quando ele não aparece. */
  atalhoLiberacao?: string | null;
}) {
  // `pediuReforcada`: a recusa `nota_reforcada` já veio uma vez — a caixa fica na tela dali em diante (uma recusa seguinte por
  // outro motivo não a esconde de novo).
  const [estado, enviar, enviando] = useActionState(async (anterior: EstadoContestacaoPainel & { pediuReforcada?: boolean }, f: FormData) => {
    const r = (await acao({}, f)) ?? {};
    return { ...r, pediuReforcada: !!anterior.pediuReforcada || r.codigo === "nota_reforcada" };
  }, {} as EstadoContestacaoPainel & { pediuReforcada?: boolean });
  const [escolha, setEscolha] = useState<"" | "ganha" | "perdida">("");
  const formulario = useRef<HTMLFormElement>(null);
  const pergunta = () => {
    if (!escolha || !formulario.current) return "";
    const dados = new FormData(formulario.current);
    // O "nunca entrou na conta" digitado também vai na pergunta (quem confirma vê o que entra no caixa final).
    const naoEntrou = perguntaComCampos("{valor}", dados, { valorNaPergunta: "liquidoNaoEntrou" });
    return perguntaComCampos(r.perguntas[escolha], dados, { dataNaPergunta: "data", valorNaPergunta: "valorPerdido" }).replaceAll("{naoEntrou}", naoEntrou);
  };
  // A caixa da nota reforçada: quando a leitura pode mostrar a disputa em andamento e, sempre, depois da recusa
  // `nota_reforcada` (a ação nunca fica travada sem a caixa que o domínio pede).
  const reforcada = r.emAndamento || !!estado.pediuReforcada;
  return (
    <form
      ref={formulario}
      aria-label="Confirmar o resultado"
      className={styles.form}
      onSubmit={(ev) => {
        ev.preventDefault();
        const dados = new FormData(ev.currentTarget);
        startTransition(() => enviar(dados));
      }}
    >
      <input type="hidden" name="contestacaoId" value={contestacaoId} />
      <input type="hidden" name="versao" value={r.versao} />
      <input type="hidden" name="assinatura" value={r.assinatura} />
      <strong>Confirmar o resultado</strong>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8125rem", color: "var(--scl-texto-2)" }} aria-label="O que o Mercado Pago mostra">
        {r.fatos.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 16 }}>
        <legend style={{ fontSize: "0.875rem" }}>Resultado (confira no painel do Mercado Pago)</legend>
        <label className={styles.check}>
          <input type="radio" name="resultado" value="ganha" checked={escolha === "ganha"} onChange={() => setEscolha("ganha")} /> Ganhou (o dinheiro voltou à SCL)
        </label>
        <label className={styles.check}>
          <input type="radio" name="resultado" value="perdida" checked={escolha === "perdida"} onChange={() => setEscolha("perdida")} /> Perdeu (o dinheiro voltou ao pagador)
        </label>
      </fieldset>
      <label>
        Data do resultado
        <input type="date" name="data" min={r.desde} max={hoje} defaultValue={hoje} required />
      </label>
      {escolha === "ganha" && (
        <>
          {r.retidoRealizado && (
            <label>
              Dia em que o dinheiro voltou à conta (vazio = a data do resultado)
              <input type="date" name="voltaEm" min={r.desde} max={hoje} />
            </label>
          )}
          {r.semRecebimento && !r.semReserva && (
            <>
              <p style={nota}>O pagamento ainda não tem a liberação no financeiro: se o dinheiro já caiu, registre a liberação aqui (as mesmas regras de &ldquo;Registrar liberação&rdquo;).</p>
              <label>
                Data em que a liberação caiu na conta (opcional)
                <input type="date" name="liberacaoData" max={hoje} />
              </label>
              {/* Os dois em branco por padrão: o "Ganhou" sem registrar a liberação nunca é recusado por um valor já preenchido. */}
              <label>
                Líquido que caiu (R$, opcional{r.proposta.liquido !== null ? `; o Mercado Pago mostra ${formatBRL(r.proposta.liquido)}` : ""})
                <input name="liberacaoLiquido" inputMode="decimal" placeholder={r.proposta.liquido !== null ? centavosParaCampo(r.proposta.liquido) : undefined} />
              </label>
            </>
          )}
        </>
      )}
      {escolha === "perdida" && (
        <>
          <label>
            Valor que a SCL perdeu (R$)
            <input name="valorPerdido" inputMode="decimal" defaultValue={r.proposta.valorPerdido !== null ? centavosParaCampo(r.proposta.valorPerdido) : ""} required />
          </label>
          <p style={nota}>Preenchido com {r.contaDoPerdido}.</p>
          {!r.semReserva && (
            <>
              {r.liberacaoAntes && (
                <p role="note" className={styles.alerta} style={{ margin: 0 }}>
                  {r.liberacaoAntes}
                  {atalhoLiberacao && (
                    <>
                      {" "}
                      <a href={atalhoLiberacao}>Ir para &ldquo;Registrar liberação&rdquo;</a>
                    </>
                  )}
                </p>
              )}
              <label>
                Quanto deste pagamento nunca entrou na conta (R$; zero se o Mercado Pago já tinha liberado; obrigatório: o sistema não supõe)
                <input name="liquidoNaoEntrou" inputMode="decimal" required defaultValue={r.proposta.liquidoNaoEntrou !== null ? centavosParaCampo(r.proposta.liquidoNaoEntrou) : ""} />
              </label>
            </>
          )}
          <label>
            Dia em que o Mercado Pago debitou
            <input type="date" name="debitoEm" min={r.desde} max={hoje} defaultValue={r.proposta.debitoEm ?? ""} />
          </label>
        </>
      )}
      {escolha && (
        <label>
          Tarifa do Mercado Pago pela disputa (R$, opcional: despesa da SCL)
          <input name="tarifa" inputMode="decimal" placeholder="em branco se não houve" />
        </label>
      )}
      {reforcada && (
        <label className={styles.check}>
          <input type="checkbox" name="notaReforcada" value="sim" /> O painel do Mercado Pago já mostra o resultado (a leitura daqui ainda não o mostra)
        </label>
      )}
      <label>
        Nota (sem dados pessoais; obrigatória quando o resultado ou o valor diferem do que o Mercado Pago mostra, ou quando ele não mostra o resultado)
        <textarea name="nota" maxLength={300} rows={2} />
      </label>
      <div className={styles.acoes}>
        <BotaoConfirmar pergunta={pergunta} disabled={enviando || !escolha}>
          {enviando ? "Aguarde…" : "Confirmar o resultado"}
        </BotaoConfirmar>
      </div>
      {estado.mensagem && (
        <p role={estado.ok ? "status" : "alert"} className={estado.ok ? styles.sucesso : styles.alerta} style={{ margin: 0 }}>
          {estado.mensagem}
        </p>
      )}
    </form>
  );
}
