import Link from "next/link";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import { getDb } from "@/db/client";
import { listarDespesas, totaisDespesas } from "@/despesas/despesas";
import { listarImoveis } from "@/imoveis/repositorio";
import { descreverFiltros, lerFiltros, manterFiltros, periodoDosFiltros } from "@/lib/filtros";
import { formatBRL } from "@/lib/money";
import { redirect } from "next/navigation";

const dataBr = (d: string) => d.split("-").reverse().join("/");

export default async function ListaDespesas({ searchParams }: PageProps<"/painel/despesas">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "financeiro:ler")) redirect("/painel");
  const params = await searchParams;
  const db = getDb();
  const imoveis = await listarImoveis(db, sessao.organizacaoId, { incluirInativos: true });
  const opcoes = imoveis.filter((i) => i.ativo).map((i) => ({ codigo: i.codigo, nome: i.nome }));
  const filtros = lerFiltros(params, opcoes);
  const periodo = periodoDosFiltros(filtros);
  const verEstornadas = params.estornadas === "1";
  // Sem imóvel escolhido: todas (inclusive as gerais da empresa, sem imóvel).
  const imovelIds = filtros.imoveis.length ? imoveis.filter((i) => filtros.imoveis.includes(i.codigo)).map((i) => i.id) : undefined;
  const lista = await listarDespesas(db, sessao.organizacaoId, { ...periodo, imovelIds, incluirEstornadas: verEstornadas });
  const t = totaisDespesas(lista);
  const porId = new Map(imoveis.map((i) => [i.id, i]));
  const editar = podeFazer(sessao.papel, "despesa:editar");
  const q = manterFiltros(params);

  return (
    <>
      <div className={styles.topo}>
        <h1>Despesas</h1>
        {editar && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/painel/despesas/categorias" className={styles.botao} style={{ background: "#fff", color: "var(--scl-salvia)", border: "1px solid currentColor" }}>
              Categorias
            </Link>
            <Link href="/painel/despesas/nova" className={styles.botao}>
              Nova despesa
            </Link>
          </div>
        )}
      </div>
      <FiltroGlobal filtros={filtros} opcoes={opcoes} acao="/painel/despesas" />
      <p className={styles.etiqueta} style={{ alignSelf: "flex-start" }}>
        {descreverFiltros(filtros, opcoes)} · {lista.length} despesa(s)
      </p>
      <dl style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: 0 }}>
        {[
          ["Da empresa", t.empresa],
          ["Dos proprietários", t.proprietarios],
          ["A cobrar dos proprietários", t.aCobrar],
          ["Ainda a pagar", t.aPagar],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dt style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>{k}</dt>
            <dd style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>{formatBRL(v as number)}</dd>
          </div>
        ))}
      </dl>
      {lista.length === 0 ? (
        <p>Nenhuma despesa neste período.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>De quem</th>
                <th>Imóvel</th>
                <th>Valor</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id} className={d.estornada ? styles.inativo : undefined}>
                  <td>{dataBr(d.competencia)}</td>
                  <td>
                    <Link href={`/painel/despesas/${d.id}`}>{d.descricao}</Link>
                  </td>
                  <td>{d.categoria ?? "—"}</td>
                  <td>{d.tipo === "despesa_empresa" ? "Empresa" : d.pagoPor === "empresa" ? "Proprietário (empresa paga)" : "Proprietário (ele pagou)"}</td>
                  <td>{d.imovelId ? (porId.get(d.imovelId)?.codigo ?? "—") : "Geral"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatBRL(d.montante ?? -d.valor)}</td>
                  <td>
                    <span className={styles.etiqueta}>{d.estornada ? "Estornada" : d.estado === "previsto" ? "A pagar" : "Paga"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: "0.875rem" }}>
        {verEstornadas ? (
          <Link href={`/painel/despesas${q}`}>Esconder estornadas</Link>
        ) : (
          <Link href={`/painel/despesas${q || "?"}${q ? "&" : ""}estornadas=1`}>Mostrar estornadas</Link>
        )}
      </p>
    </>
  );
}
