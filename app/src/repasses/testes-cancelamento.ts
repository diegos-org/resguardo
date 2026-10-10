/**
 * Apoio aos testes do lado do proprietário no cancelamento pela política (M8.2c). Só testes importam daqui.
 *
 * Monta direto no banco o que o cancelamento pela política deixa no livro (§6.1 do desenho), para testar o motor, a
 * conferência, o extrato, os repasses e o relatório sem depender do fluxo do pagamento: a tentativa de pagamento do site
 * que confirmou a reserva, a linha do cancelamento e, quando a parte de algum mês já tinha movimentado dinheiro, os
 * espelhos no mês do cancelamento (o da parte do proprietário é o desconto) e o estorno dos meses que não movimentaram.
 * O fluxo de verdade (prévia, decisão, devolução) é `pagamentos/cancelamento.ts`; os espelhos são os mesmos (`espelharMovidos`).
 */
import { eq } from "drizzle-orm";
import { cancelamentosReserva, cotacoes, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { espelharMovidos } from "@/pagamentos/acerto-cancelamento";

/** A tentativa de pagamento do site que confirmou a reserva (cotação e pagamento mínimos, dados fictícios). */
export async function pagamentoDoSiteDeTeste(
  db: Db,
  org: string,
  r: { id: string; imovelId: string; checkin: string; checkout: string; valorBruto: number | null },
  over: Partial<typeof pagamentos.$inferInsert> = {},
): Promise<string> {
  const valor = r.valorBruto ?? 0;
  const codigo = `COT-${r.id.slice(0, 8).toUpperCase()}`;
  const [c] = await db
    .insert(cotacoes)
    .values({ organizacaoId: org, imovelId: r.imovelId, codigo, estado: "convertida", checkin: r.checkin, checkout: r.checkout, hospedes: 2, noites: 1, situacao: "disponivel", diarias: valor, limpeza: 0, hospedeExtra: 0, valorCheio: valor, total: valor, reservaId: r.id })
    .returning({ id: cotacoes.id });
  const [p] = await db
    .insert(pagamentos)
    .values({ organizacaoId: org, cotacaoId: c.id, reservaId: r.id, imovelId: r.imovelId, ambiente: "teste", forma: "pix", referencia: `scl-${c.id}`, chaveIdempotencia: `teste-${c.id}`, situacao: "aprovado", valor, desfecho: "reserva", aprovadoEm: new Date("2026-09-01T12:00:00Z"), ...over })
    .returning({ id: pagamentos.id });
  return p.id;
}

/** A linha do cancelamento decidido (situação `cancelada`), como o cancelamento pela política grava. */
export async function cancelamentoDeTeste(db: Db, org: string, d: { reservaId: string; pagamentoId: string; direito: "integral" | "nenhum"; espelhado?: boolean }): Promise<string> {
  const agora = new Date("2026-11-02T13:00:00Z");
  const [c] = await db
    .insert(cancelamentosReserva)
    .values({ organizacaoId: org, reservaId: d.reservaId, pagamentoId: d.pagamentoId, situacao: "cancelada", pedidoRecebidoEm: agora, quemCancela: "empresa", calculado: d.direito, direito: d.direito, base: d.direito === "integral" ? "empresa" : "fora_do_prazo", canceladaEm: agora, resultadoLancadoEm: agora, espelhado: d.espelhado ?? false })
    .returning({ id: cancelamentosReserva.id });
  return c.id;
}

/**
 * Cancela a reserva com devolução integral depois de a parte de algum mês já ter movimentado dinheiro: cada mês
 * movimentado (parte num repasse pago, ou algum lançamento realizado/conciliado) ganha espelhos na `competencia` (o mês
 * do cancelamento) — o da parte é o desconto do proprietário —, os outros meses são estornados, a reserva fica
 * cancelada e a conferência dada por resolvida. Os espelhos são os do cancelamento de verdade (`espelharMovidos`).
 * Devolve o total da parte espelhada.
 */
export async function espelharCancelamento(db: Db, org: string, d: { reservaId: string; cancelamentoId: string; competencia: string; codigo: string; agora?: Date }): Promise<{ desconto: number }> {
  // O cancelamento acontece no mês da competência dos espelhos (o mês corrente dele): o dia 2, ao meio-dia em São Paulo.
  const quando = d.agora ?? new Date(`${d.competencia.slice(0, 8)}02T12:00:00-03:00`);
  return db.transaction(async (tx) => {
    const m = await espelharMovidos(tx, org, { reservaId: d.reservaId, cancelamentoId: d.cancelamentoId, codigo: d.codigo }, null, quando);
    await tx.update(reservas).set({ estado: "cancelada", canceladaEm: quando, confirmadaEm: null, conferenciaResolvidaEm: m.meses ? quando : null, valorRetido: null }).where(eq(reservas.id, d.reservaId));
    if (m.meses) await tx.update(cancelamentosReserva).set({ espelhado: true }).where(eq(cancelamentosReserva.id, d.cancelamentoId));
    return { desconto: m.parteEspelhada };
  });
}
