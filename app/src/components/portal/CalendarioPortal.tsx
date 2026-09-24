import { diasDoPeriodo, type ItemCalendario, montarCalendario } from "@/calendario/grade";
import styles from "@/components/calendario/calendario.module.css";

const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const br = (d: string) => d.split("-").reverse().join("/");

/**
 * Calendário do mês no portal: uma linha por imóvel. Cada reserva é um link (toque ou clique)
 * para a linha dela na tabela, com os valores; passar o mouse só complementa.
 */
export function CalendarioPortal({
  periodo,
  imoveis,
  itens,
  hoje,
}: {
  periodo: { inicio: string; fim: string };
  imoveis: readonly { id: string; codigo: string; nome: string }[];
  itens: readonly ItemCalendario[];
  hoje: string;
}) {
  const dias = diasDoPeriodo(periodo.inicio, periodo.fim);
  const linhas = montarCalendario(
    periodo,
    imoveis.map((i) => i.id),
    itens,
  );
  const colunas = `minmax(64px, max-content) repeat(${dias.length}, minmax(30px, 1fr))`;
  return (
    <div className={styles.rolagem}>
      <div className={styles.grade} style={{ gridTemplateColumns: colunas }} role="grid" aria-label="Calendário do mês">
        <div className={styles.cabecalhoImovel}>Imóvel</div>
        {dias.map((d) => {
          const semana = new Date(`${d}T12:00:00Z`).getUTCDay();
          const classes = [styles.dia, semana === 0 || semana === 6 ? styles.fimDeSemana : "", d === hoje ? styles.hoje : ""].join(" ");
          return (
            <div key={d} className={classes}>
              {SEMANA[semana]}
              <strong>{Number(d.slice(8))}</strong>
            </div>
          );
        })}
        {linhas.map((linha) => {
          const imovel = imoveis.find((i) => i.id === linha.imovelId)!;
          return (
            <div key={linha.imovelId} style={{ display: "contents" }}>
              <div className={styles.nomeImovel} title={imovel.nome}>
                {imovel.codigo}
              </div>
              <div className={styles.linha} style={{ gridTemplateColumns: `repeat(${dias.length}, minmax(30px, 1fr))`, gridTemplateRows: `repeat(${linha.faixas}, auto)` }}>
                {linha.segmentos.map((s) => {
                  const classes = [styles.segmento, styles[s.categoria], s.continuaAntes ? styles.continuaAntes : "", s.continuaDepois ? styles.continuaDepois : ""].join(" ");
                  const estilo = { gridColumn: `${s.coluna} / span ${s.largura}`, gridRow: s.faixa + 1 };
                  const titulo = `${s.rotulo} (${br(s.inicio)} → ${br(s.fim)})`;
                  return s.href ? (
                    <a key={s.id} href={s.href} className={classes} style={estilo} title={titulo}>
                      {s.rotulo}
                    </a>
                  ) : (
                    <span key={s.id} className={classes} style={estilo} title={titulo}>
                      {s.rotulo}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
