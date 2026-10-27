import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { aprovarImportacaoAcao, desfazerImportacaoAcao, guardarCopiaAcao } from "@/calendario/acoes-importacao";
import { montarRevisao, type NoiteConferida, resumoDosImportados } from "@/calendario/importacao";
import { AcoesImportacao } from "@/components/calendario/AcoesImportacao";
import styles from "@/components/formularios.module.css";
import { mesPorExtenso } from "@/configuracoes/pagina-proprietarios";
import { getDb } from "@/db/client";
import { NOMES_FONTE_PRECOS } from "@/imoveis/fonte-precos";
import { dataBr, dataHoraNoFuso, haQuanto } from "@/lib/datas";
import { formatBRL } from "@/lib/money";

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const dinheiro = (v: number | null) => (v === null ? "—" : formatBRL(v));
const numero = (v: number | null) => (v === null ? "—" : String(v));
const NOMES_DIFERENCA: Record<NoiteConferida["diferencas"][number], string> = { preco: "preço", minimo: "mínimo", maximo: "máximo" };
/** Mais avisos por noite que isto ficam num <details>, fechado. */
const AVISOS_ABERTOS = 5;
const nota = { fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 };

/** O que difere numa noite: "igual", ou os campos, com a diferença de preço do SCL para o Beds24. */
function diferenca(n: NoiteConferida): string {
  if (!n.diferencas.length) return "igual";
  return n.diferencas
    .map((d) => (d === "preco" && n.precoBeds24 !== null && n.precoScl !== null ? `preço (${n.precoScl > n.precoBeds24 ? "+" : "−"}${formatBRL(Math.abs(n.precoScl - n.precoBeds24))})` : NOMES_DIFERENCA[d]))
    .join(", ");
}

/** Uma linha do "por mês": noite a noite, o Beds24 e o SCL depois de aprovar (sem conferência, só o Beds24). */
type LinhaDoMes = { data: string; precoBeds24: number | null; precoScl: number | null; minimoBeds24: number | null; minimoScl: number | null; diferenca: string };

/**
 * A revisão da importação dos preços do Beds24 de um imóvel (M3.11a, requisitos/product/FONTE-UNICA-PRECOS.md 3.4): o
 * topo (fonte, leitura, quarto e os bloqueios), a proposta com as caixas "Usar como…" (um formulário GET recarrega a
 * conferência com elas), a conferência pelo motor, o detalhe por mês e as ações. Só com `configuracao:editar`; aprovar e
 * desfazer pedem também `imovel:editar` (conferido de novo na ação).
 */
