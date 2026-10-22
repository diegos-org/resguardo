import { notFound, redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe } from "@/auditoria/auditoria";
import { excluirIdExterno, novoIdExterno } from "@/canais/acoes";
import { listarIdsExternos } from "@/canais/ids-externos";
import { IdsExternos } from "@/components/canais/IdsExternos";
import { Contratos } from "@/components/contratos/Contratos";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { bloqueioPortal, encerrar, novoContrato } from "@/contratos/acoes";
import { listarContratos } from "@/contratos/repositorio";
import { hojeISO } from "@/lib/datas";
import { FormImovel } from "@/components/imoveis/FormImovel";
import { getDb } from "@/db/client";
import { Recebimento } from "@/components/imoveis/Recebimento";
import { lerRegrasFinanceiras } from "@/configuracoes/regras-financeiras";
import { excluirPeriodoAcao, novoPeriodoAcao, salvarDetalhesAcao, salvarImovel, salvarRecebimentoAcao } from "@/imoveis/acoes";
import { lerDetalhes, listarPeriodos, regrasDeVenda } from "@/imoveis/detalhes";
import { FormDetalhes } from "@/components/imoveis/FormDetalhes";
import { FotosImovel } from "@/components/imoveis/FotosImovel";
import { listarFotos } from "@/imoveis/fotos";
import { Periodos, Simulador } from "@/components/imoveis/Periodos";
import { lerRecebimento } from "@/imoveis/recebimento";
import { obterImovel } from "@/imoveis/repositorio";
import { resumoDosImportados } from "@/calendario/importacao";
import { organizacaoDoSite } from "@/site/site";

export default async function EditarImovel({ params }: PageProps<"/painel/imoveis/[id]">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "imovel:editar")) redirect("/painel/imoveis");
  const { id } = await params;
  const imovel = await obterImovel(getDb(), sessao.organizacaoId, id);
  if (!imovel) notFound();
  const [historico, contratos, ids, recebimento, regras, detalhes, periodos, fotos, siteOrg, importados] = await Promise.all([
    historicoDe(getDb(), sessao.organizacaoId, "imovel", imovel.id),
    listarContratos(getDb(), sessao.organizacaoId, imovel.id),
    listarIdsExternos(getDb(), sessao.organizacaoId, imovel.id),
    lerRecebimento(getDb(), sessao.organizacaoId, imovel.id),
    lerRegrasFinanceiras(getDb(), sessao.organizacaoId),
    lerDetalhes(getDb(), sessao.organizacaoId, imovel.id),
    listarPeriodos(getDb(), sessao.organizacaoId, imovel.id),
    listarFotos(getDb(), sessao.organizacaoId, imovel.id),
    organizacaoDoSite(getDb()),
    // M3.11a: os preços importados do Beds24 de hoje em diante, no fuso do imóvel.
    resumoDosImportados(getDb(), sessao.organizacaoId, hojeISO(imovel.fuso), [imovel.id]).then((m) => {
      const r = m.get(imovel.id);
      return r ? { noites: r.noites, fim: r.fim } : null;
    }),
  ]);
  return (
    <>
      <h1>
        {imovel.codigo} · {imovel.nome}
      </h1>
      <FormImovel acao={salvarImovel} id={imovel.id} inicial={imovel} />
      <FormDetalhes imovelId={imovel.id} inicial={detalhes} salvar={salvarDetalhesAcao} importados={importados} />
      <FotosImovel imovelId={imovel.id} imovelNome={`${imovel.codigo} · ${imovel.nome}`} fotos={fotos} noSite={siteOrg === sessao.organizacaoId && imovel.publico && imovel.ativo} />
      <Periodos imovelId={imovel.id} periodos={periodos} criar={novoPeriodoAcao} excluir={excluirPeriodoAcao} />
      <Simulador regras={regrasDeVenda(detalhes)} periodos={periodos} hoje={hojeISO(imovel.fuso)} fontePrecos={detalhes.fontePrecos} />
      <IdsExternos imovelId={imovel.id} lista={ids} adicionar={novoIdExterno} remover={excluirIdExterno} />
      <Contratos
        imovelId={imovel.id}
        lista={contratos}
        hoje={hojeISO()}
        criar={novoContrato}
        encerrar={encerrar}
        bloqueioPortal={bloqueioPortal}
        podeEditar={podeFazer(sessao.papel, "financeiro:editar")}
      />
      {podeFazer(sessao.papel, "financeiro:editar") && (
        <Recebimento imovelId={imovel.id} config={recebimento} padrao={regras.recebimento} salvar={salvarRecebimentoAcao} />
      )}
      <HistoricoAlteracoes linhas={historico} />
    </>
  );
}
