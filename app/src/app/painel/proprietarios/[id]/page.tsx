import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe } from "@/auditoria/auditoria";
import styles from "@/components/formularios.module.css";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { FormProprietario } from "@/components/proprietarios/FormProprietario";
import { Convites } from "@/components/proprietarios/Convites";
import { Representantes } from "@/components/proprietarios/Representantes";
import { convidar, revogar } from "@/convites/acoes";
import { listarConvites, situacao } from "@/convites/convites";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { excluirRepresentante, salvarProprietario, salvarRepresentante } from "@/proprietarios/acoes";
import { formatarDocumento } from "@/proprietarios/documento";
import { obterProprietario } from "@/proprietarios/repositorio";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { hojeISO } from "@/lib/datas";
import { escolherPeriodicidadeAdminAcao } from "@/repasses/acoes";
import { NOMES_PERIODICIDADE, PERIODICIDADES } from "@/repasses/periodicidade";
import { periodicidadeDoProprietario } from "@/repasses/proprietario";

export default async function EditarProprietario({ params, searchParams }: PageProps<"/painel/proprietarios/[id]">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "proprietario:editar")) redirect("/painel/proprietarios");
  const { id } = await params;
  const { salvo, erro } = await searchParams;
  const db = getDb();
  const dono = await obterProprietario(db, sessao.organizacaoId, id);
  if (!dono) notFound();
  const [imoveis, historico, convites, periodicidade] = await Promise.all([
    listarImoveis(db, sessao.organizacaoId, { incluirInativos: true }),
    historicoDe(db, sessao.organizacaoId, "proprietario", id),
    listarConvites(db, sessao.organizacaoId, id),
    periodicidadeDoProprietario(db, sessao.organizacaoId, id, hojeISO()),
  ]);
  const agora = new Date();
  return (
    <>
      <h1>{dono.nome}</h1>
      {podeFazer(sessao.papel, "financeiro:ler") && (
        <p style={{ margin: 0 }}>
          <Link href={`/painel/proprietarios/${dono.id}/relatorio`}>Relatório do mês em PDF</Link>
        </p>
      )}
      {salvo && (
        <p role="status" className={styles.sucesso}>
          {salvo === "periodicidade" ? "Periodicidade dos repasses salva: vale a partir do próximo repasse." : "Proprietário salvo."}
        </p>
      )}
      {typeof erro === "string" && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      <FormProprietario
        acao={salvarProprietario}
        imoveis={imoveis}
        id={dono.id}
        inicial={{ ...dono, documento: formatarDocumento(dono.documento) }}
      />
      {periodicidade && (
        <form action={escolherPeriodicidadeAdminAcao} className={styles.form} aria-label="Como recebe os repasses" style={{ maxWidth: 820 }}>
          <input type="hidden" name="proprietarioId" value={dono.id} />
          <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Como recebe os repasses</h2>
          <p style={{ margin: 0, color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>
            Hoje: {periodicidade.descricao}. Próximo repasse previsto: {periodicidade.proximaData.split("-").reverse().join("/")}. O proprietário também escolhe no portal; sem escolha vale o padrão do tipo de contrato (Configurações → Repasses). Vale a partir do próximo repasse.
          </p>
          <div className={styles.linha} style={{ alignItems: "flex-end" }}>
            <label style={{ flex: "0 1 320px" }}>
              Periodicidade
              <select name="periodicidade" defaultValue={periodicidade.escolha ?? ""}>
                <option value="">Padrão do contrato ({NOMES_PERIODICIDADE[periodicidade.efetiva]})</option>
                {PERIODICIDADES.map((p) => (
                  <option key={p} value={p}>
                    {NOMES_PERIODICIDADE[p]}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.acoes}>
              <BotaoConfirmar pergunta="Salvar a periodicidade dos repasses deste proprietário? Vale a partir do próximo repasse.">Salvar periodicidade</BotaoConfirmar>
            </div>
          </div>
        </form>
      )}
      <Representantes proprietarioId={dono.id} lista={dono.representantes} adicionar={salvarRepresentante} remover={excluirRepresentante} />
      <Convites
        proprietarioId={dono.id}
        emailPadrao={dono.email}
        convites={convites.map((c) => ({
          id: c.id,
          email: c.email,
          situacao: situacao(c, agora),
          criadoEm: c.criadoEm.toISOString(),
          expiraEm: c.expiraEm.toISOString(),
          aceitoEm: c.aceitoEm?.toISOString() ?? null,
        }))}
        convidar={convidar}
        revogar={revogar}
      />
      <HistoricoAlteracoes linhas={historico} />
    </>
  );
}
