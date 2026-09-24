"use client";

import { useActionState } from "react";
import type { EstadoRecebimento } from "@/imoveis/acoes";
import { NOMES_ORIGEM } from "@/reservas/regras";
import styles from "../formularios.module.css";

type Props = {
  imovelId: string;
  config: Partial<Record<string, "split" | "empresa">>;
  padrao: Record<string, "split" | "empresa" | "a_confirmar">;
  salvar: (a: EstadoRecebimento, f: FormData) => Promise<EstadoRecebimento>;
};

const NOME = { split: "Canal paga o proprietário direto", empresa: "Empresa recebe e repassa", a_confirmar: "A confirmar" };

export function Recebimento({ imovelId, config, padrao, salvar }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  return (
    <section aria-label="Quem recebe o pagamento" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.25rem" }}>Quem recebe o pagamento</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
        Por canal, para este imóvel. Ao salvar, o financeiro das reservas dele é recalculado. Uma reserva específica ainda pode ter a sua
        própria escolha.
      </p>
      {/* key: depois de salvar, o formulário remonta com os valores gravados. */}
      <form key={JSON.stringify(config)} action={enviar} className={styles.form}>
        <input type="hidden" name="imovelId" value={imovelId} />
        <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) minmax(0, 1fr)", gap: "8px 16px", alignItems: "center" }}>
          {Object.entries(NOMES_ORIGEM).map(([origem, nome]) => (
            <label key={origem} style={{ display: "contents" }}>
              <span>{nome}</span>
              <select name={`recebimento_${origem}`} defaultValue={config[origem] ?? ""} style={{ maxWidth: 420 }}>
                <option value="">Padrão ({NOME[padrao[origem] ?? "empresa"]})</option>
                <option value="split">{NOME.split}</option>
                <option value="empresa">{NOME.empresa}</option>
              </select>
            </label>
          ))}
        </div>
        {estado.mensagem && <p className={styles.alerta}>{estado.mensagem}</p>}
        {estado.ok && (
          <p role="status" className={styles.sucesso}>
            Salvo. Reservas recalculadas.
          </p>
        )}
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </section>
  );
}
