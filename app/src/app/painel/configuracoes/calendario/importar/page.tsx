import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { NOMES_MOTIVO_COPIA } from "@/calendario/copias";
import { listarImportacoes } from "@/calendario/importacao";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { NOMES_FONTE_PRECOS } from "@/imoveis/fonte-precos";
import { dataBr, dataHoraNoFuso, dataNoFuso, haQuanto } from "@/lib/datas";

/** A lista da importação dos preços do Beds24 (M3.11a, requisitos/product/FONTE-UNICA-PRECOS.md 3.4). Só com `configuracao:editar`. */
export default async function ImportarPrecos() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const agora = new Date();
  const lista = await listarImportacoes(getDb(), sessao.organizacaoId, agora);
  return <>
    <h2 style={{ fontSize: "1.25rem" }}>Importar preços do Beds24</h2>
    <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
      Traz para o SCL o preço e o mínimo de cada noite que estão hoje no Beds24. Nada muda nas OTAs. Depois, eventos, feriadões e períodos do SCL valem por cima.
    </p>
    <p style={{ margin: 0 }}><Link href="/painel/configuracoes/calendario">Voltar a Calendário e preços</Link></p>
    {!lista.length ? <p>Nenhum imóvel ativo.</p> : <div className={styles.rolagem}>
      <table className={styles.tabela}>
        <caption>Imóveis ativos e o que já foi importado, de hoje em diante</caption>
        <thead><tr><th scope="col">Imóvel</th><th scope="col">Fonte de preços</th><th scope="col">Última leitura</th><th scope="col">Importados</th><th scope="col">Última cópia</th><th scope="col">Revisão</th></tr></thead>
        <tbody>{lista.map((i) => <tr key={i.id}>
          <th scope="row">{i.codigo}<br /><small>{i.nome}</small></th>
          <td>{NOMES_FONTE_PRECOS[i.fontePrecos]}</td>
          <td>{i.lidaEm ? <>{haQuanto(i.lidaEm, agora)}<br /><small>{dataHoraNoFuso(i.lidaEm, i.fuso)}</small></> : "Sem leitura"}</td>
          <td>{i.importados ? `${i.importados.noites} noites, de ${dataBr(i.importados.inicio)} a ${dataBr(i.importados.fim)}, em ${dataNoFuso(i.importados.em, i.fuso)}${i.importados.autor ? ` por ${i.importados.autor}` : ""}` : "Nada importado"}</td>
          <td>{i.ultimaCopia ? `${dataHoraNoFuso(i.ultimaCopia.criadoEm, i.fuso)}, ${NOMES_MOTIVO_COPIA[i.ultimaCopia.motivo]}` : "Nenhuma"}</td>
          <td><Link href={`/painel/configuracoes/calendario/importar/${i.id}`}>Revisar</Link></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </>;
}
