import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { descricaoAjuste, listarAjustes } from "@/ajustes/ajustes";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { formatBRL } from "@/lib/money";

const dataBr = (d: string) => d.split("-").reverse().join("/");

export default async function Ajustes() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "financeiro:ler")) redirect("/painel");
  // Proprietário só vê ajustes dos imóveis dele (deny-by-default).
  const lista = await listarAjustes(getDb(), sessao.organizacaoId, sessao.papel === "proprietario" ? { imovelIds: [...sessao.imovelIds] } : {});
  return (
    <>
      <div className={styles.topo}>
        <h1>Ajustes e divergências</h1>
        {podeFazer(sessao.papel, "financeiro:editar") && (
          <Link href="/painel/financeiro/ajustes/nova" className={styles.botao}>
            Registrar ajuste
          </Link>
        )}
      </div>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Achou uma diferença? Registre no mesmo dia, com o que foi consultado. Sem motivo conhecido, o sistema usa “motivo não identificado”; sem
        valor conhecido, nada vai para o financeiro. O ajuste fica pendente até ser esclarecido.
      </p>
      {lista.length === 0 ? (
        <p>Nenhum ajuste registrado.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Imóvel</th>
                <th>Descrição</th>
                <th className={styles.numero}>Valor</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id}>
                  <td>{dataBr(a.data)}</td>
                  <td>{a.imovelCodigo ?? "—"}</td>
                  <td>
                    <Link href={`/painel/financeiro/ajustes/${a.id}`}>{descricaoAjuste(a)}</Link>
                  </td>
                  <td className={styles.numero}>{a.valor === null ? "desconhecido" : formatBRL(a.valor)}</td>
                  <td>
                    <span className={styles.etiqueta} style={{ background: a.esclarecidoEm ? "#e3efe0" : "#fdf3dc" }}>
                      {a.esclarecidoEm ? "Esclarecido" : "Pendente"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        <Link href="/painel/financeiro">← Financeiro</Link>
      </p>
    </>
  );
}
