import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { autorizar, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe } from "@/auditoria/auditoria";
import { contestarAcao, desfazerAcao, quitarAcao, resolverAcao } from "@/adiantamentos/acoes";
import { NOMES_FORMA, NOMES_SITUACAO, obterAdiantamento } from "@/adiantamentos/adiantamentos";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { getDb } from "@/db/client";
import type { FormaQuitacao } from "@/db/schema";
import { hojeISO } from "@/lib/datas";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";

const dataBr = (d: string) => d.split("-").reverse().join("/");

export default async function Adiantamento({ params, searchParams }: PageProps<"/painel/despesas/adiantamentos/[id]">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "financeiro:ler")) redirect("/painel");
  const { id } = await params;
  const { salvo, erro } = await searchParams;
  const db = getDb();
  const a = await obterAdiantamento(db, sessao.organizacaoId, id);
  // Autorização por recurso: proprietário só o adiantamento de imóvel dele (deny-by-default).
  if (!a || !autorizar(sessao, "financeiro:ler", { organizacaoId: sessao.organizacaoId, imovelId: a.imovelId ?? undefined }).permitido) notFound();
  const historico = await historicoDe(db, sessao.organizacaoId, "adiantamento", a.id);
  const editar = podeFazer(sessao.papel, "despesa:editar");
  const hoje = hojeISO();

  const linhas: [string, React.ReactNode][] = [
    ["Imóvel", a.imovel ?? "—"],
    ["Proprietário", a.proprietario],
    ["O que foi pago", a.descricao.replace(/^Pago pela empresa: /, "")],
    ["Fornecedor", a.fornecedor || "—"],
    ["Pago pela empresa em", a.dataPagamento ? dataBr(a.dataPagamento) : "—"],
    ["Valor", formatBRL(a.valor)],
    ["Já quitado", formatBRL(a.quitado)],
    ["Em aberto", <strong key="a">{formatBRL(a.aberto)}</strong>],
    ["Situação", NOMES_SITUACAO[a.situacao]],
    ["Despesa de origem", a.despesaId ? <Link href={`/painel/despesas/${a.despesaId}`}>ver despesa</Link> : "—"],
  ];

  return (
    <>
      <h1>Adiantamento</h1>
      {salvo && (
        <p role="status" className={styles.sucesso}>
          Salvo.
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
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>

      {a.contestacao && (
        <section className={styles.form} aria-label="Contestação">
          <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Contestação {a.contestacao.resolvidaEm ? "(resolvida)" : "(aberta)"}</h2>
          <p style={{ margin: 0 }}>{a.contestacao.motivo}</p>
          {a.contestacao.resolvidaEm && (
            <p style={{ margin: 0, fontSize: "0.875rem" }}>
              Resolução: {a.contestacao.resolucao === "mantida" ? "mantida (voltou a ser cobrado)" : "a empresa assumiu"}
              {a.contestacao.notaResolucao ? ` — ${a.contestacao.notaResolucao}` : ""}
            </p>
          )}
          {editar && !a.contestacao.resolvidaEm && (
            <form action={resolverAcao} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="data" value={hoje} />
              <label>
                Nota da resolução
                <input name="nota" maxLength={500} />
              </label>
              <div className={styles.acoes}>
                <button type="submit" name="resolucao" value="mantida">
                  Manter a cobrança
                </button>
                <BotaoConfirmar name="resolucao" value="empresa_assume" pergunta={`A empresa assume ${formatBRL(a.aberto)}? O valor deixa de ser cobrado do proprietário e vira custo da empresa.`}>
                  Empresa assume o valor
                </BotaoConfirmar>
              </div>
            </form>
          )}
        </section>
      )}

      {editar && a.aberto > 0 && a.situacao !== "contestado" && (
        <>
          <form action={quitarAcao} className={styles.form} aria-label="Registrar reembolso">
            <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Registrar reembolso do proprietário</h2>
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="forma" value="reembolso" />
            <div className={styles.linha}>
              <label>
                Valor (R$)
                <input name="valor" inputMode="decimal" defaultValue={centavosParaCampo(a.aberto)} required />
              </label>
              <label>
                Data em que recebemos
                <input name="data" type="date" defaultValue={hoje} required />
              </label>
              <label className={styles.largo}>
                Observação
                <input name="nota" maxLength={300} placeholder="ex.: Pix recebido" />
              </label>
            </div>
            <div className={styles.acoes}>
              <button type="submit">Registrar reembolso</button>
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)", margin: 0 }}>
              Se não houver reembolso, o valor em aberto é descontado automaticamente no repasse mensal (M4.9).
            </p>
          </form>
          <form action={contestarAcao} className={styles.form} aria-label="Registrar contestação">
            <h2 style={{ fontSize: "1.125rem", margin: 0 }}>O proprietário contestou?</h2>
            <input type="hidden" name="id" value={a.id} />
            <label>
              O que ele contesta
              <input name="motivo" required maxLength={500} />
            </label>
            <div className={styles.acoes}>
              <button type="submit">Registrar contestação</button>
            </div>
          </form>
        </>
      )}

      {a.quitacoes.length > 0 && (
        <section aria-label="Quitações" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Quitações</h2>
          <div className={styles.rolagem}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Forma</th>
                  <th className={styles.numero}>Valor</th>
                  <th>Observação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {a.quitacoes.map((q) => (
                  <tr key={q.id} className={q.desfeitaEm ? styles.inativo : undefined}>
                    <td>{dataBr(q.data)}</td>
                    <td>
                      {NOMES_FORMA[q.forma as FormaQuitacao]}
                      {q.desfeitaEm ? " (desfeita)" : ""}
                    </td>
                    <td className={styles.numero}>{formatBRL(q.valor)}</td>
                    <td>{q.nota || "—"}</td>
                    <td>
                      {editar && !q.desfeitaEm && q.forma !== "compensacao" && (
                        <form action={desfazerAcao} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="quitacaoId" value={q.id} />
                          <input name="motivo" required maxLength={200} placeholder="motivo" className={styles.pequeno} aria-label="Motivo para desfazer" />
                          <BotaoConfirmar className={styles.pequeno} pergunta="Desfazer esta quitação? O valor volta a ficar em aberto (o histórico fica guardado).">
                            Desfazer
                          </BotaoConfirmar>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <HistoricoAlteracoes linhas={historico} />
      <p>
        <Link href="/painel/despesas/adiantamentos">← Voltar para adiantamentos</Link>
      </p>
    </>
  );
}
