import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormDespesa } from "@/components/despesas/FormDespesa";
import { getDb } from "@/db/client";
import { salvarDespesa } from "@/despesas/acoes";
import { garantirCategoriasIniciais, listarCategorias } from "@/despesas/categorias";
import { listarImoveis } from "@/imoveis/repositorio";
import { hojeISO } from "@/lib/datas";
import { listarProprietarios } from "@/proprietarios/repositorio";

export default async function NovaDespesa() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "despesa:editar")) redirect("/painel/despesas");
  const db = getDb();
  await garantirCategoriasIniciais(db, sessao.organizacaoId);
  const [imoveis, proprietarios, categorias] = await Promise.all([
    listarImoveis(db, sessao.organizacaoId),
    listarProprietarios(db, sessao.organizacaoId),
    listarCategorias(db, sessao.organizacaoId),
  ]);
  return (
    <>
      <h1>Nova despesa</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820 }}>
        <strong>Da empresa</strong>: custo da SCL (equipe, mercado, pequenos reparos que a empresa absorve). <strong>Do proprietário</strong>: gasto
        que é dele (ex.: conserto do ar-condicionado do apartamento) — não conta como custo da empresa; se a empresa pagou, ele passa a dever
        esse valor no acerto.
      </p>
      <FormDespesa
        acao={salvarDespesa}
        imoveis={imoveis.map((i) => ({ id: i.id, codigo: i.codigo, nome: i.nome }))}
        proprietarios={proprietarios.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: p.nome }))}
        categorias={categorias.map((c) => ({ id: c.id, nome: c.nome }))}
        hoje={hojeISO()}
      />
    </>
  );
}
