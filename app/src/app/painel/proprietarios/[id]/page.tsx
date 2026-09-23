import { notFound, redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe } from "@/auditoria/auditoria";
import styles from "@/components/formularios.module.css";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { FormProprietario } from "@/components/proprietarios/FormProprietario";
import { Representantes } from "@/components/proprietarios/Representantes";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { excluirRepresentante, salvarProprietario, salvarRepresentante } from "@/proprietarios/acoes";
import { formatarDocumento } from "@/proprietarios/documento";
import { obterProprietario } from "@/proprietarios/repositorio";

export default async function EditarProprietario({ params, searchParams }: PageProps<"/painel/proprietarios/[id]">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "proprietario:editar")) redirect("/painel/proprietarios");
  const { id } = await params;
  const { salvo } = await searchParams;
  const db = getDb();
  const dono = await obterProprietario(db, sessao.organizacaoId, id);
  if (!dono) notFound();
  const [imoveis, historico] = await Promise.all([
    listarImoveis(db, sessao.organizacaoId, { incluirInativos: true }),
    historicoDe(db, sessao.organizacaoId, "proprietario", id),
  ]);
  return (
    <>
      <h1>{dono.nome}</h1>
      {salvo && (
        <p role="status" className={styles.sucesso}>
          Proprietário salvo.
        </p>
      )}
      <FormProprietario
        acao={salvarProprietario}
        imoveis={imoveis}
        id={dono.id}
        inicial={{ ...dono, documento: formatarDocumento(dono.documento) }}
      />
      <Representantes proprietarioId={dono.id} lista={dono.representantes} adicionar={salvarRepresentante} remover={excluirRepresentante} />
      <HistoricoAlteracoes linhas={historico} />
    </>
  );
}
