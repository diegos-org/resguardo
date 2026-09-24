import { notFound, redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe } from "@/auditoria/auditoria";
import { excluirIdExterno, novoIdExterno } from "@/canais/acoes";
import { listarIdsExternos } from "@/canais/ids-externos";
import { IdsExternos } from "@/components/canais/IdsExternos";
import { Contratos } from "@/components/contratos/Contratos";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { encerrar, novoContrato } from "@/contratos/acoes";
import { listarContratos } from "@/contratos/repositorio";
import { hojeISO } from "@/lib/datas";
import { FormImovel } from "@/components/imoveis/FormImovel";
import { getDb } from "@/db/client";
import { Recebimento } from "@/components/imoveis/Recebimento";
import { lerRegrasFinanceiras } from "@/configuracoes/regras-financeiras";
import { excluirPeriodoAcao, novoPeriodoAcao, salvarDetalhesAcao, salvarImovel, salvarRecebimentoAcao } from "@/imoveis/acoes";
import { lerDetalhes, listarPeriodos, regrasDeVenda } from "@/imoveis/detalhes";
import { FormDetalhes } from "@/components/imoveis/FormDetalhes";
import { Periodos, Simulador } from "@/components/imoveis/Periodos";
import { lerRecebimento } from "@/imoveis/recebimento";
import { obterImovel } from "@/imoveis/repositorio";

export default async function EditarImovel({ params }: PageProps<"/painel/imoveis/[id]">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "imovel:editar")) redirect("/painel/imoveis");
  const { id } = await params;
  const imovel = await obterImovel(getDb(), sessao.organizacaoId, id);
  if (!imovel) notFound();
  const [historico, contratos, ids, recebimento, regras, detalhes, periodos] = await Promise.all([
    historicoDe(getDb(), sessao.organizacaoId, "imovel", imovel.id),
    listarContratos(getDb(), sessao.organizacaoId, imovel.id),
    listarIdsExternos(getDb(), sessao.organizacaoId, imovel.id),
    lerRecebimento(getDb(), sessao.organizacaoId, imovel.id),
    lerRegrasFinanceiras(getDb(), sessao.organizacaoId),
    lerDetalhes(getDb(), sessao.organizacaoId, imovel.id),
    listarPeriodos(getDb(), sessao.organizacaoId, imovel.id),
  ]);
  return (
    <>
      <h1>
        {imovel.codigo} · {imovel.nome}
      </h1>
      <FormImovel acao={salvarImovel} id={imovel.id} inicial={imovel} />
      <FormDetalhes imovelId={imovel.id} inicial={detalhes} salvar={salvarDetalhesAcao} />
      <Periodos imovelId={imovel.id} periodos={periodos} criar={novoPeriodoAcao} excluir={excluirPeriodoAcao} />
      <Simulador regras={regrasDeVenda(detalhes)} periodos={periodos} hoje={hojeISO()} />
      <IdsExternos imovelId={imovel.id} lista={ids} adicionar={novoIdExterno} remover={excluirIdExterno} />
      <Contratos
        imovelId={imovel.id}
        lista={contratos}
        hoje={hojeISO()}
        criar={novoContrato}
        encerrar={encerrar}
        podeEditar={podeFazer(sessao.papel, "financeiro:editar")}
      />
      {podeFazer(sessao.papel, "financeiro:editar") && (
        <Recebimento imovelId={imovel.id} config={recebimento} padrao={regras.recebimento} salvar={salvarRecebimentoAcao} />
      )}
      <HistoricoAlteracoes linhas={historico} />
    </>
  );
}
