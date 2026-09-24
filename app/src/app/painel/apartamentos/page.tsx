import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { descreverFiltros, lerFiltros, periodoDosFiltros } from "@/lib/filtros";
import { formatBRL } from "@/lib/money";
import { type ChaveColuna, carregarApartamentos, COLUNAS, type DonoAnterior, type LinhaApartamento, lerColunas, lerIntervalo, type Sentido } from "@/painel/apartamentos";

const pct = (t: number | null) => (t === null ? "—" : `${Math.round(t * 100)}%`);
const mesBr = (m: string) => m.split("-").reverse().join("/");

/** Saldo do acerto com o sentido por extenso (positivo: a empresa deve ao proprietário). */
function Saldo({ valor }: { valor: number }) {
  if (valor === 0) return <>{formatBRL(0)}</>;
  return (
    <>
      {formatBRL(Math.abs(valor))}
      <br />
      <small style={{ color: "var(--scl-texto-2)" }}>{valor > 0 ? "empresa deve" : "proprietário deve"}</small>
    </>
  );
}

/** Total do acerto por sentido: quanto a empresa deve (somando credores) e quanto devem a ela. */
function PorSentido({ s }: { s: Sentido }) {
  return (
    <>
      {formatBRL(s.empresaDeve)}
      <br />
      <small style={{ color: "var(--scl-texto-2)" }}>empresa deve</small>
      <br />
      {formatBRL(s.proprietariosDevem)}
      <br />
      <small style={{ color: "var(--scl-texto-2)" }}>proprietários devem</small>
    </>
  );
}

/** Valores de proprietários anteriores do imóvel, um por linha (nunca somados com o do dono atual). */
function Anteriores({ lista, valor }: { lista: readonly DonoAnterior[]; valor: (x: DonoAnterior) => number }) {
  return (
    <>
      {lista
        .filter((x) => valor(x) !== 0)
        .map((x) => (
          <span key={x.proprietarioId}>
            <br />
            <small style={{ color: "#b3261e" }}>
              + {formatBRL(Math.abs(valor(x)))} com {x.nome} ({valor(x) > 0 ? "empresa deve" : "ele deve"})
            </small>
          </span>
        ))}
    </>
  );
}

function celula(l: LinhaApartamento, c: ChaveColuna): React.ReactNode {
  const f = l.financeiro;
  switch (c) {
    case "reservas":
      return l.imovelId || l.codigo === "Total" ? l.reservas : "—";
    case "ocupacao":
      return l.noitesDisponiveis ? (
        <>
          {pct(l.ocupacao)}
          <br />
          <small style={{ color: "var(--scl-texto-2)" }}>
            {l.noitesVendidas}/{l.noitesDisponiveis} noites
          </small>
        </>
      ) : (
        "—"
      );
    case "receita":
      return formatBRL(f.receitaBruta);
    case "taxas":
      return formatBRL(f.taxasCanais);
    case "comissoes":
      return formatBRL(f.comissoes);
    case "despesas":
      return formatBRL(f.despesasEmpresa);
    case "ajustes":
      return formatBRL(f.ajustesEmpresa);
    case "resultado":
      return <strong>{formatBRL(f.resultadoEmpresa)}</strong>;
    case "despesasProprietario":
      return formatBRL(l.despesasProprietario);
    case "acertoPeriodo":
      if (l.porSentido) return <PorSentido s={l.porSentido.acertoPeriodo} />;
      return (
        <>
          <Saldo valor={l.acertoPeriodo} />
          <Anteriores lista={l.anteriores} valor={(x) => x.acertoPeriodo} />
        </>
      );
    case "saldo":
      if (l.porSentido) return <PorSentido s={l.porSentido.saldo} />;
      return (
        <>
          <Saldo valor={l.saldo} />
          <Anteriores lista={l.anteriores} valor={(x) => x.saldo} />
        </>
      );
    case "aCobrar":
      return (
        <>
          {formatBRL(l.aCobrar)}
          {l.contestados > 0 && (
            <>
              <br />
              <small style={{ color: "#b3261e" }}>{l.contestados} contestado(s)</small>
            </>
          )}
          {l.anteriores
            .filter((x) => x.aCobrar || x.contestados)
            .map((x) => (
              <span key={x.proprietarioId}>
                <br />
                <small style={{ color: "#b3261e" }}>
                  + {formatBRL(x.aCobrar)} de {x.nome}
                  {x.contestados ? ` (${x.contestados} contestado(s))` : ""}
                </small>
              </span>
            ))}
        </>
      );
  }
}

