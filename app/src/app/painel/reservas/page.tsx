import Link from "next/link";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { dataBr, dataHoraNoFuso } from "@/lib/datas";
import { descreverFiltros, lerFiltros, lerImoveisSelecionados, periodoDosFiltros } from "@/lib/filtros";
import { formatBRL } from "@/lib/money";
import { NOMES_ESTADO, NOMES_ORIGEM, noites } from "@/reservas/regras";
import { lerFiltrosLista, linkLista, listarReservasPaginadas, resumoImportacao, TAMANHO_PAGINA } from "@/reservas/listagem";

export default async function ListaReservas({ searchParams }: PageProps<"/painel/reservas">) {
  const sessao = await exigirSessaoPainel();
  const params = await searchParams;
  const db = getDb();
  const imoveis = await listarImoveis(db, sessao.organizacaoId, { incluirInativos: true });
  const opcoes = imoveis.map((i) => ({ codigo: i.codigo, nome: i.nome + (i.ativo ? "" : " (arquivado)") }));
  const filtros = lerFiltros(params, opcoes);
  const periodo = periodoDosFiltros(filtros);
  const local = lerFiltrosLista(params);
  const selecionados = lerImoveisSelecionados(params, opcoes);
  const somenteAtivos = selecionados.length === 0 && local.escopo !== "historico";
  const efetivos = imoveis.filter(i => selecionados.length ? selecionados.includes(i.codigo) : !somenteAtivos || i.ativo);
  const idsFiltro = efetivos.map(i => i.id);
  const descricao = descreverFiltros({ ...filtros, imoveis: efetivos.map(i => i.codigo) }, opcoes);
  const verCanceladas = params.canceladas === "1";
  const [resultado, ultima] = await Promise.all([
    listarReservasPaginadas(db, sessao.organizacaoId, local, { periodo, imovelIds: idsFiltro, incluirCanceladas: verCanceladas }),
    resumoImportacao(db, sessao.organizacaoId, local.execucao || undefined),
  ]);
  const lista = resultado.itens;
  const porId = new Map(imoveis.map((i) => [i.id, i]));
  const emConflito = new Set(lista.filter(r => r.conflito).map(r => r.id));
  const manterLocal = Object.entries(local).filter(([k]) => k !== "pagina").map(([k, v]) => [k, String(v)] as [string, string]);
  const pagina = (n: number) => linkLista(params, { pagina: String(n) });
  const verValores = podeFazer(sessao.papel, "financeiro:ler");

  return (
    <>
      <div className={styles.topo}>
        <h1>Reservas</h1>
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {podeFazer(sessao.papel, "reserva:editar") && podeFazer(sessao.papel, "financeiro:editar") && (
            <Link href="/painel/reservas/importar" className={styles.botao} style={{ background: "var(--scl-papel)", color: "var(--scl-texto)", border: "1px solid var(--scl-areia)" }}>
              Importar planilha
            </Link>
          )}
          {podeFazer(sessao.papel, "reserva:editar") && (
            <Link href="/painel/reservas/nova" className={styles.botao}>
              Nova reserva
            </Link>
          )}
        </span>
      </div>
      <p><Link href={linkLista({}, { escopo: "historico", ordem: "origem" })}>Ver reservas mais recentes na origem</Link> · <Link href={linkLista({}, { escopo: "historico", situacao: "consulta" })}>Ver consultas</Link></p>
      {ultima && <section aria-label="Mudanças da importação" className={styles.alerta}>
        <strong>{local.execucao ? "Importação selecionada" : "Última importação concluída"} · {dataHoraNoFuso(ultima.execucao.iniciadoEm)}</strong>
        <p>{ultima.execucao.resumo}</p>
        <p>{ultima.totais.length ? ultima.totais.map(t => <span key={t.tipo} style={{ marginRight: 16 }}><Link href={linkLista({}, { escopo: "historico", ordem: "origem", execucao: ultima.execucao.id, mudanca: t.tipo })}>{t.total} {t.tipo === "adicionada" ? "adicionadas ao SCL" : t.tipo === "alterada" ? "alteradas" : "canceladas"}</Link></span>) : "Sem registros detalhados nesta execução. Importações antigas não têm esta lista de mudanças."}</p>
        <p>Adicionada ao SCL não significa vendida agora. A data da origem aparece separadamente. Os detalhes mostram a situação atual.</p>
      </section>}
      <FiltroGlobal filtros={filtros} opcoes={opcoes} imoveisSelecionados={efetivos.map(i => i.codigo)} acao="/painel/reservas" manter={[...manterLocal, ...(verCanceladas ? [["canceladas", "1"] as [string, string]] : [])]} />
      <form method="get" action="/painel/reservas" className={styles.form} aria-label="Buscar reservas" style={{ maxWidth: 1000, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {selecionados.map(i => <input key={i} type="hidden" name="imovel" value={i} />)}
        <input type="hidden" name="mes" value={filtros.mes ?? "todos"} /><input type="hidden" name="ano" value={filtros.ano} />
        {verCanceladas && <input type="hidden" name="canceladas" value="1" />}
        {local.execucao && <><input type="hidden" name="execucao" value={local.execucao} /><input type="hidden" name="mudanca" value={local.mudanca} /></>}
        <label>Buscar por código SCL, código do canal ou hóspede<input name="busca" maxLength={100} defaultValue={local.busca} /></label>
        <label>Consultar<select name="escopo" defaultValue={local.escopo}><option value="periodo">Estadias no período acima</option><option value="historico">Todo o histórico importado/cadastrado</option></select></label>
        <label>Situação<select name="situacao" defaultValue={local.situacao}><option value="todas">Todas</option>{Object.entries(NOMES_ESTADO).map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}</select></label>
        <label>Ordenar por<select name="ordem" defaultValue={local.ordem}><option value="checkin">Data de entrada</option><option value="origem">Mais recentes na origem</option></select></label>
        <label>Feitas na origem<select name="recentes" defaultValue={local.recentes}><option value="0">Qualquer data</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select></label>
        <label>Pedido de cancelamento<select name="cancelamento" defaultValue={local.cancelamento}><option value="todas">Com ou sem pedido</option><option value="pedido">Só com pedido esperando a equipe</option></select></label>
        <button type="submit">Buscar reservas</button>
      </form>
      {local.execucao && <p>Mostrando mudanças da importação selecionada. <Link href={linkLista(params, { execucao: null, mudanca: null })}>Ver todas as importações</Link></p>}
      {local.cancelamento === "pedido" && <p role="note">Mostrando só as reservas com pedido de cancelamento esperando a equipe, de qualquer período. <Link href={linkLista(params, { cancelamento: null })}>Ver todas as reservas</Link></p>}
      <p>Consultas não ocupam datas. A data da origem é a informada pelo Beds24. Datas ausentes ficam como “Não informada” e no fim da ordenação por mais recentes; não entram nos filtros de 7 ou 30 dias.</p>
      <p className={styles.etiqueta} style={{ alignSelf: "flex-start" }}>
        {local.escopo === "historico" ? "Todo o histórico · imóveis selecionados" : efetivos.length ? descricao : "Nenhum imóvel ativo selecionado"} · {resultado.total} registro(s) · página {resultado.pagina} de {resultado.paginas}
      </p>
      {emConflito.size > 0 && (
        <p role="alert" className={styles.alerta}>
          Atenção: há reservas sobrepostas no mesmo imóvel (possível overbooking). Elas estão marcadas em vermelho.
        </p>
      )}
      {lista.length === 0 ? (
        <p>Nenhum registro corresponde aos filtros. Experimente “Todo o histórico” ou remova a busca e o filtro de situação.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Código</th>
                <th>Imóvel</th>
                <th>Origem</th>
                <th>Feita em (origem)</th>
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
                <tr key={r.id} className={r.estado === "cancelada" ? styles.inativo : undefined} style={emConflito.has(r.id) ? { background: "var(--scl-erro-fundo)" } : undefined}>
                  <td>
                    <Link href={`/painel/reservas/${r.id}`}>{r.codigo}</Link>
                  </td>
                  <td>{porId.get(r.imovelId)?.codigo ?? "—"}</td>
                  <td>{NOMES_ORIGEM[r.origem]}</td>
                  <td>{r.reservadaEm ? dataHoraNoFuso(r.reservadaEm) : "Não informada"}</td>
                  <td>{dataBr(r.checkin)}</td>
                  <td>{dataBr(r.checkout)}</td>
                  <td>{noites(r.checkin, r.checkout)}</td>
                  <td>{r.hospedeNome || "—"}</td>
                  {verValores && <td className={styles.numero}>{r.valorBruto === null ? "—" : formatBRL(r.valorBruto)}</td>}
                  <td>
                    <span className={styles.etiqueta}>{NOMES_ESTADO[r.estado]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label="Páginas de reservas" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        {resultado.pagina > 1 && <><Link href={pagina(1)}>Primeira</Link><Link href={pagina(resultado.pagina - 1)}>Anterior</Link></>}
        <span>{resultado.total ? (resultado.pagina - 1) * TAMANHO_PAGINA + 1 : 0}–{Math.min(resultado.pagina * TAMANHO_PAGINA, resultado.total)} de {resultado.total}</span>
        {resultado.pagina < resultado.paginas && <><Link href={pagina(resultado.pagina + 1)}>Próxima</Link><Link href={pagina(resultado.paginas)}>Última</Link></>}
      </nav>
      {local.situacao === "todas" && !local.execucao && <p><Link href={linkLista(params, { canceladas: verCanceladas ? null : "1" })}>{verCanceladas ? "Esconder canceladas" : "Mostrar canceladas"}</Link></p>}
    </>
  );
}
