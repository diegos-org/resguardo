import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { Categorias } from "@/components/despesas/Categorias";
import { getDb } from "@/db/client";
import { editarCategoria, novaCategoria } from "@/despesas/acoes";
import { garantirCategoriasIniciais, listarCategorias } from "@/despesas/categorias";

export default async function PaginaCategorias() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "despesa:editar")) redirect("/painel/despesas");
  const db = getDb();
  await garantirCategoriasIniciais(db, sessao.organizacaoId);
  const categorias = await listarCategorias(db, sessao.organizacaoId, true);
  return (
    <>
      <h1>Categorias de despesa</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820 }}>
        Categoria já usada não pode ser excluída: arquive-a. Arquivada, ela some das opções de novas despesas, mas continua nas antigas.
      </p>
      <Categorias categorias={categorias.map((c) => ({ id: c.id, nome: c.nome, ativa: c.ativa }))} criar={novaCategoria} editar={editarCategoria} />
      <p>
        <Link href="/painel/despesas">← Voltar para despesas</Link>
      </p>
    </>
  );
}
