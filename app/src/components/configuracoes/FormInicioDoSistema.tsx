"use client";

import { useActionState } from "react";
import type { EstadoInicioDoSistema } from "@/repasses/acoes";
import styles from "../formularios.module.css";

type Props = { inicio: string | null; hoje: string; salvar: (a: EstadoInicioDoSistema, f: FormData) => Promise<EstadoInicioDoSistema> };

const grupo = { border: "1px solid var(--scl-borda)", borderRadius: 8, padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 12, margin: 0 };
const legenda = { fontWeight: 500, padding: "0 6px" };
const nota = { fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 };

const dataBr = (d: string) => d.split("-").reverse().join("/");

/** Configurações → Repasses (M4.11): a data a partir da qual o sistema vale; o que é de antes já foi acertado por fora. */
export function FormInicioDoSistema({ inicio, hoje, salvar }: Props) {
  const [estado, enviar] = useActionState(salvar, {});
  return (
    <form key={inicio ?? ""} action={enviar} className={styles.form} aria-label="Início do sistema">
      <fieldset style={grupo}>
        <legend style={legenda}>Início do sistema para valer</legend>
        <p style={nota}>
          Tudo o que é de antes desta data — parte de reserva, comissão, despesa, ajuste — já foi acertado fora do sistema. Depois de salvar, em Financeiro → Repasses você marca isso como
          &ldquo;acertado por fora&rdquo;: nada de antes entra em repasse antecipado nem em fechamento, e a reserva que atravessa o início paga só a parte de depois. Sempre o dia 1º de um
          mês (as partes de reserva são por mês). {inicio ? `Hoje: ${dataBr(inicio)}.` : "Ainda não definido."}
        </p>
        <div className={styles.linha}>
          <label style={{ flex: "0 1 220px" }}>
            Data de início
            <input type="date" name="data" defaultValue={estado.valor ?? inicio ?? ""} max={hoje} aria-invalid={estado.mensagem ? true : undefined} />
          </label>
        </div>
      </fieldset>
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      {estado.ok && (
        <p role="status" className={styles.sucesso}>
          {estado.aviso ?? "Salvo."}
        </p>
      )}
      <div className={styles.acoes}>
        <button type="submit">Salvar</button>
      </div>
    </form>
  );
}
