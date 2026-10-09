import styles from "@/components/formularios.module.css";
import { FormAcaoPagamento } from "@/components/pagamentos/FormAcaoPagamento";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
import { conferirAgoraAcao, devolucaoPorForaAcao, devolverAcao, estornarLiberacaoAcao, registrarLiberacaoAcao, registrarTaxaPerdidaAcao } from "@/pagamentos/acoes-painel";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";
import { NOMES_DESFECHO, NOMES_SITUACAO_PAGAMENTO } from "@/pagamentos/situacoes";

type Props = {
  pagamentos: readonly PagamentoDoPainel[];
  /** financeiro:ler — valor, taxa, líquido, liberação e devoluções. */
  verValores: boolean;
  /** financeiro:editar — as ações (cada uma só quando o pagamento permite). */
  editar: boolean;
  hoje: string;
};

const FUSO = "America/Sao_Paulo";
const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" });
const dia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: FUSO });
const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
const dataBr = (d: string) => d.split("-").reverse().join("/");
const FORMA = { pix: "Pix", cartao: "Cartão" } as const;
const DEVOLUCAO = {
  pedida: "pedida ao Mercado Pago, aguardando confirmação",
  confirmada: "confirmada pelo Mercado Pago",
  recusada: "o Mercado Pago recusou ou não respondeu três vezes: confira no painel do Mercado Pago antes de tentar de novo ou de registrar a devolução feita por fora",
  por_fora: "feita por fora",
} as const;

/** A situação da tentativa em palavras simples, com o desfecho quando houver. */
export function situacaoEmPalavras(p: PagamentoDoPainel): string {
  if (p.situacao === "pendente") return p.pixExpiraEm ? `Aguardando o pagamento do Pix (vale até ${hora(p.pixExpiraEm)} de ${dia(p.pixExpiraEm)})` : "Aguardando o pagamento";
  if (p.situacao === "criando" || p.situacao === "incerta") return "Conferindo no Mercado Pago se o Pix foi criado";
  if (p.desfecho === "reserva") return p.situacao === "aprovado" ? "Aprovado: confirmou a reserva" : `${NOMES_SITUACAO_PAGAMENTO[p.situacao]} (tinha confirmado a reserva)`;
  if (p.desfecho) return NOMES_DESFECHO[p.desfecho];
  if (p.situacao === "aprovado" && p.motivoSemReservaTexto) return `Aprovado sem reserva: ${p.motivoSemReservaTexto} O valor precisa ser devolvido ao hóspede.`;
  if ((p.situacao === "devolvido_parcial" || p.situacao === "contestado") && p.motivoSemReservaTexto)
    return `${NOMES_SITUACAO_PAGAMENTO[p.situacao]} sem reserva: ${p.motivoSemReservaTexto} O que falta resolver se resolve pelo painel do Mercado Pago até o M8.2c.`;
  if (p.situacao === "aprovado") return "Aprovado: confirmando a reserva";
  return NOMES_SITUACAO_PAGAMENTO[p.situacao];
}

