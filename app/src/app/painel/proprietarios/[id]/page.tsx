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
import { lerComoFunciona, versaoAtual } from "@/configuracoes/como-funciona";
import { convidar, revogar } from "@/convites/acoes";
import { listarConvites, situacao } from "@/convites/convites";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { excluirRepresentante, salvarProprietario, salvarRepresentante } from "@/proprietarios/acoes";
import { formatarDocumento } from "@/proprietarios/documento";
import { ultimoAceite } from "@/portal/aceites";
import { obterProprietario } from "@/proprietarios/repositorio";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { dataBr, dataHoraNoFuso, dataNoFuso, hojeISO } from "@/lib/datas";
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
  const [imoveis, historico, convites, periodicidade, documento, aceite] = await Promise.all([
    listarImoveis(db, sessao.organizacaoId, { incluirInativos: true }),
    historicoDe(db, sessao.organizacaoId, "proprietario", id),
    listarConvites(db, sessao.organizacaoId, id),
    periodicidadeDoProprietario(db, sessao.organizacaoId, id, hojeISO()),
    lerComoFunciona(db, sessao.organizacaoId).then(versaoAtual),
    ultimoAceite(db, sessao.organizacaoId, id),
  ]);
  const agora = new Date();
  const quando = (d: Date) => dataHoraNoFuso(d);
  return (
    <>
      <h1>{dono.nome}</h1>
      {podeFazer(sessao.papel, "financeiro:ler") && (
        <p style={{ margin: 0 }}>
          <Link href={`/painel/proprietarios/${dono.id}/relatorio`}>Relatório do mês em PDF</Link>
        </p>
      )}
      <p style={{ margin: 0, fontSize: "0.875rem" }}>
        &ldquo;Como funciona&rdquo; (M5.6):{" "}
        {!documento
          ? "documento ainda não publicado"
          : aceite
            ? `versão ${aceite.versao} aceita em ${quando(aceite.aceitoEm)} por ${aceite.email}${aceite.versao === documento.numero ? "" : ` — a versão atual (${documento.numero}) ainda não foi aceita`}`
            : `ainda não aceitou a versão ${documento.numero}`}
        . <Link href="/painel/configuracoes/como-funciona">Texto e aceites</Link>
      </p>
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
            Hoje: {periodicidade.descricao}. Próximo repasse previsto: {dataBr(periodicidade.proximaData)}. O proprietário também escolhe no portal; sem escolha vale o padrão do tipo de contrato (Configurações → Repasses). Vale a partir do próximo repasse.
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
          // Os textos já prontos, no horário de Brasília (o dia em UTC mostrava o dia seguinte à noite).
          criadoEm: dataNoFuso(c.criadoEm),
          expiraEm: dataHoraNoFuso(c.expiraEm),
          aceitoEm: c.aceitoEm ? dataNoFuso(c.aceitoEm) : null,
        }))}
        convidar={convidar}
        revogar={revogar}
      />
      <HistoricoAlteracoes linhas={historico} />
    </>
  );
}
