"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { formatBRL } from "@/lib/money";
import type { EstadoContestacaoPainel } from "@/pagamentos/acoes-contestacao";
import type { AcaoContestacao } from "./FormAcaoContestacao";

const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;

/**
 * "Cancelar a reserva contestada (sem devolução pelo sistema)" (M8.2e; ★ decisão 6), antes da entrada, para quem edita a
 * reserva e o financeiro, em dois passos como o cancelamento pela política: 1. "Ver o cancelamento" — o servidor confere e
 * devolve a prévia (o valor retido, os avisos, a pergunta e a assinatura); 2. "Cancelar a reserva contestada" — com a nota
 * (obrigatória) e a pergunta da prévia. Mexeu na nota depois da prévia: vale a mesma prévia (a nota não muda o cálculo).
 */
export function FormCancelarContestada({ reservaId, calcular, cancelar }: { reservaId: string; calcular: AcaoContestacao; cancelar: AcaoContestacao }) {
  const etapa = useRef<"calcular" | "cancelar">("calcular");
  const [estado, enviar, enviando] = useActionState(async (anterior: EstadoContestacaoPainel, x: { etapa: "calcular" | "cancelar"; dados: FormData }) => {
    const r: EstadoContestacaoPainel = (await (x.etapa === "cancelar" ? cancelar : calcular)({}, x.dados)) ?? {};
    // Numa recusa do cancelar, a prévia que estava na tela some (calcule de novo).
    return x.etapa === "calcular" ? r : { ...r, previa: r.ok ? anterior.previa : undefined };
  }, {} as EstadoContestacaoPainel);
  const [aberto, setAberto] = useState(false);
  const previa = estado.previa;
  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} style={{ alignSelf: "flex-start", font: "inherit", fontSize: "0.8125rem", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--scl-erro)", color: "var(--scl-erro)", background: "var(--scl-papel)", cursor: "pointer" }}>
        Cancelar a reserva contestada
      </button>
    );
  return (
    <form
      aria-label="Cancelar a reserva contestada"
      className={styles.form}
      onSubmit={(ev) => {
        ev.preventDefault();
        const dados = new FormData(ev.currentTarget);
        const qual = etapa.current;
        etapa.current = "calcular";
        startTransition(() => enviar({ etapa: qual, dados }));
      }}
    >
      <input type="hidden" name="reservaId" value={reservaId} />
      {previa && <input type="hidden" name="assinatura" value={previa.assinatura} />}
      <strong>Cancelar a reserva contestada (sem devolução pelo sistema)</strong>
      <p style={nota}>
        Só antes do horário de entrada. A reserva fica cancelada e o valor pago fica retido: o dinheiro volta ao pagador pela disputa, se ele ganhar.
        Nenhuma devolução é pedida ao Mercado Pago.
      </p>
      <label>
        Nota (obrigatória, sem dados pessoais)
        <textarea name="nota" required maxLength={300} rows={2} />
      </label>
      {previa && (
        <div role="note" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.875rem" }}>
          <span>
            Valor pago: {formatBRL(previa.valorPago)}; fica retido: {formatBRL(previa.valorRetido)}.
          </span>
          {previa.avisos.map((a) => (
            <span key={a} className={styles.alerta}>
              {a}
            </span>
          ))}
        </div>
      )}
      <div className={styles.acoes}>
        {/* A prévia é só leitura: não valida o formulário (a nota obrigatória é do passo 2, e o servidor a confere). */}
        <button type="submit" formNoValidate disabled={enviando} className={previa ? styles.pequeno : undefined} onClick={() => (etapa.current = "calcular")}>
          {enviando ? "Aguarde…" : previa ? "Ver de novo" : "Ver o cancelamento"}
        </button>
        {previa && (
          <BotaoConfirmar pergunta={previa.pergunta} disabled={enviando} onClick={() => (etapa.current = "cancelar")} style={{ borderColor: "var(--scl-erro)", color: "var(--scl-erro)" }}>
            Cancelar a reserva contestada
          </BotaoConfirmar>
        )}
      </div>
      {estado.mensagem && (
        <p role={estado.ok ? "status" : "alert"} className={estado.ok ? styles.sucesso : styles.alerta} style={{ margin: 0 }}>
          {estado.mensagem}
        </p>
      )}
    </form>
  );
}
