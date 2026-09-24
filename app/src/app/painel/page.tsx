import Link from "next/link";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import { BarrasOcupacao, GraficoMensal } from "@/components/painel/Graficos";
import styles from "@/components/painel/painel.module.css";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { hojeISO } from "@/lib/datas";
import { descreverFiltros, lerFiltros, manterFiltros, periodoDosFiltros } from "@/lib/filtros";
import { formatBRL } from "@/lib/money";
import { carregarDashboard } from "@/painel/dashboard";

const dataBr = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
const pct = (t: number | null) => (t === null ? "—" : `${Math.round(t * 100)}%`);

function Numero({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
  return (
    <div className={styles.cartao} style={{ padding: 16 }}>
      <div className={styles.muted}>{titulo}</div>
      <div style={{ fontSize: "1.5rem", fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{valor}</div>
      {detalhe && <div className={styles.muted} style={{ marginTop: 2 }}>{detalhe}</div>}
    </div>
  );
}

export default async function PainelInicio({ searchParams }: PageProps<"/painel">) {
  const sessao = await exigirSessaoPainel();
  const db = getDb();
  // Arquivados entram nas contas de "todos os imóveis" (como no financeiro), mas não no filtro.
  const imoveis = await listarImoveis(db, sessao.organizacaoId, { incluirInativos: true });
  const opcoes = imoveis.filter((i) => i.ativo).map((i) => ({ codigo: i.codigo, nome: i.nome }));
  const params = await searchParams;
  const filtros = lerFiltros(params, opcoes);
  const query = manterFiltros(params);
  const selecionados = filtros.imoveis.length ? imoveis.filter((i) => i.ativo && filtros.imoveis.includes(i.codigo)) : imoveis;
  const verFinanceiro = podeFazer(sessao.papel, "financeiro:ler");
  const hoje = hojeISO();
  const d = await carregarDashboard(db, sessao.organizacaoId, {
    imoveis: selecionados,
    todos: filtros.imoveis.length === 0,
    periodo: periodoDosFiltros(filtros),
    ano: filtros.ano,
    hoje,
    verFinanceiro,
  });
  const porId = new Map(imoveis.map((i) => [i.id, i]));

  return (
    <>
      <h1>Início</h1>
      <FiltroGlobal filtros={filtros} opcoes={opcoes} acao="/painel" />
      <p className={styles.muted} style={{ margin: 0 }}>
        {descreverFiltros(filtros, opcoes)} · {d.reservasNoPeriodo} reserva(s) no período
      </p>

      <section aria-label="Números do período" className={styles.grade}>
        <Numero titulo="Ocupação" valor={pct(d.ocupacaoTotal.taxa)} detalhe={`${d.ocupacaoTotal.vendidas} de ${d.ocupacaoTotal.disponiveis} noites`} />
        {d.financeiro && (
          <>
            <Numero titulo="Receita bruta das reservas" valor={formatBRL(d.financeiro.receitaBruta)} detalhe={`Taxas dos canais: ${formatBRL(d.financeiro.taxasCanais)}`} />
            <Numero titulo="Comissões SCL" valor={formatBRL(d.financeiro.comissoes)} />
            <Numero titulo="Despesas da empresa" valor={formatBRL(d.financeiro.despesasEmpresa)} />
            <Numero
              titulo="Resultado da empresa"
              valor={formatBRL(d.financeiro.resultadoEmpresa)}
              detalhe={d.financeiro.ajustesEmpresa ? `inclui ajustes de ${formatBRL(d.financeiro.ajustesEmpresa)}` : "comissões − despesas"}
            />
          </>
        )}
      </section>

      <section aria-label="Pendências e alertas" className={styles.cartao}>
        <h2>Pendências e alertas</h2>
        {d.alertas.length === 0 ? (
          <p className={styles.muted}>Nada pendente na seleção.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            {d.alertas.map((a) => (
              <li key={a.texto} style={{ color: a.nivel === "atencao" ? "#7a2020" : "inherit" }}>
                {a.texto} {a.link && <Link href={`${a.link}${query}`}>Ver</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={styles.grade} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <section aria-label="Próximas entradas" className={styles.cartao}>
          <h2>Entradas nos próximos 7 dias</h2>
          {d.proximasEntradas.length === 0 ? (
            <p className={styles.muted}>Nenhuma.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {d.proximasEntradas.map((r) => (
                <li key={r.id}>
                  {dataBr(r.checkin)} · {porId.get(r.imovelId)?.codigo} · <Link href={`/painel/reservas/${r.id}`}>{r.hospedeNome || r.codigo}</Link>
                  {r.hospedes ? ` (${r.hospedes})` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Próximas saídas" className={styles.cartao}>
          <h2>Saídas nos próximos 7 dias</h2>
          {d.proximasSaidas.length === 0 ? (
            <p className={styles.muted}>Nenhuma.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {d.proximasSaidas.map((r) => (
                <li key={r.id}>
                  {r.checkout === hoje ? "hoje" : dataBr(r.checkout)} · {porId.get(r.imovelId)?.codigo} ·{" "}
                  <Link href={`/painel/reservas/${r.id}`}>{r.hospedeNome || r.codigo}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className={styles.grade} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <section aria-label="Ocupação por imóvel" className={styles.cartao}>
          <h2>Ocupação por imóvel</h2>
          <BarrasOcupacao linhas={d.ocupacao} />
          <p className={styles.muted} style={{ marginTop: 8 }}>
            Noites vendidas ÷ noites disponíveis (dias bloqueados não contam).
          </p>
        </section>
        {d.porMes && (
          <section aria-label="Receita por mês" className={styles.cartao}>
            <h2>Receita e comissões em {filtros.ano}</h2>
            <GraficoMensal dados={d.porMes} mesAtual={filtros.mes} />
          </section>
        )}
      </div>
    </>
  );
}
