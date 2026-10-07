import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import type { Lancamento } from "@/financeiro/ledger";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
import { estornarRecebimentoAcao, registrarRecebimentoAcao } from "@/repasses/acoes";
import type { RecebidoDaReserva } from "@/repasses/recebimentos";

type Props = {
  reservaId: string;
  recebimentos: readonly Lancamento[];
  recebido: RecebidoDaReserva;
  /** Quem recebe o dinheiro desta reserva, como o motor decidiu. */
  quemRecebe: "empresa" | "split" | "a_confirmar";
  editar: boolean;
  hoje: string;
  cancelada: boolean;
};

const dataBr = (d: string) => d.split("-").reverse().join("/");

/** Recebimentos da reserva (M4.10): o dinheiro do canal que entrou na empresa; libera a parte do proprietário para repasse. */
export function Recebimentos({ reservaId, recebimentos, recebido, quemRecebe, editar, hoje, cancelada }: Props) {
  const falta = Math.max(0, recebido.devido - recebido.recebido);
  return (
    <section aria-label="Recebimentos" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Recebimento do canal</h2>
      {quemRecebe === "split" ? (
        <p style={{ margin: 0, color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>O canal paga a parte do proprietário direto a ele: não há recebimento a registrar aqui, e a reserva não entra em repasse.</p>
      ) : (
        <>
          <p style={{ margin: 0, color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>
            {quemRecebe === "a_confirmar" ? "Quem recebe ainda está a confirmar: defina no imóvel ou nas regras financeiras. " : ""}
            Líquido do canal a receber: <strong>{formatBRL(recebido.devido)}</strong> · recebido: <strong>{formatBRL(recebido.recebido)}</strong>
            {falta > 0 ? ` · falta ${formatBRL(falta)}` : recebido.devido > 0 ? " · tudo recebido: a parte do proprietário fica disponível depois do check-in" : ""}. A parte do proprietário só entra em repasse com o dinheiro aqui registrado
            (nunca se repassa o que a empresa ainda não recebeu).
          </p>
          {recebimentos.length > 0 && (
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Valor</th>
                  <th>Nota</th>
                  <th>Situação</th>
                  {editar && <th />}
                </tr>
              </thead>
              <tbody>
                {recebimentos.map((l) => (
                  <tr key={l.id}>
                    <td>{dataBr(l.dataCaixa ?? l.competencia)}</td>
                    <td className={styles.numero}>{formatBRL(l.montante ?? 0)}</td>
                    <td>{l.comprovante || "—"}</td>
                    <td>{l.estado}</td>
                    {editar && (
                      <td>
                        <form action={estornarRecebimentoAcao} className={styles.linha} style={{ alignItems: "center", margin: 0 }}>
                          <input type="hidden" name="reservaId" value={reservaId} />
                          <input type="hidden" name="id" value={l.id} />
                          <input name="motivo" required maxLength={200} placeholder="motivo" aria-label="Motivo do estorno" style={{ width: 160 }} />
                          <BotaoConfirmar pergunta="Estornar este recebimento? A parte do proprietário pode deixar de estar disponível." className={styles.pequeno}>
                            Estornar
                          </BotaoConfirmar>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {editar && !cancelada && (
            <form action={registrarRecebimentoAcao} className={styles.linha} style={{ alignItems: "flex-end" }} aria-label="Registrar recebimento">
              <input type="hidden" name="reservaId" value={reservaId} />
              <label style={{ flex: "0 1 180px" }}>
                Data em que entrou
                <input type="date" name="data" defaultValue={hoje} max={hoje} required />
              </label>
              <label style={{ flex: "0 1 160px" }}>
                Valor recebido (R$)
                <input name="valor" inputMode="decimal" defaultValue={falta > 0 ? centavosParaCampo(falta) : ""} required />
              </label>
              <label style={{ flex: "1 1 200px" }}>
                Nota (opcional)
                <input name="nota" maxLength={200} placeholder="ex.: extrato Booking de 10/10" />
              </label>
              <div className={styles.acoes}>
                <button type="submit">Registrar recebimento</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
