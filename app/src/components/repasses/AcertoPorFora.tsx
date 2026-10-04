import Link from "next/link";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { formatBRL } from "@/lib/money";
import { marcarAcertoPorForaAcao } from "@/repasses/acoes";
import { type SituacaoAntesDoInicio, vesperaDoInicio } from "@/repasses/por-fora";
import type { RepasseListado } from "@/repasses/repasses";
import { CartaoRepasse, type ItemDoRepasse, nomeDoRepasse, situacaoDoRepasse } from "./CartaoRepasse";

type Props = {
  /** Início do sistema (Configurações → Repasses); null = não definido. */
  inicio: string | null;
  situacao: readonly SituacaoAntesDoInicio[];
  repasses: readonly (RepasseListado & { itens: readonly ItemDoRepasse[] })[];
  mes: string;
  hoje: string;
  editar: boolean;
};

const dataBr = (d: string) => d.split("-").reverse().join("/");

/** Seção "Antes do início do sistema" do painel (M4.11): o que ainda está de fora e os acertos por fora já marcados. */
export function AcertoPorFora({ inicio, situacao, repasses, mes, hoje, editar }: Props) {
  const pendentes = situacao.filter((s) => s.partes > 0 || s.saldoAberto !== 0);
  const marcaveis = pendentes.filter((s) => !s.bloqueios.length);
  const resumo = !inicio ? "data não definida" : pendentes.length ? `${pendentes.length} proprietário(s) a marcar` : repasses.length ? "tudo marcado como acertado por fora" : "nada de antes fora de repasse";
  return (
    <details className={styles.form} aria-label="Antes do início do sistema" open={pendentes.length > 0}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Antes do início do sistema{inicio ? ` (${dataBr(inicio)})` : ""} · {resumo}
      </summary>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", margin: 0, maxWidth: 820 }}>
        Tudo o que é de antes do início já foi acertado fora do sistema. Marcar como &ldquo;acertado por fora&rdquo; cria, para cada proprietário, um repasse já pago (sem Pix nem e-mail) com a
        parte dele em cada reserva de antes e zera o acerto daqueles meses: nada de antes entra em antecipado nem em fechamento, e o recebimento de uma reserva que atravessa o início libera só a
        parte de depois. Dá para repetir quando aparecer algo novo de antes; errou, estorne o repasse como qualquer outro.
      </p>
      {!inicio && (
        <p style={{ margin: 0, fontSize: "0.875rem" }}>
          Defina a data em <Link href="/painel/configuracoes/repasses">Configurações → Repasses</Link>.
        </p>
      )}
      {inicio && pendentes.length === 0 && <p style={{ margin: 0, fontSize: "0.875rem" }}>Nada de antes de {dataBr(inicio)} fora de repasse.</p>}
      {inicio && pendentes.length > 0 && (
        <>
          <div className={styles.rolagem}>
            <table className={styles.tabela} aria-label="Proprietários com acerto antes do início">
              <thead>
                <tr>
                  <th>Proprietário</th>
                  <th>Partes de reserva de antes</th>
                  <th>Acerto em aberto até {dataBr(vesperaDoInicio(inicio))}</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {pendentes.map((s) => (
                  <tr key={s.proprietarioId}>
                    <td>
                      <Link href={`/painel/proprietarios/${s.proprietarioId}`}>{s.nome}</Link>
                    </td>
                    <td>
                      {s.partes} ({formatBRL(s.valorPartes)})
                    </td>
                    <td className={styles.numero}>{formatBRL(s.saldoAberto)}</td>
                    <td style={{ whiteSpace: "normal", minWidth: 220 }}>{s.bloqueios.length ? <strong>{s.bloqueios.join(" ")}</strong> : "Pronto para marcar"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editar && marcaveis.length > 0 && (
            <form action={marcarAcertoPorForaAcao} className={styles.acoes}>
              <input type="hidden" name="mes" value={mes} />
              <BotaoConfirmar
                pergunta={`Marcar tudo até ${dataBr(vesperaDoInicio(inicio))} como acertado por fora para ${marcaveis.map((s) => s.nome).join(", ")}? Cria um repasse já pago por proprietário, com as partes de reserva de antes, e zera o acerto desses meses. Nada de antes entra em outro repasse. Dá para estornar.`}
              >
                Marcar como acertado por fora ({marcaveis.length} proprietário{marcaveis.length === 1 ? "" : "s"})
              </BotaoConfirmar>
            </form>
          )}
          {editar && marcaveis.length === 0 && <p style={{ margin: 0, fontSize: "0.875rem" }}>Resolva os bloqueios acima antes de marcar.</p>}
        </>
      )}
      {repasses.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {repasses.map((r) => (
            <article key={r.id} aria-label={`${nomeDoRepasse(r)} de ${r.nome}`} style={{ borderTop: "1px solid var(--scl-areia)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                <strong>
                  <Link href={`/painel/proprietarios/${r.proprietarioId}`}>{r.nome}</Link> · {nomeDoRepasse(r)}
                </strong>
                <span className={styles.etiqueta}>
                  {formatBRL(r.valor)} · {situacaoDoRepasse(r)}
                </span>
              </div>
              <CartaoRepasse r={r} nome={r.nome} chavePix={r.chavePix} itens={r.itens} mes={mes} hoje={hoje} editar={editar} />
            </article>
          ))}
        </div>
      )}
    </details>
  );
}
