import Link from "next/link";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";

export default async function ListaImoveis({ searchParams }: PageProps<"/painel/imoveis">) {
  const sessao = await exigirSessaoPainel();
  const { salvo } = await searchParams;
  const lista = await listarImoveis(getDb(), sessao.organizacaoId, { incluirInativos: true });
  const podeEditar = podeFazer(sessao.papel, "imovel:editar");

  return (
    <>
      <div className={styles.topo}>
        <h1>Imóveis</h1>
        {podeEditar && (
          <Link href="/painel/imoveis/novo" className={styles.botao}>
            Novo imóvel
          </Link>
        )}
      </div>
      {salvo && (
        <p role="status" className={styles.sucesso}>
          Imóvel salvo.
        </p>
      )}
      {lista.length === 0 ? (
        <p>Nenhum imóvel cadastrado ainda.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Bairro</th>
                <th>Hóspedes</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.id} className={i.ativo ? undefined : styles.inativo}>
                  <td>{podeEditar ? <Link href={`/painel/imoveis/${i.id}`}>{i.codigo}</Link> : i.codigo}</td>
                  <td>{i.nome}</td>
                  <td>{i.bairro || "—"}</td>
                  <td>{i.capacidade ?? "—"}</td>
                  <td>
                    <span className={styles.etiqueta}>{!i.ativo ? "Inativo" : i.publico ? "No site" : "Só interno"}</span>
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
