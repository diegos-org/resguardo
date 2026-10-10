import type { ReactNode } from "react";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import styles from "@/components/formularios.module.css";
import { FormAcaoPagamento } from "@/components/pagamentos/FormAcaoPagamento";
import { DOCUMENTOS_LEGAIS, PAGINAS_LEGAIS } from "@/configuracoes/paginas-legais-texto";
import type { SituacaoDevolucao } from "@/db/schema";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
import {
  confirmarDevolucaoVistaAcao,
  conferirAgoraAcao,
  corrigirTaxaPerdidaAcao,
  devolucaoPorForaAcao,
  devolverAcao,
  estornarLiberacaoAcao,
  pararDevolucaoPedidaAcao,
  pedirRestanteAcao,
  registrarLiberacaoAcao,
  registrarRecusaNoPainelAcao,
  registrarTaxaPerdidaAcao,
} from "@/pagamentos/acoes-painel";
import { canceladaEmPalavras, type DevolucaoDoPainel, nomeDaBandeira, type PagamentoDoPainel } from "@/pagamentos/consultas";
import { DESAFIO_3DS_MINUTOS, type ModoTresDS, type StatusTresDS } from "@/pagamentos/provedor";
import { AVISOS_PAGAMENTO, NOMES_DESFECHO, NOMES_SITUACAO_PAGAMENTO, textoAguardandoLiberacao } from "@/pagamentos/situacoes";

type Props = {
  pagamentos: readonly PagamentoDoPainel[];
  /** financeiro:ler — valor, taxa, líquido, liberação e devoluções. */
  verValores: boolean;
  /** financeiro:editar — as ações (cada uma só quando o pagamento permite). */
  editar: boolean;
  hoje: string;
  /** M8.2c: o quadro do cancelamento pela política (pedido, cálculo, decisão, OTAs, mensagens), dentro desta seção. */
  cancelamento?: ReactNode;
  /** M8.2d: o quadro da alteração da reserva (a segurada, as aplicadas, o histórico), depois do cancelamento. */
  alteracao?: ReactNode;
  /** M8.2d: as alterações da reserva, para dizer de qual alteração é cada pagamento da diferença e cada devolução. */
  alteracoes?: readonly { id: string; criadaEm: Date }[];
};

const FUSO = "America/Sao_Paulo";
const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" });
const dia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: FUSO });
const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
const dataBr = (d: string) => d.split("-").reverse().join("/");
const FORMA = { pix: "Pix", cartao: "Cartão de crédito" } as const;
/** Verificação do banco (3DS) pedida e o resultado lido, em palavras (só para quem lê o financeiro). */
const TRES_DS: Record<ModoTresDS, string> = { on_fraud_risk: "quando houver risco", never: "nunca" };
const RESULTADO_TRES_DS: Record<StatusTresDS, string> = {
  AUTHENTICATED: "autenticado pelo banco",
  NOT_AUTHENTICATED: "não autenticado",
  CHALLENGE: "o banco pediu a verificação",
  ATTEMPTED: "tentada, sem desafio",
  REJECTED: "recusada pelo banco",
  ERROR: "erro na verificação",
};
/** No cartão, a devolução recusada pode ser falta de saldo no Mercado Pago (antes da liberação): o texto diz isso. */
export const DEVOLUCAO_FALHOU_CARTAO =
  "O Mercado Pago recusou ou não respondeu três vezes: confira no painel do Mercado Pago (no cartão, a devolução antes de o Mercado Pago liberar o dinheiro pode precisar de saldo disponível na conta) e, se devolver por lá, use Conferir agora: a devolução aparece aqui quando o Mercado Pago mostrar.";
/** Linha fixa junto do motivo de uma recusa de cartão (a equipe nunca vira oráculo de quem testa cartões). */
export const NAO_INFORME_O_MOTIVO = "Não informe o motivo ao hóspede: peça outro cartão ou o Pix.";
const DEVOLUCAO = {
  pedida: "pedida ao Mercado Pago, aguardando confirmação",
  confirmada: "confirmada pelo Mercado Pago",
  recusada: "o Mercado Pago recusou ou não respondeu três vezes: confira no painel do Mercado Pago antes de tentar de novo ou de registrar a devolução feita por fora",
  por_fora: "feita por fora",
  // M8.2d: a devolução de uma alteração que nunca chegou ao Mercado Pago, absorvida pela do cancelamento.
  substituida: "substituída pela devolução do cancelamento",
} as const;

/**
 * A situação da tentativa em palavras simples, com o desfecho quando houver. No cartão, igual para toda a equipe: o
 * motivo de uma recusa só aparece no bloco do financeiro.
 */
export function situacaoEmPalavras(p: PagamentoDoPainel, alteracaoEm: Date | null = null): string {
  if (p.forma === "cartao") {
    if (p.situacao === "pendente") {
      if (p.etapaCartao === "desafio") {
        const ate = new Date(p.criadoEm.getTime() + DESAFIO_3DS_MINUTOS * 60_000);
        return `Aguardando a verificação do banco do hóspede (até ${hora(ate)})`;
      }
      if (p.etapaCartao === "analise") return "Em análise no Mercado Pago (pode levar até 2 dias úteis)";
      return "O Mercado Pago está processando";
    }
    if (p.situacao === "criando" || p.situacao === "incerta") return "Conferindo no Mercado Pago se o pagamento foi criado";
    if (p.situacao === "recusado") return "Recusado pelo Mercado Pago";
  }
  if (p.situacao === "pendente") return p.pixExpiraEm ? `Aguardando o pagamento do Pix (vale até ${hora(p.pixExpiraEm)} de ${dia(p.pixExpiraEm)})` : "Aguardando o pagamento";
  if (p.situacao === "criando" || p.situacao === "incerta") return "Conferindo no Mercado Pago se o Pix foi criado";
  // M8.2c: a reserva que o pagamento confirmou foi cancelada pela política (a mesma situação da página do hóspede).
  if (p.desfecho === "reserva" && p.cancelada) return canceladaEmPalavras(p.cancelada);
  if (p.desfecho === "reserva") return p.situacao === "aprovado" ? "Aprovado: confirmou a reserva" : `${NOMES_SITUACAO_PAGAMENTO[p.situacao]} (tinha confirmado a reserva)`;
  // M8.2d: a diferença paga de uma alteração aplicada.
  if (p.desfecho === "alteracao") {
    const de = alteracaoEm ? ` de ${dia(alteracaoEm)}` : "";
    return p.situacao === "aprovado" ? `Aprovado: pagou a diferença da alteração${de}` : `${NOMES_SITUACAO_PAGAMENTO[p.situacao]} (tinha pagado a diferença da alteração${de})`;
  }
  if (p.desfecho) return NOMES_DESFECHO[p.desfecho];
  if (p.situacao === "aprovado" && p.motivoSemReservaTexto) return `Aprovado sem reserva: ${p.motivoSemReservaTexto} O valor precisa ser devolvido ao hóspede.`;
  if ((p.situacao === "devolvido_parcial" || p.situacao === "contestado") && p.motivoSemReservaTexto)
    return `${NOMES_SITUACAO_PAGAMENTO[p.situacao]} sem reserva: ${p.motivoSemReservaTexto} ${p.situacao === "devolvido_parcial" ? "Devolva o restante pelo quadro do pagamento." : "A contestação se resolve pelo painel do Mercado Pago."}`;
  if (p.situacao === "aprovado") return "Aprovado: confirmando a reserva";
  return NOMES_SITUACAO_PAGAMENTO[p.situacao];
}