export default async function RevisarImportacao({ params, searchParams }: PageProps<"/painel/configuracoes/calendario/importar/[id]">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // As caixas: o formulário da proposta manda `conferir`; sem ele, a revisão escolhe (marcada se o cadastro não tem o valor).
  const usar = primeiro(sp.conferir) === "1" ? { precoBase: primeiro(sp.usarPrecoBase) === "sim", estadiaMaxima: primeiro(sp.usarEstadiaMaxima) === "sim" } : undefined;
  const db = getDb();
  const agora = new Date();
  const r = await montarRevisao(db, sessao.organizacaoId, id, agora, { usar });
  if (!r) notFound();
  const importados = (await resumoDosImportados(db, sessao.organizacaoId, r.hoje, [r.imovel.id])).get(r.imovel.id) ?? null;
  const editaImovel = podeFazer(sessao.papel, "imovel:editar");
  const p = r.proposta;
  const semAprovar = r.bloqueios.length ? "Aprovar fica disponível depois de resolver os avisos do topo." : !p.importar.length ? "Nada a importar." : !editaImovel ? "Aprovar pede a permissão de editar imóveis." : null;
  const diferentes = r.conferencia?.noites.filter((n) => n.diferencas.length) ?? [];
  const linhas: LinhaDoMes[] = r.conferencia
    ? r.conferencia.noites.map((n) => ({ ...n, diferenca: diferenca(n) }))
    : p.leitura.map((n) => ({ data: n.data, precoBeds24: n.preco, precoScl: null, minimoBeds24: n.minimo, minimoScl: null, diferenca: "—" }));
  const avisosPorNoite = <ul>{p.avisosNoites.map((a) => <li key={a.data}>{dataBr(a.data)}: {a.aviso}</li>)}</ul>;

  return <>
    <h2 style={{ fontSize: "1.25rem" }}>Importar preços do Beds24 — imóvel {r.imovel.codigo}</h2>
    <p style={{ margin: 0 }}><Link href="/painel/configuracoes/calendario/importar">Voltar à lista</Link> · <Link href={`/painel/imoveis/${r.imovel.id}`}>Ficha do imóvel</Link></p>
    <ul>
      <li>Fonte de preços: <strong>{NOMES_FONTE_PRECOS[r.fontePrecos]}</strong></li>
      <li>Leitura do Beds24: {r.lidaEm && p.inicio && p.fim ? `${haQuanto(r.lidaEm, agora)} (${dataHoraNoFuso(r.lidaEm, r.imovel.fuso)}), ${p.leitura.length} noites, de ${dataBr(p.inicio)} a ${dataBr(p.fim)}` : "Sem leitura"}</li>
      <li>Quarto do Beds24: {r.roomId ?? "sem vínculo"}</li>
      <li>Importados de hoje em diante: {importados ? `${importados.noites} noites, até ${dataBr(importados.fim)}` : "nada"}</li>
    </ul>
    {r.bloqueios.map((b) => <p key={b.motivo} role="alert" className={styles.alerta}>{b.texto}</p>)}

    <section aria-label="Proposta" style={{ display: "grid", gap: 12, maxWidth: 820 }}>
      <h3>Proposta</h3>
      <form method="get" className={styles.form} aria-label="Escolhas da importação">
        <input type="hidden" name="conferir" value="1" />
        <p style={{ margin: 0 }}><strong>Preço base:</strong> proposto {dinheiro(p.precoBase)} · atual {r.cadastro.precoBase === null ? "sem preço base" : dinheiro(r.cadastro.precoBase)}</p>
        <label className={styles.check}><input type="checkbox" name="usarPrecoBase" value="sim" defaultChecked={r.usar.precoBase} disabled={p.precoBase === null} /> Usar como preço base</label>
        <p style={nota}>Vale onde não houver preço importado e é a base dos eventos.</p>
        <p style={{ margin: 0 }}><strong>Estadia máxima:</strong> proposta {p.estadiaMaxima === null ? "—" : `${p.estadiaMaxima} noites`} · atual {p.estadiaMaximaAtual} noites{r.cadastro.estadiaMaxima === null ? " (de Configurações → Calendário e preços)" : ""}</p>
        <label className={styles.check}><input type="checkbox" name="usarEstadiaMaxima" value="sim" defaultChecked={r.usar.estadiaMaxima} disabled={p.estadiaMaxima === null} /> Usar como estadia máxima</label>
        <div className={styles.acoes}><button type="submit">Conferir com estas escolhas</button></div>
      </form>
      <p style={{ margin: 0 }}><strong>Noites a importar:</strong> {p.importar.length ? `${p.importar.length}, de ${dataBr(p.importar[0].data)} a ${dataBr(p.importar.at(-1)!.data)}, com o preço e o mínimo do Beds24.` : "nenhuma."}</p>
      {p.avisos.length > 0 && <ul>{p.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
      {p.avisosNoites.length > 0 && (p.avisosNoites.length > AVISOS_ABERTOS ? <details><summary>Avisos por noite ({p.avisosNoites.length})</summary>{avisosPorNoite}</details> : avisosPorNoite)}
      {p.sugestoes.length > 0 && <>
        <p style={{ margin: 0 }}><strong>Sugestões</strong> (nada é criado sozinho):</p>
        <ul>{p.sugestoes.map((s) => <li key={s.inicio}>{s.texto}</li>)}</ul>
      </>}
    </section>

    <section aria-label="Conferência" style={{ display: "grid", gap: 12 }}>
      <h3>Conferência</h3>
      {r.conferencia ? <>
        <p style={{ margin: 0 }}>Depois de aprovar, o SCL calcularia igual ao Beds24 em {r.conferencia.iguais} de {r.conferencia.total} noites.</p>
        {diferentes.length > 0 && <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <caption>Noites diferentes e o motivo do SCL</caption>
            <thead><tr><th scope="col">Noite</th><th scope="col">Beds24</th><th scope="col">SCL depois de aprovar</th><th scope="col">Diferença</th><th scope="col">Motivo</th></tr></thead>
            <tbody>{diferentes.map((n) => <tr key={n.data}>
              <th scope="row">{dataBr(n.data)}</th>
              <td>{dinheiro(n.precoBeds24)} · mín. {numero(n.minimoBeds24)} · máx. {numero(n.maximoBeds24)}</td>
              <td>{dinheiro(n.precoScl)} · mín. {numero(n.minimoScl)} · máx. {n.maximoScl ?? "—"}</td>
              <td>{diferenca(n)}</td>
              <td><small>{n.motivo}</small></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </> : <p style={{ margin: 0 }}>{r.fontePrecos !== "scl" ? "Sem conferência: a camada importada só vale com preços automáticos do SCL." : "Sem conferência: falta a leitura do Beds24 deste quarto."}</p>}
    </section>

    {p.meses.length > 0 && <section aria-label="Por mês" style={{ display: "grid", gap: 8 }}>
      <h3>Por mês</h3>
      {p.meses.map((m) => {
        const doMes = linhas.filter((l) => l.data.startsWith(m.mes));
        return <details key={m.mes}>
          <summary>{mesPorExtenso(m.mes)}: {m.noites} noites, de {dinheiro(m.menorPreco)} a {dinheiro(m.maiorPreco)}; mínimos {m.minimos.length ? m.minimos.join(", ") : "—"}</summary>
          <div className={styles.rolagem}>
            <table className={styles.tabela}>
              <thead><tr><th scope="col">Noite</th><th scope="col">Preço no Beds24</th><th scope="col">Preço do SCL</th><th scope="col">Mínimo no Beds24</th><th scope="col">Mínimo do SCL</th><th scope="col">Diferença</th></tr></thead>
              <tbody>{doMes.map((l) => <tr key={l.data}>
                <th scope="row">{dataBr(l.data)}</th><td>{dinheiro(l.precoBeds24)}</td><td>{dinheiro(l.precoScl)}</td><td>{numero(l.minimoBeds24)}</td><td>{numero(l.minimoScl)}</td><td>{l.diferenca}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>;
      })}
    </section>}

    <AcoesImportacao
      imovelId={r.imovel.id}
      codigo={r.imovel.codigo}
      assinatura={p.assinatura}
      usar={r.usar}
      noites={p.importar.length}
      semAprovar={semAprovar}
      importadas={importados?.noites ?? 0}
      podeDesfazer={editaImovel}
      aprovar={aprovarImportacaoAcao}
      guardarCopia={guardarCopiaAcao}
      desfazer={desfazerImportacaoAcao}
    />
  </>;
}
