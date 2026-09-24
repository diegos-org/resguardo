import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { listarAdiantamentos, NOMES_SITUACAO, resumoPorProprietario, type SituacaoAdiantamento } from "@/adiantamentos/adiantamentos";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { formatBRL } from "@/lib/money";

const dataBr = (d: string) => d.split("-").reverse().join("/");
const COR_SITUACAO: Record<SituacaoAdiantamento, string> = { a_cobrar: "#fdf3dc", parcial: "#e8eef7", quitado: "#e3efe0", contestado: "#fbeaea" };

export default async function Adiantamentos({ searchParams }: PageProps<"/painel/despesas/adiantamentos">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "financeiro:ler")) redirect("/painel");
  const { todos } = await searchParams;
  // O painel já é só da equipe; mesmo assim, proprietário nunca vê imóveis que não são dele.
  const lista = await listarAdiantamentos(getDb(), sessao.organizacaoId, {
    somenteAbertos: todos !== "1",
    ...(sessao.papel === "proprietario" ? { imovelIds: [...sessao.imovelIds] } : {}),
  });
  const resumo = resumoPorProprietario(lista);
  return (
    <>
      <h1>Adiantamentos</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Despesas dos proprietários que a empresa pagou. Cada uma é quitada uma vez só: por reembolso do proprietário, desconto no repasse
        mensal (ao fechar o mês em Financeiro → Repasses) ou assumida pela empresa. O que estiver contestado não é cobrado até você resolver.
      </p>
      {resumo.length > 0 && (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Proprietário</th>
                <th className={styles.numero}>A cobrar</th>
                <th className={styles.numero}>Contestado</th>
                <th className={styles.numero}>Adiantamentos</th>
              </tr>
            </thead>
            <tbody>
              {resumo.map((r) => (
                <tr key={r.proprietarioId}>
                  <td>{r.proprietario}</td>
                  <td className={styles.numero}>{formatBRL(r.aCobrar)}</td>
                  <td className={styles.numero}>{r.contestado ? formatBRL(r.contestado) : "—"}</td>
                  <td className={styles.numero}>{r.quantidade}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: 0, fontSize: "0.875rem" }}>
        {todos === "1" ? <Link href="/painel/despesas/adiantamentos">Ver só os em aberto</Link> : <Link href="/painel/despesas/adiantamentos?todos=1">Ver também os quitados</Link>}
      </p>
      {lista.length === 0 ? (
        <p>Nenhum adiantamento {todos === "1" ? "" : "em aberto"}.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Imóvel</th>
                <th>Proprietário</th>
                <th>Descrição</th>
                <th className={styles.numero}>Valor</th>
                <th className={styles.numero}>Em aberto</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id}>
                  <td>{dataBr(a.data)}</td>
                  <td>{a.imovel ?? "—"}</td>
                  <td>{a.proprietario}</td>
                  <td>
                    <Link href={`/painel/despesas/adiantamentos/${a.id}`}>{a.descricao.replace(/^Pago pela empresa: /, "")}</Link>
                  </td>
                  <td className={styles.numero}>{formatBRL(a.valor)}</td>
                  <td className={styles.numero}>{formatBRL(a.aberto)}</td>
                  <td>
                    <span className={styles.etiqueta} style={{ background: COR_SITUACAO[a.situacao] }}>
                      {NOMES_SITUACAO[a.situacao]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        <Link href="/painel/despesas">← Voltar para despesas</Link>
      </p>
    </>
  );
}
