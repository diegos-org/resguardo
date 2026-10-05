import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { guardarExtratoAcao, removerExtratoAcao } from "@/relatorios/acoes";
import { CANAIS_EXTRATO, type ExtratoGuardado } from "@/relatorios/extratos";
import { nomeMes } from "@/repasses/repasses";
import { NOMES_ORIGEM } from "@/reservas/regras";

type Props = {
  mes: string;
  extratos: readonly ExtratoGuardado[];
  imoveis: readonly { id: string; codigo: string; nome: string }[];
  /** Favorecidos possíveis: proprietários ativos e os que têm relatório no mês. */
  proprietarios: readonly { id: string; nome: string }[];
  editar: boolean;
};

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * Extratos oficiais dos canais guardados para o mês (M5.7). O relatório do e-mail do fechamento os anexa no fim, como
 * emitidos; sem extrato guardado, o PDF sai sem anexos e a seção do proprietário avisa.
 */
export function ExtratosCanal({ mes, extratos, imoveis, proprietarios, editar }: Props) {
  return (
    <details className={styles.form} aria-label="Extratos dos canais">
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Extratos dos canais para o relatório de {nomeMes(mes)} · {extratos.length ? `${extratos.length} guardado(s)` : "nenhum guardado"}
      </summary>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", margin: 0, maxWidth: 820 }}>
        Guarde aqui, antes do fechamento, o PDF que cada canal emitiu para o imóvel no mês (Airbnb: &ldquo;Ganhos&rdquo; do período; Booking.com: extrato de
        pagamentos). O relatório enviado por e-mail leva esses extratos no fim, como emitidos, só nas páginas que você indicar. Cada extrato é guardado
        para um proprietário (o favorecido): só o relatório dele o anexa — se o imóvel trocou de dono no meio do mês, guarde um extrato para cada um, com
        as páginas de cada um. Confira antes de guardar: o extrato é só deste imóvel, deste proprietário e deste período — o sistema não lê o conteúdo.
        Sem extrato guardado, o relatório sai sem anexos e a seção do proprietário avisa.
      </p>
      {extratos.length > 0 && (
        <table className={styles.tabela} style={{ fontSize: "0.875rem" }}>
          <thead>
            <tr>
              <th>Imóvel</th>
              <th>Proprietário</th>
              <th>Canal</th>
              <th>Arquivo</th>
              <th>Páginas</th>
              {editar && <th></th>}
            </tr>
          </thead>
          <tbody>
            {extratos.map((e) => (
              <tr key={e.id}>
                <td>
                  {e.imovelCodigo} · {e.imovelNome}
                </td>
                <td>{e.proprietarioNome}</td>
                <td>{e.canalNome}</td>
                <td>
                  {e.arquivoNome} ({kb(e.tamanho)})
                </td>
                <td>{e.paginas || "todas"}</td>
                {editar && (
                  <td>
                    <form action={removerExtratoAcao} style={{ display: "inline" }}>
                      <input type="hidden" name="mes" value={mes} />
                      <input type="hidden" name="id" value={e.id} />
                      <BotaoConfirmar pergunta={`Remover o extrato ${e.canalNome} do ${e.imovelCodigo} de ${e.proprietarioNome} (${nomeMes(mes)})? O relatório passa a sair sem ele.`} className={styles.pequeno}>
                        Remover
                      </BotaoConfirmar>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editar && imoveis.length > 0 && (
        <form action={guardarExtratoAcao} encType="multipart/form-data" className={styles.form} style={{ padding: 0, border: 0 }} aria-label="Guardar extrato">
          <input type="hidden" name="mes" value={mes} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label>
              Imóvel
              <select name="imovelId" required defaultValue="">
                <option value="" disabled>
                  Escolha
                </option>
                {imoveis.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.codigo} · {i.nome}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Proprietário (favorecido)
              <select name="proprietarioId" required defaultValue="">
                <option value="" disabled>
                  Escolha
                </option>
                {proprietarios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Canal
              <select name="canal" defaultValue="airbnb">
                {CANAIS_EXTRATO.map((c) => (
                  <option key={c} value={c}>
                    {NOMES_ORIGEM[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              PDF do extrato (até 2 MB)
              <input type="file" name="arquivo" accept="application/pdf" required />
            </label>
            <label>
              Páginas (ex.: 1-2, 4; vazio = todas)
              <input type="text" name="paginas" inputMode="numeric" maxLength={40} />
            </label>
          </div>
          <div className={styles.acoes}>
            <button type="submit" className={styles.pequeno}>
              Guardar extrato
            </button>
          </div>
        </form>
      )}
    </details>
  );
}
