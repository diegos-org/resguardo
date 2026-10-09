/**
 * Pagamento no site (M8.2a) — consultas pequenas que o resto do sistema (cotações, reservas, recebimentos,
 * extrato) usa para respeitar um pagamento em andamento. Só lê o banco: sem provedor, sem regra de confirmação.
 */
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { PIX_VALIDADE_MINIMA_MINUTOS } from "./provedor";
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

/** Depois do prazo do Pix, por quanto tempo a página ainda lê a order de um Pix recusado, cancelado ou vencido. */
export const FOLGA_LEITURA_PIX_ENCERRADO_MS = 15 * 60_000;

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
 * pendente), ou recusada, cancelada ou vencida há pouco, com order no provedor, até o prazo do Pix mais a folga: o
 * cancelamento pode cruzar com o pagamento e o provedor pode corrigir uma recusa. A mesma regra decide o que a página
 * lê (`conferirCotacaoParaPagina`) e se ela continua acompanhando (`acompanhar` da vista do hóspede).
 */
export function paginaAindaLe(t: { situacao: SituacaoPagamento; idProvedor: string | null; pixExpiraEm: Date | null; criadoEm: Date }, agora: Date): boolean {
  if (emAndamento(t.situacao)) return true;
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
