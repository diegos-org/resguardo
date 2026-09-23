import Link from "next/link";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { descreverFiltros, lerFiltros, manterFiltros, periodoDosFiltros } from "@/lib/filtros";
import { formatBRL } from "@/lib/money";
import { conflitos, NOMES_ESTADO, NOMES_ORIGEM, noites } from "@/reservas/regras";
import { listarReservas } from "@/reservas/repositorio";

const dataBr = (d: string) => d.split("-").reverse().join("/");

export default async function ListaReservas({ searchParams }: PageProps<"/painel/reservas">) {
  const sessao = await exigirSessaoPainel();
  const params = await searchParams;
  const db = getDb();
  const imoveis = await listarImoveis(db, sessao.organizacaoId);
  const opcoes = imoveis.map((i) => ({ codigo: i.codigo, nome: i.nome }));
  const filtros = lerFiltros(params, opcoes);
  const periodo = periodoDosFiltros(filtros);
  const idsFiltro = filtros.imoveis.length ? imoveis.filter((i) => filtros.imoveis.includes(i.codigo)).map((i) => i.id) : undefined;
  const verCanceladas = params.canceladas === "1";
  const lista = await listarReservas(db, sessao.organizacaoId, { ...periodo, imovelIds: idsFiltro, incluirCanceladas: verCanceladas });

  const porId = new Map(imoveis.map((i) => [i.id, i]));
  const emConflito = new Set(conflitos(lista).flat());
  const verValores = podeFazer(sessao.papel, "financeiro:ler");

  return (
    <>
      <div className={styles.topo}>
        <h1>Reservas</h1>
        {podeFazer(sessao.papel, "reserva:editar") && (
          <Link href="/painel/reservas/nova" className={styles.botao}>
            Nova reserva
          </Link>
        )}
      </div>
      <FiltroGlobal filtros={filtros} opcoes={opcoes} acao="/painel/reservas" />
      <p className={styles.etiqueta} style={{ alignSelf: "flex-start" }}>
        {descreverFiltros(filtros, opcoes)} · {lista.length} reserva(s)
      </p>
      {emConflito.size > 0 && (
        <p role="alert" className={styles.alerta}>
          Atenção: há reservas sobrepostas no mesmo imóvel (possível overbooking). Elas estão marcadas em vermelho.
        </p>
      )}
      {lista.length === 0 ? (
        <p>Nenhuma reserva neste período.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Código</th>
                <th>Imóvel</th>
                <th>Origem</th>
                <th>Entrada</th>
                <th>Saída</th>
                <th>Noites</th>
                <th>Hóspede</th>
                {verValores && <th>Bruto</th>}
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.id} className={r.estado === "cancelada" ? styles.inativo : undefined} style={emConflito.has(r.id) ? { background: "#fbeaea" } : undefined}>
                  <td>
                    <Link href={`/painel/reservas/${r.id}`}>{r.codigo}</Link>
                  </td>
                  <td>{porId.get(r.imovelId)?.codigo ?? "—"}</td>
                  <td>{NOMES_ORIGEM[r.origem]}</td>
                  <td>{dataBr(r.checkin)}</td>
                  <td>{dataBr(r.checkout)}</td>
                  <td>{noites(r.checkin, r.checkout)}</td>
                  <td>{r.hospedeNome || "—"}</td>
                  {verValores && <td>{r.valorBruto === null ? "—" : formatBRL(r.valorBruto)}</td>}
                  <td>
                    <span className={styles.etiqueta}>{NOMES_ESTADO[r.estado]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: "0.875rem" }}>
        {verCanceladas ? (
          <Link href={`/painel/reservas${manterFiltros(params)}`}>Esconder canceladas</Link>
        ) : (
          <Link href={`/painel/reservas${manterFiltros(params) || "?"}${manterFiltros(params) ? "&" : ""}canceladas=1`}>Mostrar canceladas</Link>
        )}
      </p>
    </>
  );
}
