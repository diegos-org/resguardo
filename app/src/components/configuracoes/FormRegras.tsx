"use client";

import { useActionState } from "react";
import type { EstadoForm } from "@/configuracoes/acoes";
import { PRAZO_MAXIMO } from "@/configuracoes/regras-financeiras";
import styles from "../formularios.module.css";

const RECEBE = { split: "Canal paga o proprietário direto", empresa: "Empresa recebe e repassa no mês", a_confirmar: "A confirmar (acerto fica pendente)" };
const BASE = { liquido_canal: "Valor que o canal repassa (depois da taxa do canal)", bruto: "Valor bruto pago pelo hóspede" };

type Props = {
  /** `prazoPagamento` (M4.12): dias depois do check-in em que o canal paga o proprietário direto; null = sem regra. */
  regras: { base: keyof typeof BASE; recebimento: Record<string, keyof typeof RECEBE>; prazoPagamento?: Record<string, number | null> };
  origens: Record<string, string>;
  salvar: (a: EstadoForm, f: FormData) => Promise<EstadoForm>;
};

export function FormRegras({ regras, origens, salvar }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  return (
    <form key={JSON.stringify(regras)} action={enviar} className={styles.form} aria-label="Regras financeiras">
      <label>
        Comissão calculada sobre
        <select name="base" defaultValue={regras.base}>
          {Object.entries(BASE).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <legend style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", marginBottom: 8 }}>
          Quem recebe o pagamento, por canal (padrão da empresa; cada imóvel e cada reserva podem ter a sua própria escolha)
        </legend>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, max-content) minmax(0, 1fr)", gap: "8px 16px", alignItems: "center" }}>
          {Object.entries(origens).map(([o, nome]) => (
            <label key={o} style={{ display: "contents" }}>
              <span>{nome}</span>
              <select name={`recebimento_${o}`} defaultValue={regras.recebimento[o]} style={{ maxWidth: 420 }}>
                {Object.entries(RECEBE).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <legend style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", marginBottom: 8 }}>
          Em quantos dias depois do check-in o canal paga o proprietário direto (quando o canal paga direto). Vazio = sem regra. 1 = dia seguinte ao check-in, padrão do
          Airbnb. É a data do pagamento da reserva: decide se ela é de antes ou de depois do início do sistema e aparece no extrato e no relatório.
        </legend>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, max-content) minmax(0, 1fr)", gap: "8px 16px", alignItems: "center" }}>
          {Object.entries(origens).map(([o, nome]) => (
            <label key={o} style={{ display: "contents" }}>
              <span>{nome}</span>
              <input name={`prazo_${o}`} type="number" inputMode="numeric" min={0} max={PRAZO_MAXIMO} step={1} defaultValue={regras.prazoPagamento?.[o] ?? ""} placeholder="sem regra" style={{ maxWidth: 120 }} />
            </label>
          ))}
        </div>
      </fieldset>
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      {estado.ok && (
        <p role="status" className={styles.sucesso}>
          {estado.aviso}
        </p>
      )}
      <div className={styles.acoes}>
        <button
          type="submit"
          disabled={enviando}
          onClick={(ev) => {
            if (!window.confirm("Salvar as regras? As reservas com entrada de hoje em diante serão recalculadas. O passado não muda.")) ev.preventDefault();
          }}
        >
          {enviando ? "Salvando e recalculando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
