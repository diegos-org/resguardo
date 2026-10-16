import Link from "next/link";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { formatBRL } from "@/lib/money";
import { gerarAntecipadoAcao } from "@/repasses/acoes";
import type { PeriodicidadeDoDono } from "@/repasses/proprietario";
import type { RepasseListado } from "@/repasses/repasses";
import { CartaoRepasse, type ItemDoRepasse, nomeDoRepasse, situacaoDoRepasse } from "./CartaoRepasse";

export type DonoAntecipavel = { proprietarioId: string; nome: string; disponivel: number; aLiberar: number; periodicidade: PeriodicidadeDoDono | null };

type Props = {
  repasses: readonly (RepasseListado & { itens: readonly ItemDoRepasse[] })[];
  donos: readonly DonoAntecipavel[];
  mes: string;
  hoje: string;
  /** Hoje é o dia do fechamento (M4.13)? Nesse dia não há antecipado. */
  diaDeFechamento: boolean;
  editar: boolean;
};

const dataBr = (d: string) => d.split("-").reverse().join("/");

/** Seção "Repasses antecipados" do painel (M4.10): o que já saiu fora do fechamento e o que dá para gerar agora. */
export function RepassesAntecipados({ repasses, donos, mes, hoje, diaDeFechamento, editar }: Props) {
  const diaPrimeiro = diaDeFechamento;
  const comDisponivel = donos.filter((d) => d.disponivel > 0);
  return (
    <section className={styles.form} aria-label="Repasses antecipados">
      <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Repasses antecipados (quinzenal, semanal, assim que disponível)</h2>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", margin: 0, maxWidth: 820 }}>
        Cada parte de reserva fica <strong>disponível</strong> depois do check-in e com o dinheiro registrado na empresa (recebimento na página da reserva). A rotina das 08:00 gera o
        repasse de quem está no dia da periodicidade dele; aqui você gera um avulso. No dia do fechamento só existe o fechamento. Nada é pago duas vezes: cada parte entra num repasse só.
      </p>
      {comDisponivel.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {comDisponivel.map((d) => (
            <li key={d.proprietarioId} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span>
                <Link href={`/painel/proprietarios/${d.proprietarioId}`}>{d.nome}</Link>: <strong>{formatBRL(d.disponivel)}</strong> disponível
                {d.aLiberar > 0 ? ` (${formatBRL(d.aLiberar)} a liberar)` : ""}
                {d.periodicidade ? ` · recebe ${d.periodicidade.nome.toLowerCase()}, próximo repasse ${dataBr(d.periodicidade.proximaData)}` : ""}
              </span>
              {editar && !diaPrimeiro && (
                <form action={gerarAntecipadoAcao} className={styles.acoes}>
                  <input type="hidden" name="mes" value={mes} />
                  <input type="hidden" name="proprietarioId" value={d.proprietarioId} />
                  <BotaoConfirmar pergunta={`Gerar agora um repasse antecipado de ${formatBRL(d.disponivel)} para ${d.nome}?`} className={styles.pequeno}>
                    Gerar repasse antecipado agora
                  </BotaoConfirmar>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0, fontSize: "0.875rem" }}>Nenhum proprietário com valor disponível fora do fechamento agora.</p>
      )}
      {diaPrimeiro && <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>Hoje é o dia do fechamento: o fechamento do mês é o único repasse do dia.</p>}
      {repasses.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {repasses.map((r) => (
            <article key={r.id} aria-label={`${nomeDoRepasse(r)} de ${r.nome}`} style={{ borderTop: "1px solid var(--scl-areia)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                <strong>
                  <Link href={`/painel/proprietarios/${r.proprietarioId}`}>{r.nome}</Link> · {nomeDoRepasse(r)}
                  {r.pedidoEm ? " · pedido pelo proprietário no portal" : ""}
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
    </section>
  );
}