function Linhas({ linhas }: { linhas: [string, string][] }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "4px 16px", margin: 0, fontSize: "0.875rem" }}>
      {linhas.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt style={{ color: "var(--scl-texto-2)" }}>{k}</dt>
          <dd style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function liberacao(p: PagamentoDoPainel): string | null {
  if (p.liberacaoConfirmadaEm) return `${p.liberacaoOrigem === "manual" ? "registrada à mão" : "confirmada pelo Mercado Pago"} em ${dia(p.liberacaoConfirmadaEm)}`;
  if (p.liberacaoPrevistaEm) return `o Mercado Pago libera em ${dia(p.liberacaoPrevistaEm)} (previsão)`;
  return p.desfecho === "reserva" ? "ainda sem data do Mercado Pago" : null;
}

function devolucao(p: PagamentoDoPainel, verValores: boolean): string | null {
  const d = p.devolucao;
  if (!d) return null;
  const partes: string[] = [DEVOLUCAO[d.situacao]];
  if (verValores) partes.push(formatBRL(d.situacao === "por_fora" && d.porForaValor !== null ? d.porForaValor : d.valor));
  if (d.situacao === "por_fora" && d.porForaData) partes.push(`em ${dataBr(d.porForaData)}`);
  if (d.confirmadaEm) partes.push(`em ${dia(d.confirmadaEm)}`);
  if (d.situacao === "pedida" && d.tentativas) partes.push(`${d.tentativas} pedido(s) ao Mercado Pago${d.falhas ? `, ${d.falhas} falha(s)` : ""}`);
  if (verValores && d.taxaPerdida !== null) partes.push(`taxa que ficou com o Mercado Pago: ${formatBRL(d.taxaPerdida)}`);
  if (d.situacao === "por_fora" && d.porForaNota) partes.push(`nota: ${d.porForaNota}`);
  return partes.join(" · ");
}

function Tentativa({ p, verValores, editar, hoje }: { p: PagamentoDoPainel } & Omit<Props, "pagamentos">) {
  const linhas: [string, string][] = [
    ["Situação", situacaoEmPalavras(p)],
    ["Gerado em", quando(p.criadoEm)],
  ];
  if (p.aprovadoEm) linhas.push(["Aprovado em", quando(p.aprovadoEm)]);
  if (p.desfechoEm && p.desfecho !== "reserva") linhas.push(["Encerrado em", quando(p.desfechoEm)]);
  if (p.consultadoEm) linhas.push(["Última conferência", quando(p.consultadoEm)]);
  const dev = devolucao(p, verValores);
  if (dev) linhas.push(["Devolução", dev]);
  if (verValores) {
    linhas.push(["Valor", formatBRL(p.valor)]);
    if (p.valorPago !== null && p.valorPago !== p.valor) linhas.push(["Pago pelo hóspede", formatBRL(p.valorPago)]);
    linhas.push(["Taxa do Mercado Pago", p.taxa === null ? "ainda não informada" : formatBRL(p.taxa)]);
    linhas.push(["Líquido", p.liquido === null ? "ainda não informado" : formatBRL(p.liquido)]);
    const lib = liberacao(p);
    if (lib) linhas.push(["Liberação", lib]);
  }
  const a = p.acoes;
  // O que a devolução integral devolve: o que o hóspede pagou (a mesma regra do domínio), não o total pedido.
  const valorTexto = verValores ? ` de ${formatBRL(p.valorPago ?? p.valor)}` : "";
  return (
    <article aria-label={`Pagamento ${FORMA[p.forma]} de ${quando(p.criadoEm)}`} style={{ border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className={styles.linha} style={{ alignItems: "center", gap: 8 }}>
        <strong>{FORMA[p.forma]}</strong>
        <span className={styles.etiqueta} style={{ background: p.situacao === "aprovado" ? "var(--scl-ok-fundo)" : undefined }}>
          {NOMES_SITUACAO_PAGAMENTO[p.situacao]}
        </span>
        {p.ambiente === "teste" && (
          <span className={styles.etiqueta} style={{ background: "var(--scl-aviso-fundo)", color: "var(--scl-aviso-texto)" }}>
            pagamento de teste
          </span>
        )}
        {p.pedeAtencao && (
          <span className={styles.etiqueta} style={{ background: "var(--scl-erro-fundo)", color: "var(--scl-erro-texto)" }}>
            pede atenção
          </span>
        )}
      </div>
      <Linhas linhas={linhas} />
      {p.avisos.length > 0 && (
        <ul role="note" className={styles.alerta} style={{ margin: 0, paddingLeft: 28, fontSize: "0.875rem" }}>
          {p.avisos.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {editar && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {a.conferir && <FormAcaoPagamento acao={conferirAgoraAcao} pagamentoId={p.id} rotulo="Conferir agora" nome="Conferir agora no Mercado Pago" discreto />}
          {a.registrarLiberacao && (
            <FormAcaoPagamento
              acao={registrarLiberacaoAcao}
              pagamentoId={p.id}
              rotulo="Registrar liberação"
              nome="Registrar liberação"
              pergunta="Registrar a liberação deste pagamento com a data e o líquido informados? O recebimento entra na reserva (libera a parte do proprietário para repasse) e a taxa do Mercado Pago (valor − líquido) é gravada."
            >
              <label style={{ flex: "0 1 180px" }}>
                Data em que caiu na conta
                <input type="date" name="data" defaultValue={hoje} max={hoje} required />
              </label>
              <label style={{ flex: "0 1 180px" }}>
                Líquido que caiu (R$)
                <input name="liquido" inputMode="decimal" defaultValue={p.liquido !== null ? centavosParaCampo(p.liquido) : ""} required />
              </label>
            </FormAcaoPagamento>
          )}
          {a.estornarLiberacao && (
            <FormAcaoPagamento
              acao={estornarLiberacaoAcao}
              pagamentoId={p.id}
              rotulo="Estornar liberação"
              nome="Estornar liberação"
              discreto
              pergunta="Estornar a liberação registrada à mão? O recebimento sai da reserva e a parte do proprietário pode deixar de estar disponível para repasse."
            >
              <label style={{ flex: "1 1 220px" }}>
                Motivo do estorno
                <input name="motivo" required maxLength={200} placeholder="ex.: valor digitado errado" />
              </label>
            </FormAcaoPagamento>
          )}
          {a.devolver && (
            <FormAcaoPagamento
              acao={devolverAcao}
              pagamentoId={p.id}
              rotulo="Devolver pelo Mercado Pago"
              nome="Devolver pelo Mercado Pago"
              pergunta={`Devolver ao hóspede o valor integral${valorTexto} pelo Mercado Pago? A devolução não pode ser desfeita.`}
            />
          )}
          {a.devolucaoPorFora && (
            <FormAcaoPagamento
              acao={devolucaoPorForaAcao}
              pagamentoId={p.id}
              rotulo="Registrar devolução feita por fora"
              nome="Registrar devolução feita por fora"
              discreto
              pergunta="Registrar que o dinheiro já voltou ao hóspede por fora do Mercado Pago? Vale só o valor integral pago, e antes o sistema confere no Mercado Pago que a devolução não foi feita por lá. O pagamento fica encerrado como devolvido por fora e não pode mais ser devolvido pelo Mercado Pago."
            >
              <label style={{ flex: "0 1 180px" }}>
                Data da devolução
                <input type="date" name="data" defaultValue={hoje} max={hoje} required />
              </label>
              <label style={{ flex: "0 1 160px" }}>
                Valor devolvido (R$)
                <input name="valor" inputMode="decimal" defaultValue={verValores ? centavosParaCampo(p.valorPago ?? p.valor) : ""} required />
              </label>
              <label style={{ flex: "1 1 200px" }}>
                Nota (opcional)
                <input name="nota" maxLength={300} placeholder="ex.: Pix da conta da empresa em 10/10" />
              </label>
            </FormAcaoPagamento>
          )}
          {a.registrarTaxaPerdida && (
            <FormAcaoPagamento
              acao={registrarTaxaPerdidaAcao}
              pagamentoId={p.id}
              rotulo="Registrar taxa que não voltou"
              nome="Registrar taxa que não voltou"
              discreto
              pergunta={`Registrar {valor} como a taxa que o Mercado Pago não devolveu${verValores && p.taxa !== null ? ` (a taxa cobrada na aprovação foi ${formatBRL(p.taxa)})` : ""}? Ela entra como despesa da empresa (zero, se a taxa voltou toda) e só se registra uma vez.`}
              valorNaPergunta="valor"
            >
              <label style={{ flex: "0 1 220px" }}>
                Taxa que não voltou (R$)
                <input name="valor" inputMode="decimal" required placeholder="confira no Mercado Pago" />
              </label>
            </FormAcaoPagamento>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Ficha da reserva → quadro "Pagamento no site" (M8.2a): cada tentativa com forma, situação em palavras e datas
 * (quem lê reservas); valores para quem lê o financeiro; ações para quem edita o financeiro, só as que o pagamento
 * permite, e cada uma que mexe em dinheiro com confirmação.
 */
export function PagamentoNoSite({ pagamentos, verValores, editar, hoje }: Props) {
  if (!pagamentos.length) return null;
  return (
    <section aria-label="Pagamento no site" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Pagamento no site</h2>
      <p style={{ margin: 0, color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>
        Cada Pix gerado pelo hóspede no site. A situação só muda pelo que o Mercado Pago informa; o recebimento desta reserva vem da liberação do pagamento
        (pelo Mercado Pago ou registrada aqui), nunca da lista de recebimentos.
      </p>
      {pagamentos.map((p) => (
        <Tentativa key={p.id} p={p} verValores={verValores} editar={editar} hoje={hoje} />
      ))}
    </section>
  );
}
