import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { FormAcaoPagamento } from "@/components/pagamentos/FormAcaoPagamento";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { conferirAgoraAcao } from "@/pagamentos/acoes-painel";
import { canceladaEmPalavras, type LinhaPagamento, listarPagamentos } from "@/pagamentos/consultas";
import { NOMES_DESFECHO, NOMES_SITUACAO_PAGAMENTO } from "@/pagamentos/situacoes";
import { dataValida } from "@/reservas/regras";

const FUSO = "America/Sao_Paulo";
const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" });
const dataBr = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
const FORMA = { pix: "Pix", cartao: "Cartão" } as const;
const umValor = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/** Período padrão: os últimos 30 dias (São Paulo), hoje incluído. */
function periodoPadrao(hoje: string): { de: string; ate: string } {
  return { de: new Date(Date.parse(`${hoje}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10), ate: hoje };
}

/** O que foi feito do dinheiro (ou o que falta fazer), em palavras simples. */
function desfechoEmPalavras(p: Pick<LinhaPagamento, "desfecho" | "devolucao" | "motivoSemReservaTexto" | "situacao" | "cancelada"> & Partial<Pick<LinhaPagamento, "alteracaoEm">>): string {
  // M8.2c: a reserva que o pagamento confirmou foi cancelada pela política (a mesma situação da página do hóspede).
  if (p.desfecho === "reserva" && p.cancelada) return canceladaEmPalavras(p.cancelada);
  // M8.2d: a diferença paga de uma alteração aplicada (de qual alteração: o dia em que foi preparada).
  if (p.desfecho === "alteracao") return p.alteracaoEm ? `Diferença da alteração de ${dataBr(hojeISO(FUSO, p.alteracaoEm))}` : NOMES_DESFECHO.alteracao;
  if (p.desfecho) return NOMES_DESFECHO[p.desfecho];
  if (p.devolucao?.situacao === "pedida") return "Devolução pedida ao Mercado Pago";
  if (p.devolucao?.situacao === "recusada") return "Devolução parada: o Mercado Pago recusou ou não respondeu três vezes. Confira no painel do Mercado Pago antes de tentar de novo ou de registrar a devolução feita por fora";
  if (p.situacao === "aprovado" && p.motivoSemReservaTexto) return `Sem reserva, a devolver: ${p.motivoSemReservaTexto}`;
  if ((p.situacao === "devolvido_parcial" || p.situacao === "contestado") && p.motivoSemReservaTexto)
    return `Sem reserva: ${p.motivoSemReservaTexto} ${p.situacao === "devolvido_parcial" ? "Devolva o restante pelo quadro do pagamento." : "A contestação se resolve pelo painel do Mercado Pago."}`;
  if (p.situacao === "aprovado") return "Confirmando a reserva";
  return "—";
}

/** Financeiro → Pagamentos do site (M8.2a): por período (padrão os últimos 30 dias), com o filtro "pede atenção". */
export default async function PagamentosDoSite({ searchParams }: PageProps<"/painel/financeiro/pagamentos-site">) {
  const sessao = await exigirSessaoPainel();
  // Lista da empresa toda: só a equipe interna (o proprietário vê o que é dele no portal).
  if (!podeFazer(sessao.papel, "financeiro:ler") || sessao.papel === "proprietario") redirect("/painel");
  const params = await searchParams;
  const padrao = periodoPadrao(hojeISO(FUSO));
  const de = dataValida(umValor(params.de)) ? umValor(params.de) : padrao.de;
  const ate = dataValida(umValor(params.ate)) ? umValor(params.ate) : padrao.ate;
  const atencao = umValor(params.atencao) === "1";
  const linhas = await listarPagamentos(getDb(), sessao.organizacaoId, { de, ate, atencao });
  const editar = podeFazer(sessao.papel, "financeiro:editar");

  return (
    <>
      <h1>Pagamentos do site</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Cada pagamento feito no site (Pix ou cartão, inclusive a diferença de uma alteração da reserva), com o que foi feito do dinheiro. Os pagamentos desta fase são de teste (nenhuma cobrança real). As ações — conferir, registrar
        a liberação, devolver — ficam no quadro &ldquo;Pagamento no site&rdquo; de cada reserva.
      </p>
      <form method="get" className={styles.linha} style={{ alignItems: "flex-end" }} aria-label="Filtro dos pagamentos">
        <label>
          De
          <input type="date" name="de" defaultValue={de} />
        </label>
        <label>
          Até
          <input type="date" name="ate" defaultValue={ate} />
        </label>
        <label className={styles.check}>
          <input type="checkbox" name="atencao" value="1" defaultChecked={atencao} /> Só os que pedem atenção (de qualquer data)
        </label>
        <div className={styles.acoes}>
          <button type="submit">Filtrar</button>
        </div>
      </form>
      {editar && <FormAcaoPagamento acao={conferirAgoraAcao} rotulo="Conferir agora" nome="Conferir agora todos os pendentes" discreto />}
      {linhas.length === 0 ? (
        <p style={{ color: "var(--scl-texto-2)" }}>{atencao ? "Nenhum pagamento do site pedindo atenção." : `Nenhum pagamento do site entre ${dataBr(de)} e ${dataBr(ate)}.`}</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Reserva</th>
                <th>Imóvel</th>
                <th>Forma</th>
                <th>Situação</th>
                <th>Valor</th>
                <th>Desfecho</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((p) => (
                <tr key={p.id}>
                  <td>{quando(p.criadoEm)}</td>
                  <td>
                    <Link href={`/painel/reservas/${p.reservaId}`}>{p.reservaCodigo}</Link>
                    <div style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>
                      {dataBr(p.checkin)} → {dataBr(p.checkout)}
                    </div>
                  </td>
                  <td>{p.imovelCodigo}</td>
                  <td>{FORMA[p.forma]}</td>
                  <td>
                    {NOMES_SITUACAO_PAGAMENTO[p.situacao]}
                    {p.ambiente === "teste" && (
                      <>
                        {" "}
                        <span className={styles.etiqueta} style={{ background: "var(--scl-aviso-fundo)", color: "var(--scl-aviso-texto)" }}>
                          teste
                        </span>
                      </>
                    )}
                    {p.pedeAtencao && (
                      <>
                        {" "}
                        <span className={styles.etiqueta} style={{ background: "var(--scl-erro-fundo)", color: "var(--scl-erro-texto)" }}>
                          pede atenção
                        </span>
                      </>
                    )}
                  </td>
                  <td className={styles.numero}>{formatBRL(p.valor)}</td>
                  <td style={{ fontSize: "0.875rem" }}>
                    {desfechoEmPalavras(p)}
                    {p.avisos.map((a) => (
                      <div key={a} style={{ color: "var(--scl-erro-texto)", fontSize: "0.8125rem" }}>
                        {a}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
