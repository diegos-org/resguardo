"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import type { EstadoContestacaoPainel } from "@/pagamentos/acoes-contestacao";
import type { ResultadoNaTela } from "@/pagamentos/contestacao-tela";
import { type AcaoContestacao, perguntaComCampos } from "./FormAcaoContestacao";

const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;

/**
 * "Confirmar o resultado" (M8.2e; desenho "Confirmar o resultado"), para quem cuida do financeiro. C1: o formulário começa
 * **sem nada marcado** — Ganhou ou Perdeu é sempre da equipe —, com os fatos do Mercado Pago em palavras ao lado; datas e
 * valores vêm preenchidos (o valor em disputa, o líquido que não entrou, o dia do débito). No "Ganhou": o dia em que o
 * dinheiro voltou (com o retido realizado) e, sem recebimento do pagamento, a liberação ali mesmo. No "Perdeu": o valor que
 * a SCL perdeu, quanto nunca entrou na conta e o dia do débito. A tarifa do Mercado Pago pela disputa é opcional nos dois.
 * Com a leitura de agora mostrando a disputa em andamento, a nota reforçada ("o painel do Mercado Pago já mostra o
 * resultado") é pedida. A pergunta do BotaoConfirmar vem do servidor, com a data e o valor digitados.
 */
export function FormResultadoContestacao({ contestacaoId, resultado: r, acao, hoje }: { contestacaoId: string; resultado: ResultadoNaTela; acao: AcaoContestacao; hoje: string }) {
  const [estado, enviar, enviando] = useActionState(async (_a: EstadoContestacaoPainel, f: FormData) => (await acao({}, f)) ?? {}, {} as EstadoContestacaoPainel);
  const [escolha, setEscolha] = useState<"" | "ganha" | "perdida">("");
  const formulario = useRef<HTMLFormElement>(null);
  const pergunta = () => (escolha && formulario.current ? perguntaComCampos(r.perguntas[escolha], new FormData(formulario.current), { dataNaPergunta: "data", valorNaPergunta: "valorPerdido" }) : "");
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
              <label>
                Líquido que caiu (R$, opcional)
                <input name="liberacaoLiquido" inputMode="decimal" defaultValue={r.proposta.liquido !== null ? centavosParaCampo(r.proposta.liquido) : ""} />
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
            <label>
              Quanto deste pagamento nunca entrou na conta (R$; zero se o Mercado Pago já tinha liberado)
              <input name="liquidoNaoEntrou" inputMode="decimal" defaultValue={r.proposta.liquidoNaoEntrou !== null ? centavosParaCampo(r.proposta.liquidoNaoEntrou) : ""} />
            </label>
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
      {r.emAndamento && (
        <label className={styles.check}>
          <input type="checkbox" name="notaReforcada" value="sim" /> O painel do Mercado Pago já mostra o resultado (a leitura daqui ainda mostra a disputa em andamento)
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