export default async function Apartamentos({ searchParams }: PageProps<"/painel/apartamentos">) {
  const sessao = await exigirSessaoPainel();
  // Tela interna: mostra o acerto de todos os proprietários (inclusive anteriores). O proprietário
  // vê só o dele no portal (M5).
  if (!podeFazer(sessao.papel, "financeiro:ler") || sessao.papel === "proprietario") redirect("/painel");
  const params = await searchParams;
  const db = getDb();
  const imoveis = await listarImoveis(db, sessao.organizacaoId, { incluirInativos: true });
  const opcoes = imoveis.filter((i) => i.ativo).map((i) => ({ codigo: i.codigo, nome: i.nome }));
  const filtros = lerFiltros(params, opcoes);
  const intervalo = lerIntervalo(params);
  const periodo = intervalo.periodo ?? periodoDosFiltros(filtros);
  const colunas = lerColunas(params);
  const todos = filtros.imoveis.length === 0;
  const selecionados = filtros.imoveis.length ? imoveis.filter((i) => filtros.imoveis.includes(i.codigo)) : imoveis;
  const { linhas, total } = await carregarApartamentos(db, sessao.organizacaoId, { imoveis: selecionados, todos, periodo });
  const escolhidas = COLUNAS.filter((c) => colunas.includes(c.chave));
  const textoPeriodo = intervalo.periodo ? `${mesBr(intervalo.de!)} a ${mesBr(intervalo.ate!)}` : null;

  return (
    <>
      <h1>Apartamentos</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Uma linha por imóvel. O resultado é o da empresa (comissões − despesas da empresa + ajustes). O acerto com o proprietário fica à parte:
        despesas dele, o que mudou no período, o saldo acumulado e os adiantamentos a cobrar.
      </p>
      <FiltroGlobal filtros={filtros} opcoes={opcoes} acao="/painel/apartamentos" manter={colunas.map((c) => ["col", c] as [string, string])} />

      <form method="get" action="/painel/apartamentos" className={styles.form} aria-label="Como ver">
        {filtros.imoveis.map((c) => (
          <input key={c} type="hidden" name="imovel" value={c} />
        ))}
        <input type="hidden" name="ano" value={filtros.ano} />
        <input type="hidden" name="mes" value={filtros.mes ?? "todos"} />
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <legend style={{ fontWeight: 600, marginBottom: 4 }}>Intervalo de meses (opcional, substitui o mês/ano do filtro)</legend>
          <label style={{ flex: "0 1 200px" }}>
            De
            <input type="month" name="de" defaultValue={intervalo.de ?? ""} />
          </label>
          <label style={{ flex: "0 1 200px" }}>
            Até
            <input type="month" name="ate" defaultValue={intervalo.ate ?? ""} />
          </label>
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 4 }}>Colunas</legend>
          <div style={{ display: "flex", gap: "4px 16px", flexWrap: "wrap" }}>
            {COLUNAS.map((c) => (
              <label key={c.chave} style={{ flexDirection: "row", flex: "0 0 auto", minWidth: 0, gap: 6, alignItems: "center", color: "var(--scl-texto)" }}>
                <input type="checkbox" name="col" value={c.chave} defaultChecked={colunas.includes(c.chave)} />
                {c.titulo}
              </label>
            ))}
          </div>
        </fieldset>
        <div className={styles.acoes}>
          <button type="submit">Ver</button>
          <Link href="/painel/apartamentos">Voltar ao padrão</Link>
        </div>
      </form>

      {intervalo.aviso && (
        <p role="alert" className={styles.alerta}>
          {intervalo.aviso}
        </p>
      )}
      <p className={styles.etiqueta} style={{ alignSelf: "flex-start" }}>
        {textoPeriodo ? `${descreverFiltros(filtros, opcoes).split(" · ")[0]} · ${textoPeriodo}` : descreverFiltros(filtros, opcoes)}
      </p>

      {linhas.length === 0 ? (
        <p>Nenhum imóvel nesta seleção.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th scope="col">Imóvel</th>
                {escolhidas.map((c) => (
                  <th key={c.chave} scope="col" style={{ textAlign: "right" }}>
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.imovelId ?? "geral"}>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 400 }}>
                    {l.imovelId ? <Link href={`/painel/imoveis/${l.imovelId}`}>{l.codigo}</Link> : l.nome}
                    {l.imovelId && l.nome !== l.codigo && <span style={{ color: "var(--scl-texto-2)" }}> · {l.nome}</span>}
                    {!l.ativo && <small style={{ color: "var(--scl-texto-2)" }}> (arquivado)</small>}
                  </th>
                  {escolhidas.map((c) => (
                    <td key={c.chave} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {celula(l, c.chave)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" style={{ textAlign: "left" }}>
                  Total
                </th>
                {escolhidas.map((c) => (
                  <td key={c.chave} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {celula(total, c.chave)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.8125rem", maxWidth: 820, margin: 0 }}>
        Valores pelo mês de competência. &ldquo;Saldo do acerto&rdquo; é o acumulado até o fim do período, do proprietário atual (o de um dono anterior aparece à parte); &ldquo;Adiantamentos a cobrar&rdquo; é o
        de hoje e não inclui os contestados.
      </p>
    </>
  );
}
