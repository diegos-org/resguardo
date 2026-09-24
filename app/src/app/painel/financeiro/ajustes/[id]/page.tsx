import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { autorizar, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe } from "@/auditoria/auditoria";
import { esclarecerAcao, salvarAjusteAcao } from "@/ajustes/acoes";
import { descricaoAjuste, DIRECOES, direcaoDe, NOMES_ORIGEM_AJUSTE, obterAjuste } from "@/ajustes/ajustes";
import { FormAjuste } from "@/components/ajustes/FormAjuste";
import styles from "@/components/formularios.module.css";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";

const dataBr = (d: string) => d.split("-").reverse().join("/");

export default async function AjustePagina({ params, searchParams }: PageProps<"/painel/financeiro/ajustes/[id]">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "financeiro:ler")) redirect("/painel");
  const { id } = await params;
  const { salvo, esclarecido, erro } = await searchParams;
  const db = getDb();
  const a = await obterAjuste(db, sessao.organizacaoId, id);
  // Autorização por recurso: proprietário só o ajuste de imóvel dele (deny-by-default).
  if (!a || !autorizar(sessao, "financeiro:ler", { organizacaoId: sessao.organizacaoId, imovelId: a.imovelId ?? undefined }).permitido) notFound();
  const [historico, imoveis] = await Promise.all([historicoDe(db, sessao.organizacaoId, "ajuste", a.id), listarImoveis(db, sessao.organizacaoId, { incluirInativos: true })]);
  const editar = podeFazer(sessao.papel, "financeiro:editar") && !a.esclarecidoEm;
  const linhas: [string, React.ReactNode][] = [
    ["Descrição", descricaoAjuste(a)],
    ["Data", dataBr(a.data)],
    ["Imóvel", a.imovelCodigo ?? "—"],
    ["Reserva", a.reservaCodigo && a.reservaId ? <Link href={`/painel/reservas/${a.reservaId}`}>{a.reservaCodigo}</Link> : "—"],
    ["Efeito", DIRECOES[direcaoDe(a)].texto],
    ["Valor", a.valor === null ? "ainda desconhecido (nada foi lançado)" : formatBRL(Math.abs(a.valor))],
    ["Origem", `${NOMES_ORIGEM_AJUSTE[a.origem]}${a.origemComprovada ? " (comprovada)" : a.origem !== "desconhecida" ? " (não comprovada)" : ""}`],
    ["O que foi consultado", a.evidencia],
    ["Comprovante", a.comprovante || "—"],
    ["Situação", a.esclarecidoEm ? "Esclarecido" : "Pendente de esclarecimento"],
  ];
  return (
    <>
      <h1>Ajuste</h1>
      {(salvo || esclarecido) && (
        <p role="status" className={styles.sucesso}>
          {esclarecido ? "Ajuste esclarecido." : "Salvo."}
        </p>
      )}
      {typeof erro === "string" && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      <dl className={styles.form} style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "8px 16px" }}>
        {linhas.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>{k}</dt>
            <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{v}</dd>
          </div>
        ))}
      </dl>
      {editar && (
        <>
          <form action={esclarecerAcao} className={styles.acoes}>
            <input type="hidden" name="id" value={a.id} />
            <button type="submit">Marcar como esclarecido</button>
            <span style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>Só com motivo e valor conhecidos. Depois disso o ajuste não muda mais.</span>
          </form>
          <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Completar informações</h2>
          <FormAjuste
            salvar={salvarAjusteAcao}
            imoveis={imoveis.map((i) => ({ id: i.id, codigo: i.codigo, nome: i.nome }))}
            origens={NOMES_ORIGEM_AJUSTE}
            direcoes={Object.fromEntries(Object.entries(DIRECOES).map(([k, d]) => [k, d.texto]))}
            inicial={{
              id: a.id,
              data: a.data,
              codigoReserva: a.reservaCodigo ?? "",
              imovelId: a.reservaId ? "" : (a.imovelId ?? ""),
              direcao: direcaoDe(a),
              valor: a.valor === null ? "" : centavosParaCampo(Math.abs(a.valor)),
              origem: a.origem,
              origemComprovada: a.origemComprovada ? "on" : "",
              motivo: a.motivo,
              evidencia: a.evidencia,
              comprovante: a.comprovante,
            }}
          />
        </>
      )}
      <HistoricoAlteracoes linhas={historico} />
      <p>
        <Link href="/painel/financeiro/ajustes">← Ajustes</Link>
      </p>
    </>
  );
}
