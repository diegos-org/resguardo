import { notFound, redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe } from "@/auditoria/auditoria";
import { Contratos } from "@/components/contratos/Contratos";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { encerrar, novoContrato } from "@/contratos/acoes";
import { listarContratos } from "@/contratos/repositorio";
import { hojeISO } from "@/lib/datas";
import { FormImovel } from "@/components/imoveis/FormImovel";
import { getDb } from "@/db/client";
import { salvarImovel } from "@/imoveis/acoes";
import { obterImovel } from "@/imoveis/repositorio";

export default async function EditarImovel({ params }: PageProps<"/painel/imoveis/[id]">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "imovel:editar")) redirect("/painel/imoveis");
  const { id } = await params;
  const imovel = await obterImovel(getDb(), sessao.organizacaoId, id);
  if (!imovel) notFound();
  const [historico, contratos] = await Promise.all([
    historicoDe(getDb(), sessao.organizacaoId, "imovel", imovel.id),
    listarContratos(getDb(), sessao.organizacaoId, imovel.id),
  ]);
  return (
    <>
      <h1>
        {imovel.codigo} · {imovel.nome}
      </h1>
      <FormImovel acao={salvarImovel} id={imovel.id} inicial={imovel} />
      <Contratos
        imovelId={imovel.id}
        lista={contratos}
        hoje={hojeISO()}
        criar={novoContrato}
        encerrar={encerrar}
        podeEditar={podeFazer(sessao.papel, "financeiro:editar")}
      />
      <HistoricoAlteracoes linhas={historico} />
    </>
  );
}
