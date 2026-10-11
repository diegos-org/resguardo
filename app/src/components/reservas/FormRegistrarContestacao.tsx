"use client";

import { useState } from "react";
import type { AcaoContestacao } from "./FormAcaoContestacao";
import { FormAcaoContestacao } from "./FormAcaoContestacao";

const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)", flexBasis: "100%" } as const;

/**
 * "Registrar disputa vista no painel do Mercado Pago" (M8.2e; desenho "De onde vem cada fato", 6), no quadro do pagamento,
 * para quem cuida do financeiro: o tipo (o MED só num Pix), o dia em que abriu (entre a aprovação e hoje), o valor (até o
 * pago), o prazo dos documentos (opcional: sem ele, o aviso de prazo desconhecido), o número do caso (opcional, só
 * algarismos) e a nota (obrigatória, sem dados pessoais). O servidor relê no Mercado Pago antes e nunca duplica uma disputa
 * que ele já mostra; a pergunta repete o tipo, o valor e o dia digitados.
 */
export function FormRegistrarContestacao({
  pagamentoId,
  acao,
  pix,
  desde,
  hoje,
  valorPadrao,
}: {
  pagamentoId: string;
  acao: AcaoContestacao;
  /** O pagamento é por Pix (só nele o MED existe). */
  pix: boolean;
  /** AAAA-MM-DD: o dia da aprovação (o mínimo do "aberta em"). */
  desde: string;
  hoje: string;
  /** O pago, em reais ("1824,00"), para começar preenchido; vazio sem o financeiro. */
  valorPadrao: string;
}) {
  const [aberto, setAberto] = useState(false);
  const tipos = [
    { valor: "chargeback", texto: "Contestação no cartão" },
    ...(pix ? [{ valor: "med", texto: "Devolução pedida pelo Pix (MED)" }] : []),
    { valor: "reclamacao", texto: "Reclamação no Mercado Pago" },
  ];
  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} style={{ alignSelf: "flex-start", font: "inherit", fontSize: "0.8125rem", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--scl-borda)", background: "var(--scl-papel)", cursor: "pointer" }}>
        Registrar disputa vista no painel do Mercado Pago
      </button>
    );
  return (
    <FormAcaoContestacao
      acao={acao}
      pagamentoId={pagamentoId}
      rotulo="Registrar a disputa"
      nome="Registrar disputa vista no painel do Mercado Pago"
      pergunta="Registrar {opcao} de {valor} aberta em {data} neste pagamento? A disputa entra no quadro e segura o valor em risco; o sistema confere pela leitura do Mercado Pago quando puder."
      valorNaPergunta="valor"
      dataNaPergunta="abertaEm"
      opcaoNaPergunta={{ campo: "tipo", textos: Object.fromEntries(tipos.map((t) => [t.valor, t.texto.toLowerCase()])) }}
    >
      <strong style={{ flexBasis: "100%" }}>Registrar disputa vista no painel do Mercado Pago</strong>
      <p style={nota}>Use quando o painel do Mercado Pago mostra uma disputa que este quadro ainda não tem (o MED do Pix e as reclamações nunca chegam pela leitura).</p>
      <label style={{ flex: "1 1 220px" }}>
        Tipo
        <select name="tipo" required defaultValue="">
          <option value="" disabled>
            Escolha
          </option>
          {tipos.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.texto}
            </option>
          ))}
        </select>
      </label>
      <label style={{ flex: "0 1 170px" }}>
        Aberta em
        <input type="date" name="abertaEm" min={desde} max={hoje} defaultValue={hoje} required />
      </label>
      <label style={{ flex: "0 1 160px" }}>
        Valor em disputa (R$)
        <input name="valor" inputMode="decimal" defaultValue={valorPadrao} required />
      </label>
      <label style={{ flex: "0 1 190px" }}>
        Prazo dos documentos (opcional)
        <input type="date" name="prazo" min={desde} />
      </label>
      <label style={{ flex: "0 1 200px" }}>
        Número do caso (opcional)
        <input name="idCaso" inputMode="numeric" pattern="\d{1,20}" maxLength={20} />
      </label>
      <label style={{ flex: "1 1 100%" }}>
        Nota (obrigatória, sem dados pessoais)
        <input name="nota" required maxLength={300} placeholder="ex.: painel do Mercado Pago mostra a contestação aberta em 05/10" />
      </label>
    </FormAcaoContestacao>
  );
}