function Linhas({ linhas }: { linhas: [string, ReactNode][] }) {
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

/**
 * As páginas legais que o hóspede aceitou antes de gerar esta tentativa (M7.4), com o link de cada versão no site e o
 * prazo do reembolso integral dessa Política de cancelamento — a que vale para esta tentativa, nunca a em vigor hoje.
 */
function aceiteDaTentativa(a: NonNullable<PagamentoDoPainel["aceite"]>): ReactNode {
  return (
    <>
      {DOCUMENTOS_LEGAIS.map((doc, i) => (
        <span key={doc}>
          {i > 0 && " · "}
          <a href={`${PAGINAS_LEGAIS[doc].rota}?versao=${a.versoes[doc]}`} target="_blank" rel="noopener noreferrer">
            {PAGINAS_LEGAIS[doc].curto} v{a.versoes[doc]}
          </a>
          {doc === "cancelamento" && a.diasReembolsoIntegral !== null && ` (reembolso integral até ${a.diasReembolsoIntegral} dias antes)`}
        </span>
      ))}
      {` — ${quando(a.aceitoEm)}`}
    </>
  );
}

function liberacao(p: PagamentoDoPainel): string | null {
  if (p.liberacaoConfirmadaEm) return `${p.liberacaoOrigem === "manual" ? "registrada à mão" : "confirmada pelo Mercado Pago"} em ${dia(p.liberacaoConfirmadaEm)}`;
  if (p.liberacaoPrevistaEm) return `o Mercado Pago libera em ${dia(p.liberacaoPrevistaEm)} (previsão)`;
  return p.desfecho === "reserva" ? "ainda sem data do Mercado Pago" : null;
}

/** O último código do Mercado Pago que explica a espera ou a recusa (M8.2c). */
const DICA_DO_CODIGO: Partial<Record<string, string>> = {
  saldo_insuficiente: "o Mercado Pago pediu saldo disponível na conta: coloque saldo e peça de novo",
  em_andamento: "o Mercado Pago pediu para esperar: o sistema tenta de novo sozinho",
  transitorio: "o Mercado Pago pediu para esperar: o sistema tenta de novo sozinho",
};

/**
 * A recusada que não é uma recusa do Mercado Pago, em palavras (a mesma na linha "Devolução" e na linha de cada devolução):
 * a recusa do painel registrada pela equipe, a parada pela equipe e a parada pelo prazo; null = as outras.
 */
function recusaEmPalavras(d: { situacao: SituacaoDevolucao; recusaNoPainelEm?: Date | null; paradaEm?: Date | null; paradaPeloPrazo?: boolean }): string | null {
  if (d.situacao !== "recusada") return null;
  if (d.recusaNoPainelEm) return "recusada no painel do Mercado Pago (registrado pela equipe): a devolução por fora fica liberada";
  if (d.paradaEm) return "parada pela equipe depois do prazo de leitura do Mercado Pago";
  // Parada pelo prazo (pagamento com mais de 78 dias, M8.2c), pela regra do domínio: o Mercado Pago não recusou nada; o
  // sistema não pede mais. A parada por outro motivo (devolvido em parte, contestado) não é esta: o aviso dela explica.
  if (d.paradaPeloPrazo) return "parada pelo prazo: o pagamento tem mais de 78 dias e o sistema não pede mais a devolução ao Mercado Pago (devolva pelo painel dele e confirme aqui, ou por fora)";
  return null;
}

/** A situação da devolução em palavras (M8.2c: também a recusa do painel registrada, a parada e a que nunca foi pedida). */
function situacaoDaDevolucao(d: NonNullable<PagamentoDoPainel["devolucao"]>): string {
  return recusaEmPalavras(d) ?? DEVOLUCAO[d.situacao];
}

/** A linha "Devolução" do quadro (a mesma do quadro do cancelamento): situação, valor, datas, pedidos e taxa que não voltou. */
export function linhaDaDevolucao(p: PagamentoDoPainel, verValores: boolean): string | null {
  return devolucao(p, verValores);
}

/**
 * As devoluções do cancelamento (M8.2d, D22: uma por pagamento que conta — depois de um aumento, a do pagamento da
 * reserva e a do pagamento da diferença; e o restante de uma devolvida a menos), cada uma com o pagamento de onde sai e a
 * linha "Devolução" dela. Vêm das devoluções do pagamento que são deste cancelamento (nunca da que manda no pagamento, que
 * pode ser a de uma redução de antes), pela criação. Sem a lista (tentativa montada à mão), a que manda, se for do
 * cancelamento. Vazia quando nenhuma é (quem chama usa a linha do pagamento que confirmou).
 */
export function devolucoesDoCancelamento(
  pagamentos: readonly PagamentoDoPainel[],
  verValores: boolean,
  cancelamentoId?: string,
): { chave: string; pagamentoId: string; rotulo: string; linha: string }[] {
  const pelaCriacao = (a: DevolucaoDoPainel, b: DevolucaoDoPainel) => a.criadoEm.getTime() - b.criadoEm.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return pagamentos
    .filter((p) => p.desfecho === "reserva" || p.desfecho === "alteracao")
    .flatMap((p) => {
      const rotulo = `${FORMA[p.forma]} de ${dia(p.criadoEm)}${p.desfecho === "alteracao" ? " (a diferença da alteração)" : ""}`;
      if (!p.devolucoes) return p.devolucao?.origem === "cancelamento" ? [{ chave: p.id, pagamentoId: p.id, rotulo, linha: linhaDe(p.devolucao, verValores) }] : [];
      return p.devolucoes
        .filter((d) => d.origem === "cancelamento" && (cancelamentoId === undefined || d.cancelamentoId === cancelamentoId))
        .sort(pelaCriacao)
        .map((d) => ({ chave: d.id, pagamentoId: p.id, rotulo: `${rotulo}${d.restanteDe ? " (restante)" : ""}`, linha: linhaDe(d, verValores) }));
    });
}

function devolucao(p: PagamentoDoPainel, verValores: boolean): string | null {
  return p.devolucao ? linhaDe(p.devolucao, verValores) : null;
}

/** A linha "Devolução" de uma devolução (a que manda no pagamento, ou uma da lista do M8.2d). */
function linhaDe(d: NonNullable<PagamentoDoPainel["devolucao"]>, verValores: boolean): string {
  const partes: string[] = [situacaoDaDevolucao(d)];
  if (verValores) partes.push(formatBRL(d.situacao === "por_fora" && d.porForaValor !== null ? d.porForaValor : d.valor));
  if (d.situacao === "por_fora" && d.porForaData) partes.push(`em ${dataBr(d.porForaData)}`);
  if (d.confirmadaEm) partes.push(`em ${dia(d.confirmadaEm)}`);
  // M8.2c: confirmada pela equipe (vista no painel do Mercado Pago); a nota, só para quem lê o financeiro.
  if (d.situacao === "confirmada" && d.confirmadaPor === "equipe") partes.push(`confirmada pela equipe${verValores && d.confirmadaNota ? `: ${d.confirmadaNota}` : ""}`);
  if (d.situacao === "pedida" && d.tentativas) partes.push(`${d.tentativas} pedido(s) ao Mercado Pago${d.falhas ? `, ${d.falhas} falha(s)` : ""}`);
  // "Pediu para esperar" só vale enquanto a devolução está pedida (a recusada, parada, não tenta de novo sozinha); a falta
  // de saldo explica também a recusada.
  const dica = d.ultimoCodigo && (d.situacao === "pedida" || (d.situacao === "recusada" && d.ultimoCodigo === "saldo_insuficiente")) ? DICA_DO_CODIGO[d.ultimoCodigo] : undefined;
  if (dica) partes.push(dica);
  if (verValores && d.situacao === "confirmada" && d.valorConfirmado !== null && d.valorConfirmado !== undefined && d.valorConfirmado !== d.valor) partes.push(`o Mercado Pago mostrou ${formatBRL(d.valorConfirmado)} devolvidos`);
  if (verValores && d.taxaPerdida !== null) partes.push(`taxa que ficou com o Mercado Pago: ${formatBRL(d.taxaPerdida)}`);
  // A nota da devolução por fora é texto livre (pode trazer um valor): só para quem lê o financeiro, como a da confirmação.
  if (verValores && d.situacao === "por_fora" && d.porForaNota) partes.push(`nota: ${d.porForaNota}`);
  return partes.join(" · ");
}

/**
 * D17: de onde sai o restante quando o Mercado Pago não disse quanto já devolveu (a pergunta tira dele o valor do painel
 * informado): o pago, ou o que ainda se pode devolver depois das outras devoluções do pagamento.
 */
const baseDoRestante = (base: number, pago: number) => `${base === pago ? "o pago" : "o que ainda se pode devolver"} (${formatBRL(base)})`;

/** De onde vem a devolução (M8.2d): da alteração (com o dia), do cancelamento, do pagamento sem reserva, ou o restante de outra. */
function origemDaDevolucao(d: DevolucaoDoPainel, alteracoes: Props["alteracoes"]): string {
  if (d.restanteDe) return "Restante de uma devolução";
  if (d.origem === "alteracao") {
    const a = alteracoes?.find((x) => x.id === d.alteracaoId);
    return `Devolução da alteração${a ? ` de ${dia(a.criadaEm)}` : ""}`;
  }
  if (d.origem === "cancelamento") return "Devolução do cancelamento";
  if (d.origem === "sem_reserva") return "Devolução do pagamento sem reserva";
  return "Devolução";
}

/**
 * A situação de uma devolução em palavras (M8.2d), com os detalhes da linha "Devolução" de antes (M8.2a, M8.2c): esperando a
 * liberação; pedida (e quantos pedidos e falhas); confirmada (pela equipe, com a nota); por fora (com a nota); substituída;
 * recusada — pela recusa do painel registrada, parada pela equipe ou pelo prazo, ou pelo aviso dela (três recusas, parada
 * por uma devolução que o sistema não pediu, o restante recusado). As notas são texto livre: só com `financeiro:ler`.
 */
function situacaoDeUmaDevolucao(p: PagamentoDoPainel, d: DevolucaoDoPainel, verValores: boolean): string {
  if (d.situacao === "pedida" && d.aguardandoLiberacao) return `aguardando a liberação do pagamento${p.liberacaoPrevistaEm ? ` (prevista para ${dia(p.liberacaoPrevistaEm)})` : ""}`;
  const partes: string[] = [];
  if (d.situacao === "pedida") {
    partes.push(DEVOLUCAO.pedida);
    if (d.tentativas) partes.push(`${d.tentativas} pedido(s) ao Mercado Pago${d.falhas ? `, ${d.falhas} falha(s)` : ""}`);
  } else if (d.situacao === "confirmada") {
    const valorVisto = verValores && d.valorConfirmado !== null && d.valorConfirmado !== d.valor ? ` (o Mercado Pago devolveu ${formatBRL(d.valorConfirmado)})` : "";
    partes.push(`confirmada${d.confirmadaPor === "equipe" ? " pela equipe (vista no painel do Mercado Pago)" : ""}${d.confirmadaEm ? ` em ${dia(d.confirmadaEm)}` : ""}${valorVisto}`);
    if (verValores && d.confirmadaPor === "equipe" && d.confirmadaNota) partes.push(`nota: ${d.confirmadaNota}`);
  } else if (d.situacao === "por_fora") {
    partes.push(`feita por fora${d.porForaData ? ` em ${dataBr(d.porForaData)}` : ""}${verValores && d.porForaValor !== null && d.porForaValor !== d.valor ? ` (${formatBRL(d.porForaValor)})` : ""}`);
    if (verValores && d.porForaNota) partes.push(`nota: ${d.porForaNota}`);
  } else if (d.situacao === "substituida") partes.push(DEVOLUCAO.substituida);
  else partes.push(recusaEmPalavras(d) ?? recusadaPeloAviso(d));
  return partes.join(" · ");
}

/** Por que a devolução está recusada, pelo aviso dela (o aviso do pagamento explica e diz o que fazer). */
function recusadaPeloAviso(d: DevolucaoDoPainel): string {
  if (d.avisos.includes("devolucao_a_menor")) return "o Mercado Pago recusou o pedido deste restante: confira no painel do Mercado Pago (veja o aviso do pagamento)";
  if (d.avisos.includes("devolucao_parada"))
    return "parada: o Mercado Pago mostra uma devolução que o sistema não pediu, uma contestação ou outra situação neste pagamento (veja o aviso do pagamento)";
  if (d.avisos.includes("devolucao_falhou")) return DEVOLUCAO.recusada;
  return "recusada ou parada: veja o aviso do pagamento e confira no painel do Mercado Pago";
}

/** A dica do último código do Mercado Pago numa devolução (a espera pela liberação, D13, e as esperas pedidas por ele). */
function dicaDaDevolucao(p: PagamentoDoPainel, d: DevolucaoDoPainel): string | null {
  if (d.situacao === "pedida" && d.aguardandoLiberacao) return textoAguardandoLiberacao(p.liberacaoPrevistaEm ? dia(p.liberacaoPrevistaEm).slice(0, 5) : null);
  if (d.ultimoCodigo && (d.situacao === "pedida" || (d.situacao === "recusada" && d.ultimoCodigo === "saldo_insuficiente"))) return DICA_DO_CODIGO[d.ultimoCodigo] ?? null;
  return null;
}

/**
 * As devoluções do pagamento (M8.2d: várias por pagamento — a da alteração, a do cancelamento, o restante…), uma linha cada,
 * com as ações que o domínio aceita para ela (calculadas pelas mesmas regras que o servidor confere). Valores só com
 * `financeiro:ler`; ações só com `financeiro:editar`.
 */
function Devolucoes({ p, verValores, editar, hoje, alteracoes }: { p: PagamentoDoPainel; verValores: boolean; editar: boolean; hoje: string; alteracoes: Props["alteracoes"] }) {
  const lista = p.devolucoes ?? [];
  if (!lista.length) return null;
  const cartao = p.forma === "cartao";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "0.875rem" }}>
      <strong>Devoluções</strong>
      {lista.map((d) => {
        const valor = verValores ? ` de ${formatBRL(d.valor)}` : "";
        const restante = d.valorConfirmado !== null ? d.valor - d.valorConfirmado : 0;
        const dica = dicaDaDevolucao(p, d);
        const a = d.acoes;
        // D17: a do pagamento sem reserva, pedida de novo ou registrada por fora, sai pelo restante do pagamento (o domínio
        // refaz o valor); sem o Mercado Pago dizer quanto já devolveu, a equipe informa o valor do painel dele.
        const rs = d.restanteSemReserva;
        const peloRestante = !!rs && (a.pedirDeNovo || a.porFora) && (rs.semValor || rs.valor !== d.valor);
        const semValor = !!rs && rs.semValor;
        const valorQueSai = rs && !rs.semValor ? rs.valor : d.valor;
        const campoDoPainel = semValor && (
          <label style={{ flex: "0 1 280px" }}>
            O Mercado Pago não informou quanto já foi devolvido: informe o valor que aparece no painel dele (R$)
            <input name="valorForaInformado" inputMode="decimal" required />
          </label>
        );
        const restanteNaPergunta = rs?.semValor && verValores ? { campo: "valorForaInformado", de: rs.base } : undefined;
        return (
          <div key={d.id} aria-label={`${origemDaDevolucao(d, alteracoes)}${valor}`} style={{ borderLeft: "3px solid var(--scl-borda)", paddingLeft: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <span>
              {origemDaDevolucao(d, alteracoes)}
              {valor}: {situacaoDeUmaDevolucao(p, d, verValores)}
              {verValores && d.taxaPerdida !== null ? ` · taxa que ficou com o Mercado Pago: ${formatBRL(d.taxaPerdida)}` : ""}
            </span>
            {dica && <span style={{ color: "var(--scl-texto-2)" }}>{dica}</span>}
            {editar && peloRestante && (
              <span style={{ color: "var(--scl-texto-2)" }}>
                {semValor
                  ? "Pedida de novo ou registrada por fora, esta devolução sai pelo restante do pagamento: o pago menos o que o painel do Mercado Pago mostra devolvido (ele não informou quanto: informe o valor que aparece lá)."
                  : verValores
                    ? `Pedida de novo ou registrada por fora, esta devolução sai pelo restante do pagamento: ${formatBRL(valorQueSai)} (o Mercado Pago já mostra ${formatBRL((p.valorPago ?? p.valor) - valorQueSai)} devolvidos).`
                    : "Pedida de novo ou registrada por fora, esta devolução sai pelo restante do pagamento (o Mercado Pago já mostra parte dele devolvida)."}
              </span>
            )}
            {editar && (
              <>
                {a.pedirDeNovo && (
                  <FormAcaoPagamento
                    acao={devolverAcao}
                    pagamentoId={p.id}
                    devolucaoId={d.id}
                    rotulo="Pedir a devolução de novo"
                    nome="Pedir a devolução de novo"
                    pergunta={
                      semValor
                        ? `Pedir de novo ao Mercado Pago esta devolução pelo restante do pagamento${restanteNaPergunta ? `: {restante}, que é ${baseDoRestante(restanteNaPergunta.de, p.valorPago ?? p.valor)} menos os {valor} que o painel do Mercado Pago mostra devolvidos` : ""}? Confira antes no painel do Mercado Pago que a anterior não saiu.`
                        : `Pedir de novo ao Mercado Pago esta devolução${peloRestante ? ", pelo restante do pagamento" : ""}${verValores ? ` (${formatBRL(valorQueSai)})` : ""}? Confira antes no painel do Mercado Pago que a anterior não saiu.`
                    }
                    valorNaPergunta={restanteNaPergunta ? "valorForaInformado" : undefined}
                    restanteNaPergunta={restanteNaPergunta}
                  >
                    {campoDoPainel}
                  </FormAcaoPagamento>
                )}
                {a.pedirRestante && (
                  <FormAcaoPagamento
                    acao={pedirRestanteAcao}
                    pagamentoId={p.id}
                    devolucaoId={d.id}
                    rotulo="Pedir o restante ao Mercado Pago"
                    nome="Pedir o restante ao Mercado Pago"
                    pergunta={`Pedir ao Mercado Pago o restante${verValores ? ` de ${formatBRL(restante)}` : ""} desta devolução? Confira antes no painel do Mercado Pago que ele não saiu.`}
                  />
                )}
                {a.restantePorFora && (
                  <FormAcaoPagamento
                    acao={devolucaoPorForaAcao}
                    pagamentoId={p.id}
                    rotulo="Registrar o restante devolvido por fora"
                    nome="Registrar o restante devolvido por fora"
                    discreto
                    pergunta={`Registrar que o restante já voltou ao hóspede por fora do Mercado Pago? Antes o sistema confere no Mercado Pago que ele não saiu por lá. Vale só para o restante${verValores ? ` (${formatBRL(restante)})` : ""}.${cartao ? " O hóspede pode também contestar a cobrança no cartão e receber de novo: só registre se a devolução já foi feita e combinada com ele." : ""}`}
                  >
                    <input type="hidden" name="restanteDe" value={d.id} />
                    <label style={{ flex: "0 1 180px" }}>
                      Data da devolução
                      <input type="date" name="data" defaultValue={hoje} max={hoje} required />
                    </label>
                    <label style={{ flex: "0 1 160px" }}>
                      Valor devolvido (R$)
                      <input name="valor" inputMode="decimal" defaultValue={verValores ? centavosParaCampo(restante) : ""} required />
                    </label>
                    <label style={{ flex: "1 1 200px" }}>
                      Nota (opcional)
                      <input name="nota" maxLength={300} placeholder="ex.: Pix da conta da empresa em 10/10" />
                    </label>
                  </FormAcaoPagamento>
                )}
                {a.confirmarVista && (
                  <FormAcaoPagamento
                    acao={confirmarDevolucaoVistaAcao}
                    pagamentoId={p.id}
                    devolucaoId={d.id}
                    rotulo="Confirmar devolução vista no painel do Mercado Pago"
                    nome="Confirmar devolução vista no painel do Mercado Pago"
                    discreto
                    pergunta="Confirmar que o Mercado Pago devolveu {valor} ao hóspede em {data}? Confira no painel do Mercado Pago. O financeiro da devolução é lançado agora e não se desfaz."
                    valorNaPergunta="valor"
                    dataNaPergunta="data"
                  >
                    <p style={{ flexBasis: "100%", margin: 0, color: "var(--scl-texto-2)" }}>Confirme só se o painel do Mercado Pago mostra esta devolução concluída, com o valor que aparece lá.</p>
                    <label style={{ flex: "0 1 180px" }}>
                      Data da devolução no Mercado Pago
                      <input type="date" name="data" defaultValue={hoje} max={hoje} required />
                    </label>
                    <label style={{ flex: "0 1 180px" }}>
                      Valor que o painel mostra (R$)
                      <input name="valor" inputMode="decimal" defaultValue={verValores ? centavosParaCampo(d.valor) : ""} required />
                    </label>
                    <label style={{ flex: "1 1 220px" }}>
                      Nota (obrigatória, sem dados pessoais)
                      <input name="nota" required maxLength={300} placeholder="ex.: painel do Mercado Pago mostra devolução concluída em 12/10" />
                    </label>
                  </FormAcaoPagamento>
                )}
                {a.registrarRecusaNoPainel && (
                  <FormAcaoPagamento
                    acao={registrarRecusaNoPainelAcao}
                    pagamentoId={p.id}
                    devolucaoId={d.id}
                    rotulo="Registrar que o Mercado Pago recusou a devolução no painel"
                    nome="Registrar que o Mercado Pago recusou a devolução no painel"
                    discreto
                    pergunta="Registrar que o painel do Mercado Pago recusou esta devolução? Isso libera a devolução por fora no cartão."
                  >
                    <label style={{ flex: "0 1 180px" }}>
                      Data da recusa
                      <input type="date" name="data" defaultValue={hoje} max={hoje} required />
                    </label>
                    <label style={{ flex: "1 1 220px" }}>
                      Nota (obrigatória, sem dados pessoais)
                      <input name="nota" required maxLength={300} placeholder="ex.: painel do Mercado Pago não deixou devolver" />
                    </label>
                  </FormAcaoPagamento>
                )}
                {a.parar && (
                  <FormAcaoPagamento
                    acao={pararDevolucaoPedidaAcao}
                    pagamentoId={p.id}
                    devolucaoId={d.id}
                    rotulo="Parar a devolução pedida"
                    nome="Parar a devolução pedida"
                    discreto
                    pergunta={`Parar o pedido desta devolução${valor}? Confira no painel do Mercado Pago que nenhuma devolução saiu: depois disso a devolução por fora fica liberada.`}
                  >
                    <label style={{ flex: "1 1 220px" }}>
                      Nota (o que o painel do Mercado Pago mostra; sem dados pessoais)
                      <input name="nota" maxLength={300} placeholder="ex.: painel do Mercado Pago sem nenhuma devolução" />
                    </label>
                  </FormAcaoPagamento>
                )}
                {a.porFora && (
                  <FormAcaoPagamento
                    acao={devolucaoPorForaAcao}
                    pagamentoId={p.id}
                    devolucaoId={d.id}
                    rotulo="Registrar devolução feita por fora"
                    nome="Registrar devolução feita por fora"
                    discreto
                    pergunta={`${
                      peloRestante
                        ? `Registrar que ${verValores ? "{valor}" : "o restante do pagamento"} já voltou ao hóspede por fora do Mercado Pago? Vale só o restante do pagamento${verValores ? (restanteNaPergunta ? `: {restante}, que é ${baseDoRestante(restanteNaPergunta.de, p.valorPago ?? p.valor)} menos o que o painel do Mercado Pago mostra devolvido` : ` (${formatBRL(valorQueSai)})`) : ""}, e antes o sistema confere no Mercado Pago que ele não foi devolvido por lá. Depois, esta devolução não pode mais ser pedida ao Mercado Pago.`
                        : `Registrar que esta devolução${valor} já voltou ao hóspede por fora do Mercado Pago? Vale só o valor desta devolução, e antes o sistema confere no Mercado Pago que ela não foi feita por lá. Depois, ela não pode mais ser pedida ao Mercado Pago.`
                    }${cartao ? " O hóspede pode também contestar a cobrança no cartão e receber de novo: só registre se a devolução já foi feita e combinada com ele." : ""}`}
                    valorNaPergunta={peloRestante && verValores ? "valor" : undefined}
                    restanteNaPergunta={restanteNaPergunta}
                  >
                    <label style={{ flex: "0 1 180px" }}>
                      Data da devolução
                      <input type="date" name="data" defaultValue={hoje} max={hoje} required />
                    </label>
                    <label style={{ flex: "0 1 160px" }}>
                      Valor devolvido (R$)
                      <input name="valor" inputMode="decimal" defaultValue={verValores && !semValor ? centavosParaCampo(valorQueSai) : ""} required />
                    </label>
                    {campoDoPainel}
                    <label style={{ flex: "1 1 200px" }}>
                      Nota (opcional)
                      <input name="nota" maxLength={300} placeholder="ex.: Pix da conta da empresa em 10/10" />
                    </label>
                  </FormAcaoPagamento>
                )}
                {a.registrarTaxa && (
                  <FormAcaoPagamento
                    acao={registrarTaxaPerdidaAcao}
                    pagamentoId={p.id}
                    devolucaoId={d.id}
                    rotulo="Registrar taxa que não voltou"
                    nome="Registrar taxa que não voltou"
                    discreto
                    pergunta="Registrar {valor} como a taxa que o Mercado Pago não devolveu nesta devolução? Ela entra como despesa da empresa (zero, se a taxa voltou toda) e só se registra uma vez."
                    valorNaPergunta="valor"
                  >
                    <label style={{ flex: "0 1 260px" }}>
                      Taxa (e juros do parcelamento, se o Mercado Pago tirou da SCL) que não voltou (R$)
                      <input name="valor" inputMode="decimal" required placeholder="confira no Mercado Pago" />
                    </label>
                  </FormAcaoPagamento>
                )}
                {a.corrigirTaxa && (
                  <FormAcaoPagamento
                    acao={corrigirTaxaPerdidaAcao}
                    pagamentoId={p.id}
                    devolucaoId={d.id}
                    rotulo="Corrigir taxa que não voltou"
                    nome="Corrigir taxa que não voltou"
                    discreto
                    pergunta={`Corrigir a taxa que não voltou nesta devolução para {valor}${verValores && d.taxaPerdida !== null ? ` (hoje: ${formatBRL(d.taxaPerdida)})` : ""}? A despesa atual é estornada, com o motivo, e a nova entra no financeiro da empresa.`}
                    valorNaPergunta="valor"
                  >
                    <label style={{ flex: "0 1 220px" }}>
                      Taxa certa que não voltou (R$)
                      <input name="valor" inputMode="decimal" required placeholder="zero se voltou toda" />
                    </label>
                    <label style={{ flex: "1 1 220px" }}>
                      Motivo da correção (sem dados pessoais)
                      <input name="motivo" required maxLength={300} placeholder="ex.: o extrato do Mercado Pago mostrou outra taxa" />
                    </label>
                  </FormAcaoPagamento>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Os identificadores no Mercado Pago (não são dado pessoal), cada um com o botão de copiar: é por eles que se acha o pagamento lá. */
function Identificadores({ p }: { p: PagamentoDoPainel }) {
  const ids: [string, string][] = [];
  if (p.idProvedor) ids.push(["", p.idProvedor]);
  if (p.referencia) ids.push(["", p.referencia]);
  if (p.idPagamentoProvedor) ids.push(["pagamento ", p.idPagamentoProvedor]);
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center" }}>
      {ids.map(([prefixo, id]) => (
        <span key={id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <code>
            {prefixo}
            {id}
          </code>
          <BotaoCopiar texto={id} rotulo="Copiar" className={styles.pequeno} />
        </span>
      ))}
    </span>
  );
}

/** "Cartão de crédito · Visa · 3x" (bandeira e parcelas; nunca BIN nem últimos dígitos). */
function cabecalhoDaForma(p: PagamentoDoPainel): string {
  if (p.forma !== "cartao") return FORMA[p.forma];
  const partes: string[] = [FORMA.cartao];
  const bandeira = nomeDaBandeira(p.bandeira ?? null);
  if (bandeira) partes.push(bandeira);
  if (p.parcelas) partes.push(`${p.parcelas}x`);
  return partes.join(" · ");
}

function Tentativa({ p, verValores, editar, hoje, alteracoes }: { p: PagamentoDoPainel } & Omit<Props, "pagamentos">) {
  const cartao = p.forma === "cartao";
  // M8.2d: o domínio manda todas as devoluções do pagamento, cada uma com as ações dela; sem elas (tentativa montada à mão), o
  // quadro de antes, com a devolução que manda.
  const porDevolucao = p.devolucoes !== undefined;
  const alteracao = p.alteracaoId ? (alteracoes?.find((x) => x.id === p.alteracaoId) ?? null) : null;
  const linhas: [string, ReactNode][] = [
    ["Situação", situacaoEmPalavras(p, alteracao?.criadaEm ?? null)],
    [cartao ? "Criado em" : "Gerado em", quando(p.criadoEm)],
  ];
  if (p.idProvedor || p.idPagamentoProvedor) linhas.push(["No Mercado Pago", <Identificadores key="ids" p={p} />]);
  if (p.aceite) linhas.push(["Aceite", aceiteDaTentativa(p.aceite)]);
  else if (p.aceite === null) linhas.push(["Aceite", "não registrado (tentativa anterior às páginas legais do site)"]);
  if (p.aprovadoEm) linhas.push(["Aprovado em", quando(p.aprovadoEm)]);
  if (p.desfechoEm && p.desfecho !== "reserva") linhas.push(["Encerrado em", quando(p.desfechoEm)]);
  if (p.consultadoEm) linhas.push(["Última conferência", quando(p.consultadoEm)]);
  const dev = porDevolucao ? null : devolucao(p, verValores);
  if (dev) linhas.push(["Devolução", dev]);
  if (verValores) {
    linhas.push([cartao ? "Valor da reserva" : "Valor", formatBRL(p.valor)]);
    if (p.valorPago !== null && p.valorPago !== p.valor)
      linhas.push([
        "Pago pelo hóspede",
        cartao && p.juros ? `${formatBRL(p.valorPago)} (inclui ${formatBRL(p.juros)} de juros do parcelamento, que ficam com o Mercado Pago)` : formatBRL(p.valorPago),
      ]);
    if (cartao) {
      // Só para quem lê o financeiro: o motivo da recusa, a verificação do banco e o custo do "sem acréscimo".
      if (p.motivoRecusa)
        linhas.push([
          "Motivo (só para a equipe)",
          <span key="motivo">
            {p.motivoRecusa} <strong>{NAO_INFORME_O_MOTIVO}</strong>
          </span>,
        ]);
      if (p.tresDS) linhas.push(["Verificação do banco", `${TRES_DS[p.tresDS]}${p.tresDSStatus ? ` (resultado deste pagamento: ${RESULTADO_TRES_DS[p.tresDSStatus]})` : ""}`]);
      if (p.custoParcelasVendedor) linhas.push(["Custo do parcelamento sem acréscimo cobrado da SCL", formatBRL(p.custoParcelasVendedor)]);
    }
    linhas.push(["Taxa do Mercado Pago", p.taxa === null ? "ainda não informada" : formatBRL(p.taxa)]);
    linhas.push(["Líquido", p.liquido === null ? "ainda não informado" : formatBRL(p.liquido)]);
    const lib = liberacao(p);
    if (lib) linhas.push(["Liberação", lib]);
  }
  // No quadro por devolução (M8.2d), o pagamento só oferece o que não é de uma devolução existente: conferir, a liberação e,
  // no pagamento sem reserva, criar a devolução (o integral ou o restante, D17). O resto é de cada devolução.
  const linhasDeDevolucao = p.devolucoes ?? [];
  const a = porDevolucao
    ? {
        ...p.acoes,
        devolver: p.acoes.devolver && !linhasDeDevolucao.some((d) => d.acoes.pedirDeNovo),
        devolucaoPorFora: p.acoes.devolucaoPorFora && !linhasDeDevolucao.some((d) => d.acoes.porFora),
        registrarTaxaPerdida: false,
        confirmarDevolucaoVista: false,
        registrarRecusaNoPainel: false,
        pararDevolucaoPedida: false,
        corrigirTaxaPerdida: false,
      }
    : p.acoes;
  // O restante de um pagamento sem reserva já devolvido em parte (D17): o que o domínio devolve agora (o pago menos as
  // devoluções e o devolvido fora do sistema), não o pago; sem o Mercado Pago dizer quanto já devolveu, nenhum número: o
  // restante sai do valor do painel dele que a equipe informa (e a pergunta mostra a conta na hora).
  const rest = porDevolucao ? (p.restante ?? null) : null;
  const restante = !!rest && (p.situacao === "devolvido_parcial" || (p.foraReconhecido ?? 0) > 0 || (p.devolvidoLido ?? 0) > 0 || linhasDeDevolucao.length > 0);
  const restanteSemValor = restante && !!rest?.semValor;
  const pago = p.valorPago ?? p.valor;
  const valorDoRestante = rest && !rest.semValor ? rest.valor : null;
  const restanteNaPergunta = restanteSemValor && verValores && rest?.semValor ? { campo: "valorForaInformado", de: rest.base } : undefined;
  // O que a devolução integral devolve: o que o hóspede pagou (a mesma regra do domínio), não o total pedido.
  const valorTexto = verValores ? (restante ? (valorDoRestante !== null ? ` de ${formatBRL(valorDoRestante)}` : "") : ` de ${formatBRL(pago)}`) : "";
  // D26: os avisos com valores só para quem lê o financeiro; sem os textos sem valores (tentativa montada à mão), nenhum com R$.
  const avisos = verValores ? p.avisos : (p.avisosSemValores ?? p.avisos.filter((t) => !t.includes("R$")));
  // M8.2c: a devolução do cancelamento pela política (a reserva fica como está; o financeiro do cancelamento é acertado).
  const doCancelamento = p.devolucao?.origem === "cancelamento";
  return (
    <article aria-label={`Pagamento ${FORMA[p.forma]} de ${quando(p.criadoEm)}`} style={{ border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className={styles.linha} style={{ alignItems: "center", gap: 8 }}>
        <strong>{cabecalhoDaForma(p)}</strong>
        <span className={styles.etiqueta} style={{ background: p.situacao === "aprovado" ? "var(--scl-ok-fundo)" : undefined }}>
          {NOMES_SITUACAO_PAGAMENTO[p.situacao]}
        </span>
        {alteracao && <span className={styles.etiqueta}>diferença da alteração de {dia(alteracao.criadaEm)}</span>}
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
      {porDevolucao && <Devolucoes p={p} verValores={verValores} editar={editar} hoje={hoje} alteracoes={alteracoes} />}
      {avisos.length > 0 && (
        <ul role="note" className={styles.alerta} style={{ margin: 0, paddingLeft: 28, fontSize: "0.875rem" }}>
          {avisos.map((t) => (
            <li key={t}>{cartao && t === AVISOS_PAGAMENTO.devolucao_falhou ? DEVOLUCAO_FALHOU_CARTAO : t}</li>
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
              pergunta={
                p.cancelada && p.cancelada.estado !== "cancelada_sem_devolucao"
                  ? "Registrar a liberação deste pagamento com a data e o líquido informados? A reserva foi cancelada com devolução integral: nada entra no financeiro; a taxa do Mercado Pago (valor − líquido) fica no pagamento e a devolução que esperava a liberação é pedida em seguida."
                  : "Registrar a liberação deste pagamento com a data e o líquido informados? O recebimento entra na reserva (libera a parte do proprietário para repasse) e a taxa do Mercado Pago (valor − líquido) é gravada."
              }
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
                Motivo do estorno (sem dados pessoais)
                <input name="motivo" required maxLength={200} placeholder="ex.: valor digitado errado" />
              </label>
            </FormAcaoPagamento>
          )}
          {a.devolver &&
            (doCancelamento ? (
              <FormAcaoPagamento
                acao={devolverAcao}
                pagamentoId={p.id}
                rotulo="Pedir a devolução de novo"
                nome="Pedir a devolução de novo"
                pergunta={`Pedir de novo ao Mercado Pago a devolução integral${valorTexto}? Confira antes no painel do Mercado Pago que a anterior não saiu.`}
              />
            ) : restante ? (
              <FormAcaoPagamento
                acao={devolverAcao}
                pagamentoId={p.id}
                rotulo="Devolver o restante ao hóspede"
                nome="Devolver o restante ao hóspede"
                pergunta={
                  restanteNaPergunta
                    ? `Devolver ao hóspede o restante pelo Mercado Pago: {restante}, que é ${baseDoRestante(restanteNaPergunta.de, pago)} menos os {valor} que o painel do Mercado Pago mostra devolvidos? A devolução não pode ser desfeita.`
                    : `Devolver ao hóspede o restante${valorTexto} pelo Mercado Pago? A devolução não pode ser desfeita.`
                }
                valorNaPergunta={restanteNaPergunta ? "valorForaInformado" : undefined}
                restanteNaPergunta={restanteNaPergunta}
              >
                <p style={{ flexBasis: "100%", margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
                  {restanteSemValor
                    ? `Devolver o restante ao hóspede: o Mercado Pago mostra parte deste pagamento devolvida, sem dizer quanto. O restante é ${verValores && rest?.semValor ? baseDoRestante(rest.base, pago) : "o pago"} menos o valor que o painel dele mostra devolvido.`
                    : verValores && valorDoRestante !== null
                      ? `Devolver o restante ao hóspede (${formatBRL(valorDoRestante)}): o Mercado Pago já mostra ${formatBRL(pago - valorDoRestante)} devolvidos.`
                      : "Devolver o restante ao hóspede: o Mercado Pago já mostra parte deste pagamento devolvida."}
                </p>
                {restanteSemValor && (
                  <label style={{ flex: "0 1 280px" }}>
                    O Mercado Pago não informou quanto já foi devolvido: informe o valor que aparece no painel dele (R$)
                    <input name="valorForaInformado" inputMode="decimal" required />
                  </label>
                )}
              </FormAcaoPagamento>
            ) : (
              <FormAcaoPagamento
                acao={devolverAcao}
                pagamentoId={p.id}
                rotulo="Devolver pelo Mercado Pago"
                nome="Devolver pelo Mercado Pago"
                pergunta={`Devolver ao hóspede o valor integral${valorTexto} pelo Mercado Pago? A devolução não pode ser desfeita.`}
              />
            ))}
          {a.confirmarDevolucaoVista && (
            <FormAcaoPagamento
              acao={confirmarDevolucaoVistaAcao}
              pagamentoId={p.id}
              rotulo="Confirmar devolução feita no painel do Mercado Pago"
              nome="Confirmar devolução feita no painel do Mercado Pago"
              discreto
              pergunta={`Confirmar que o Mercado Pago devolveu ao hóspede o valor integral${valorTexto} em {data}? Confira no painel do Mercado Pago. ${doCancelamento ? "O financeiro do cancelamento é lançado agora e não se desfaz." : "O pagamento fica encerrado como devolvido pelo Mercado Pago."}`}
              dataNaPergunta="data"
            >
              <p style={{ flexBasis: "100%", margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
                Confirme só se o painel do Mercado Pago mostra a devolução <strong>do valor integral</strong> concluída.
              </p>
              <label style={{ flex: "0 1 180px" }}>
                Data da devolução no Mercado Pago
                <input type="date" name="data" defaultValue={hoje} max={hoje} required />
              </label>
              <label style={{ flex: "1 1 220px" }}>
                Nota (obrigatória, sem dados pessoais)
                <input name="nota" required maxLength={300} placeholder="ex.: painel do Mercado Pago mostra devolução concluída em 12/10" />
              </label>
            </FormAcaoPagamento>
          )}
          {a.registrarRecusaNoPainel && (
            <FormAcaoPagamento
              acao={registrarRecusaNoPainelAcao}
              pagamentoId={p.id}
              rotulo="Registrar que o Mercado Pago recusou a devolução no painel"
              nome="Registrar que o Mercado Pago recusou a devolução no painel"
              discreto
              pergunta="Registrar que o painel do Mercado Pago recusou a devolução? Isso libera a devolução por fora no cartão."
            >
              <label style={{ flex: "0 1 180px" }}>
                Data da recusa
                <input type="date" name="data" defaultValue={hoje} max={hoje} required />
              </label>
              <label style={{ flex: "1 1 220px" }}>
                Nota (obrigatória, sem dados pessoais)
                <input name="nota" required maxLength={300} placeholder="ex.: painel do Mercado Pago não deixou devolver" />
              </label>
            </FormAcaoPagamento>
          )}
          {a.pararDevolucaoPedida && (
            <FormAcaoPagamento
              acao={pararDevolucaoPedidaAcao}
              pagamentoId={p.id}
              rotulo="Parar a devolução pedida"
              nome="Parar a devolução pedida"
              discreto
              pergunta={`Parar o pedido de devolução${valorTexto}? Confira no painel do Mercado Pago que nenhuma devolução saiu: depois disso a devolução por fora fica liberada.`}
            >
              <label style={{ flex: "1 1 220px" }}>
                Nota (o que o painel do Mercado Pago mostra; sem dados pessoais)
                <input name="nota" maxLength={300} placeholder="ex.: painel do Mercado Pago sem nenhuma devolução" />
              </label>
            </FormAcaoPagamento>
          )}
          {a.devolucaoPorFora && (
            <FormAcaoPagamento
              acao={devolucaoPorForaAcao}
              pagamentoId={p.id}
              rotulo="Registrar devolução feita por fora"
              nome="Registrar devolução feita por fora"
              discreto
              pergunta={`Registrar que o dinheiro já voltou ao hóspede por fora do Mercado Pago? Vale só ${restante ? (restanteNaPergunta ? `o restante ({restante}, que é ${baseDoRestante(restanteNaPergunta.de, pago)} menos o que o painel do Mercado Pago mostra devolvido)` : "o restante") : "o valor integral pago"}, e antes o sistema confere no Mercado Pago que a devolução não foi feita por lá. ${doCancelamento ? "A devolução não pode mais ser pedida ao Mercado Pago. O financeiro do cancelamento fica acertado com a data informada." : "O pagamento fica encerrado como devolvido por fora e não pode mais ser devolvido pelo Mercado Pago."}${cartao ? " O hóspede pode também contestar a cobrança no cartão e receber de novo: só registre se a devolução já foi feita e combinada com ele." : ""}`}
              restanteNaPergunta={restanteNaPergunta}
            >
              <label style={{ flex: "0 1 180px" }}>
                Data da devolução
                <input type="date" name="data" defaultValue={hoje} max={hoje} required />
              </label>
              <label style={{ flex: "0 1 160px" }}>
                Valor devolvido (R$)
                <input name="valor" inputMode="decimal" defaultValue={verValores ? (restante ? (valorDoRestante !== null ? centavosParaCampo(valorDoRestante) : "") : centavosParaCampo(pago)) : ""} required />
              </label>
              {restanteSemValor && (
                <label style={{ flex: "0 1 280px" }}>
                  O Mercado Pago não informou quanto já foi devolvido: informe o valor que aparece no painel dele (R$)
                  <input name="valorForaInformado" inputMode="decimal" required />
                </label>
              )}
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
              <label style={{ flex: "0 1 260px" }}>
                Taxa (e juros do parcelamento, se o Mercado Pago tirou da SCL) que não voltou (R$)
                <input name="valor" inputMode="decimal" required placeholder="confira no Mercado Pago" />
              </label>
            </FormAcaoPagamento>
          )}
          {a.corrigirTaxaPerdida && (
            <FormAcaoPagamento
              acao={corrigirTaxaPerdidaAcao}
              pagamentoId={p.id}
              rotulo="Corrigir taxa que não voltou"
              nome="Corrigir taxa que não voltou"
              discreto
              pergunta={`Corrigir a taxa que não voltou para {valor}${verValores && p.devolucao?.taxaPerdida !== null && p.devolucao?.taxaPerdida !== undefined ? ` (hoje: ${formatBRL(p.devolucao.taxaPerdida)})` : ""}? A despesa atual é estornada, com o motivo, e a nova entra no financeiro da empresa.`}
              valorNaPergunta="valor"
            >
              <label style={{ flex: "0 1 220px" }}>
                Taxa certa que não voltou (R$)
                <input name="valor" inputMode="decimal" required placeholder="zero se voltou toda" />
              </label>
              <label style={{ flex: "1 1 220px" }}>
                Motivo da correção (sem dados pessoais)
                <input name="motivo" required maxLength={300} placeholder="ex.: o extrato do Mercado Pago mostrou outra taxa" />
              </label>
            </FormAcaoPagamento>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Ficha da reserva → quadro "Pagamento no site" (M8.2a): cada tentativa com forma, situação em palavras, datas e os
 * identificadores no Mercado Pago (quem lê reservas); valores para quem lê o financeiro — no cartão (M8.2b), também os
 * juros, a verificação do banco e o motivo de uma recusa, com a linha de não informar o motivo ao hóspede; ações para
 * quem edita o financeiro, só as que o pagamento permite, e cada uma que mexe em dinheiro com confirmação. Nunca BIN,
 * últimos dígitos nem titular do cartão (nada disso é guardado). M8.2c: o quadro do cancelamento pela política
 * (`cancelamento`) vem antes das tentativas, e a devolução do cancelamento ganha as ações da equipe (confirmar a vista no
 * painel do Mercado Pago, registrar a recusa de lá, parar, corrigir a taxa). M8.2d: o quadro da alteração (`alteracao`) vem
 * depois do cancelamento; cada pagamento mostra todas as suas devoluções, uma linha cada, com as ações daquela devolução
 * (pedir o restante, o restante por fora, confirmar com o valor visto…); o pagamento da diferença diz de qual alteração é.
 */
export function PagamentoNoSite({ pagamentos, verValores, editar, hoje, cancelamento, alteracao, alteracoes }: Props) {
  if (!pagamentos.length) return null;
  return (
    <section aria-label="Pagamento no site" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Pagamento no site</h2>
      <p style={{ margin: 0, color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>
        Cada tentativa de pagamento (Pix ou cartão) feita pelo hóspede no site. A situação só muda pelo que o Mercado Pago informa; o recebimento desta
        reserva vem da liberação do pagamento (pelo Mercado Pago ou registrada aqui), nunca da lista de recebimentos.
      </p>
      {cancelamento}
      {alteracao}
      {pagamentos.map((p) => (
        <Tentativa key={p.id} p={p} verValores={verValores} editar={editar} hoje={hoje} alteracoes={alteracoes} />
      ))}
    </section>
  );
}
