/** Gráficos simples em SVG/CSS (sem biblioteca): leves, acessíveis e iguais no celular. */

const brlCurto = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Barras por mês: receita bruta (clara) e comissões (escura). O mês do filtro fica destacado. */
export function GraficoMensal({ dados, mesAtual }: { dados: { mes: number; receitaBruta: number; comissoes: number }[]; mesAtual: number | null }) {
  const max = Math.max(1, ...dados.map((d) => d.receitaBruta), ...dados.map((d) => d.comissoes));
  const L = 560;
  const A = 180;
  const passo = L / 12;
  const larg = passo * 0.36;
  const altura = (v: number) => Math.max(0, (v / max) * (A - 30));
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-label="Receita bruta e comissões por mês" style={{ width: "100%", height: "auto", maxWidth: 720 }}>
        {dados.map((d, i) => {
          const x = i * passo + passo * 0.12;
          const destaque = mesAtual === d.mes;
          return (
            <g key={d.mes}>
              <title>{`${MESES[i]}: receita ${brlCurto(d.receitaBruta)}, comissões ${brlCurto(d.comissoes)}`}</title>
              <rect x={x} y={A - 20 - altura(d.receitaBruta)} width={larg} height={altura(d.receitaBruta)} fill={destaque ? "var(--scl-borda)" : "var(--scl-areia)"} />
              <rect x={x + larg} y={A - 20 - altura(d.comissoes)} width={larg} height={altura(d.comissoes)} fill={destaque ? "var(--scl-floresta)" : "var(--scl-salvia)"} />
              <text x={x + larg} y={A - 5} fontSize="11" textAnchor="middle" fill="var(--scl-texto-2)" fontWeight={destaque ? 700 : 400}>
                {MESES[i]}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)", display: "flex", gap: 16 }}>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--scl-areia)", marginRight: 4 }} />
          Receita bruta
        </span>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--scl-musgo)", marginRight: 4 }} />
          Comissões SCL
        </span>
      </figcaption>
    </figure>
  );
}

/** Barra horizontal de ocupação por imóvel. */
export function BarrasOcupacao({ linhas }: { linhas: { codigo: string; nome: string; vendidas: number; disponiveis: number; taxa: number | null }[] }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {linhas.map((l) => (
        <li key={l.codigo} style={{ display: "grid", gridTemplateColumns: "minmax(80px, 140px) 1fr 64px", gap: 8, alignItems: "center", fontSize: "0.875rem" }}>
          <span title={l.nome}>{l.codigo}</span>
          <span style={{ background: "var(--scl-neutro-fundo)", borderRadius: 4, height: 12, overflow: "hidden" }} aria-hidden>
            <span style={{ display: "block", height: "100%", width: `${Math.round((l.taxa ?? 0) * 100)}%`, background: "var(--scl-musgo)" }} />
          </span>
          <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={`${l.vendidas} de ${l.disponiveis} noites`}>
            {l.taxa === null ? "—" : `${Math.round(l.taxa * 100)}%`}
          </span>
        </li>
      ))}
    </ul>
  );
}
