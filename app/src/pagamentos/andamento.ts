/**
 * Pagamento no site (M8.2a) — consultas pequenas que o resto do sistema (cotações, reservas, recebimentos,
 * extrato) usa para respeitar um pagamento em andamento. Só lê o banco: sem provedor, sem regra de confirmação.
 */
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { lancamentos, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { DESAFIO_3DS_MINUTOS, type FormaPagamento, PIX_VALIDADE_MINIMA_MINUTOS, RETENCAO_ORDERS_DIAS } from "./provedor";
import { emAndamento, type SituacaoPagamento } from "./situacoes";

/**
 * Carência: um pedido com Pix em andamento (ou aprovado e ainda sem decisão) não vence até 15 minutos depois do
 * prazo das datas — o aviso do pagamento feito no último minuto ainda pode estar a caminho. Nesse tempo as noites
 * continuam ocupadas.
 */
export const CARENCIA_PAGAMENTO_MINUTOS = 15;
export const CARENCIA_PAGAMENTO_MS = CARENCIA_PAGAMENTO_MINUTOS * 60_000;
/** Freio (como os do M8.1): até 3 Pix por cotação. */
export const MAXIMO_PIX_POR_COTACAO = 3;
/** Folga entre o vencimento do Pix e o prazo das datas (o QR nunca vale mais que as datas). */
export const FOLGA_PRAZO_PIX_MS = 2 * 60_000;
/** A mesma folga, no cartão: o prazo das datas fica 2 minutos depois do fim do desafio do banco. */
export const FOLGA_PRAZO_PAGAMENTO_MS = FOLGA_PRAZO_PIX_MS;

// ---------------------------------------------------------------- cartão (M8.2b): freios (constantes, como os do M8.1)
/** Tentativas de cartão por cotação que chegaram ao provedor (linhas `forma = 'cartao'`), à parte dos 3 Pix. */
export const MAXIMO_CARTAO_POR_COTACAO = 3;
/** Tentativas de cartão por hora na organização que chegaram ao provedor (contadas pelas linhas, nunca pelos cliques). */
export const CARTOES_POR_HORA_NA_ORGANIZACAO = 30;
/**
 * Cartão sem resposta final (criando, incerta, em análise ou processando): por quantos dias corridos desde a criação o
 * mesmo e-mail não segura outras datas. "Até 2 dias úteis" do Mercado Pago passando por um fim de semana ou feriado dá
 * 4 a 5 dias corridos; assim que o Mercado Pago decide, o e-mail fica livre.
 */
export const PRAZO_CARTAO_SEM_RESPOSTA_DIAS = 5;
/** Início: alerta de cartão em análise há mais de um dia (só o alerta; o e-mail segue `PRAZO_CARTAO_SEM_RESPOSTA_DIAS`). */
export const ALERTA_ANALISE_CARTAO_HORAS = 24;
/**
 * Cartão criado sem resposta e sem order achada: só é dado por não criado depois de 24 h e com as duas buscas vazias
 * (Orders e Payments API pela referência). No cartão a cobrança acontece durante a criação: um Pix que talvez não
 * exista não pode ser pago, um cartão pode já ter sido cobrado.
 */
export const DESISTIR_SEM_ORDER_CARTAO_MS = 24 * 3_600_000;

/**
 * Prazo das leituras que se repetem (página, rotina: em andamento, diária, taxa e liberação, devoluções): o provedor só
 * consulta orders de até três meses; com folga, 85 dias desde a criação. Depois disso nada se relê sozinho (a leitura
 * nunca traria nada) e o que faltar fica com aviso para a equipe. Uma regra, um lugar.
 */
export const PRAZO_RELEITURA_DIAS = RETENCAO_ORDERS_DIAS - 5;
/** Tentativas criadas antes deste momento estão fora do prazo de releitura. */
export const inicioDoPrazoDeReleitura = (agora: Date) => new Date(agora.getTime() - PRAZO_RELEITURA_DIAS * 86_400_000);
/**
 * Margem do pedido de devolução (M8.2c): o sistema só pede uma devolução ao Mercado Pago com pelo menos 7 dias de leitura
 * pela frente para conferir que ela saiu — o pagamento com até 78 dias. Mais velho, nenhuma chamada: a equipe devolve pelo
 * painel do Mercado Pago (cartão) ou por fora (Pix) e registra aqui.
 */
export const MARGEM_PEDIDO_DEVOLUCAO_DIAS = 7;
/** Tentativas criadas antes deste momento não têm mais devolução pedida ao Mercado Pago pelo sistema. */
export const inicioDoPrazoDePedirDevolucao = (agora: Date) => new Date(inicioDoPrazoDeReleitura(agora).getTime() + MARGEM_PEDIDO_DEVOLUCAO_DIAS * 86_400_000);

/** Depois do prazo do Pix, por quanto tempo a página ainda lê a order de um Pix recusado, cancelado ou vencido. */
export const FOLGA_LEITURA_PIX_ENCERRADO_MS = 15 * 60_000;
/** A mesma folga para um desafio do cartão cancelado ou vencido (o cancelamento pode cruzar com a verificação concluída). */
export const FOLGA_LEITURA_CARTAO_ENCERRADO_MS = FOLGA_LEITURA_PIX_ENCERRADO_MS;

/** Situações encerradas sem dinheiro que a leitura ainda pode levar a aprovado (ver `transicaoPermitida`). */
const ENCERRADAS_SEM_DINHEIRO: readonly SituacaoPagamento[] = ["recusado", "cancelado", "expirado"];

/**
 * Até quando a página lê um Pix encerrado sem dinheiro: o prazo do Pix (ou, sem ele, o mínimo do provedor desde a
 * criação) mais a folga. Só datas que a leitura não muda: `atualizadoEm` anda a cada leitura e esticaria o prazo.
 */
function fimDaLeituraEncerrada(t: { pixExpiraEm: Date | null; criadoEm: Date }): number {
  return (t.pixExpiraEm?.getTime() ?? t.criadoEm.getTime() + PIX_VALIDADE_MINIMA_MINUTOS * 60_000) + FOLGA_LEITURA_PIX_ENCERRADO_MS;
}

/**
 * A página do hóspede ainda lê esta tentativa (ela ainda pode virar dinheiro)? Em andamento (criando, incerta,
 * pendente) dentro do prazo de releitura, ou encerrada há pouco com order no provedor: o cancelamento pode cruzar com o
 * pagamento e o provedor pode corrigir uma recusa. Pix recusado, cancelado ou vencido: até o prazo do Pix mais a folga.
 * Cartão (M8.2b): recusado é final (uma order `failed` não volta; nada se relê antes de cada tentativa nova); cancelado
 * ou vencido (desafio do banco) até o encerramento (ou, sem ele, os 40 minutos do desafio desde a criação) mais a folga.
 * A mesma regra decide o que a página lê (`conferirCotacaoParaPagina`), o que se relê antes de criar outra tentativa e
 * se a página continua acompanhando (`acompanhar` da vista do hóspede).
 */
export function paginaAindaLe(
  t: { forma: FormaPagamento; situacao: SituacaoPagamento; idProvedor: string | null; pixExpiraEm: Date | null; criadoEm: Date; encerradoEm: Date | null },
  agora: Date,
): boolean {
  // Em andamento, só dentro do prazo de releitura (depois, a order não aparece mais: aviso para a equipe, pela rotina).
  if (emAndamento(t.situacao)) return t.criadoEm.getTime() >= inicioDoPrazoDeReleitura(agora).getTime();
  if (t.forma === "cartao") {
    if ((t.situacao !== "cancelado" && t.situacao !== "expirado") || !t.idProvedor) return false;
    const fim = t.encerradoEm?.getTime() ?? t.criadoEm.getTime() + DESAFIO_3DS_MINUTOS * 60_000;
    return agora.getTime() < fim + FOLGA_LEITURA_CARTAO_ENCERRADO_MS;
  }
  return ENCERRADAS_SEM_DINHEIRO.includes(t.situacao) && !!t.idProvedor && agora.getTime() < fimDaLeituraEncerrada(t);
}

/** Tentativa que segura as datas: em andamento, ou aprovada e ainda sem decisão (nem reserva, nem "sem reserva"). */
export const tentativaSeguraAsDatas = () =>
  or(inArray(pagamentos.situacao, ["criando", "incerta", "pendente"]), and(eq(pagamentos.situacao, "aprovado"), isNull(pagamentos.desfecho), isNull(pagamentos.motivoSemReserva)));

/** O pedido da cotação ainda está na carência (prazo vencido há menos de 15 min, com pagamento que segura as datas)? */
export async function cotacaoEmCarencia(db: Db, cotacaoId: string, holdAte: Date | null, agora: Date): Promise<boolean> {
  if (!holdAte || holdAte.getTime() + CARENCIA_PAGAMENTO_MS <= agora.getTime()) return false;
  const [t] = await db.select({ id: pagamentos.id }).from(pagamentos).where(and(eq(pagamentos.cotacaoId, cotacaoId), tentativaSeguraAsDatas())).limit(1);
  return Boolean(t);
}

export type PagamentoQuePrende = { id: string; forma: "pix" | "cartao"; situacao: SituacaoPagamento; pixExpiraEm: Date | null; desfecho: string | null };

/**
 * O pagamento do site que "prende" a reserva: em andamento (criando, incerta, pendente), o que confirmou a reserva
 * (desfecho `reserva`, em qualquer situação: devolvido ou contestado depois no Mercado Pago continua ligado a ela, e
 * o cancelamento e o acerto disso são do M8.2c) ou com dinheiro ainda sem decisão. Um pagamento já decidido como
 * "sem reserva" não prende (é dinheiro a devolver, não desta reserva). Cancelar, confirmar à mão e registrar
 * recebimento à mão leem daqui (uma regra, um lugar). O em andamento vem primeiro.
 */
export async function pagamentoEmAndamentoOuAprovado(db: Db, reservaId: string): Promise<PagamentoQuePrende | null> {
  if (!uuidValido(reservaId)) return null;
  const linhas = await db
    .select({ id: pagamentos.id, forma: pagamentos.forma, situacao: pagamentos.situacao, pixExpiraEm: pagamentos.pixExpiraEm, desfecho: pagamentos.desfecho, criadoEm: pagamentos.criadoEm })
    .from(pagamentos)
    .where(
      and(
        eq(pagamentos.reservaId, reservaId),
        or(
          inArray(pagamentos.situacao, ["criando", "incerta", "pendente"]),
          eq(pagamentos.desfecho, "reserva"),
          and(inArray(pagamentos.situacao, ["aprovado", "devolvido_parcial", "contestado"]), isNull(pagamentos.desfecho), isNull(pagamentos.motivoSemReserva)),
        ),
      ),
    );
  if (!linhas.length) return null;
  const ordem = (s: SituacaoPagamento) => (s === "criando" || s === "incerta" || s === "pendente" ? 0 : 1);
  const [p] = linhas.sort((a, b) => ordem(a.situacao) - ordem(b.situacao) || b.criadoEm.getTime() - a.criadoEm.getTime());
  return { id: p.id, forma: p.forma, situacao: p.situacao, pixExpiraEm: p.pixExpiraEm, desfecho: p.desfecho };
}

/**
 * Há dinheiro do site nesta reserva sem desfecho e já decidido "sem reserva" (a devolver)? Confirmar o pedido à mão
 * fica recusado enquanto houver: o pagamento não se liga à reserva confirmada depois.
 */
export async function pagamentoSemReservaADevolver(db: Db, reservaId: string): Promise<boolean> {
  if (!uuidValido(reservaId)) return false;
  const [p] = await db
    .select({ id: pagamentos.id })
    .from(pagamentos)
    .where(and(eq(pagamentos.reservaId, reservaId), inArray(pagamentos.situacao, ["aprovado", "devolvido_parcial", "contestado"]), isNull(pagamentos.desfecho), isNotNull(pagamentos.motivoSemReserva)))
    .limit(1);
  return Boolean(p);
}

/**
 * Reservas pagas pelo site (pagamento com desfecho `reserva`): a liberação prevista do Mercado Pago, para os
 * textos do extrato e do fechamento ("o Mercado Pago libera em dd/mm"). null = liberação a confirmar.
 */
export async function liberacoesDoSite(db: Db, organizacaoId: string, reservaIds: readonly string[]): Promise<Map<string, Date | null>> {
  const ids = [...new Set(reservaIds.filter(uuidValido))];
  if (!ids.length) return new Map();
  const linhas = await db
    .select({ reservaId: pagamentos.reservaId, prevista: pagamentos.liberacaoPrevistaEm })
    .from(pagamentos)
    .where(and(eq(pagamentos.organizacaoId, organizacaoId), inArray(pagamentos.reservaId, ids), eq(pagamentos.desfecho, "reserva")));
  return new Map(linhas.map((l) => [l.reservaId, l.prevista]));
}

/**
 * A reserva tem recebimento registrado à mão, em vigor (não estornado)? Então o pagamento do site não se liga a ela:
 * nem se gera o Pix, nem uma aprovação a confirma (a liberação do Mercado Pago lançaria um segundo recebimento e a
 * parte do proprietário ficaria disponível duas vezes). Quem chama já travou a reserva (o recebimento à mão trava a
 * mesma linha antes de conferir o pagamento).
 */
export async function temRecebimentoManual(db: Db, organizacaoId: string, reservaId: string): Promise<boolean> {
  if (!uuidValido(reservaId)) return false;
  const [manual] = await db
    .select({ id: lancamentos.id })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.reservaId, reservaId),
        eq(lancamentos.tipo, "recebimento"),
        eq(lancamentos.origem, "manual"),
        isNull(lancamentos.estornoDe),
        sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
      ),
    )
    .limit(1);
  return Boolean(manual);
}
