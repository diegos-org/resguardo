import Link from "next/link";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { mascararDocumento } from "@/proprietarios/documento";
import { listarProprietarios } from "@/proprietarios/repositorio";

export default async function ListaProprietarios() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "proprietario:ler")) {
    return (
      <>
        <h1>Proprietários</h1>
        <p>Esta área tem dados pessoais e é restrita aos administradores.</p>
      </>
    );
  }
  const lista = await listarProprietarios(getDb(), sessao.organizacaoId);
  return (
    <>
      <div className={styles.topo}>
        <h1>Proprietários</h1>
        {podeFazer(sessao.papel, "proprietario:editar") && (
          <Link href="/painel/proprietarios/novo" className={styles.botao}>
            Novo proprietário
          </Link>
        )}
      </div>
      {lista.length === 0 ? (
        <p>Nenhum proprietário cadastrado ainda.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Documento</th>
                <th>Imóveis</th>
                <th>Contato</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className={p.ativo ? undefined : styles.inativo}>
                  <td>
                    <Link href={`/painel/proprietarios/${p.id}`}>{p.nome}</Link>
                  </td>
                  <td>{mascararDocumento(p.documento) || "—"}</td>
                  <td>{p.imoveis.map((i) => i.codigo).join(", ") || "—"}</td>
                  <td>{p.email || p.telefone || "—"}</td>
                  <td>
                    <span className={styles.etiqueta}>{p.ativo ? "Ativo" : "Inativo"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
