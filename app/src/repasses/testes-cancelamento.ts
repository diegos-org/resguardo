/**
 * Apoio aos testes do lado do proprietário no cancelamento pela política (M8.2c). Só testes importam daqui.
 *
 * Monta direto no banco o que o cancelamento pela política deixa no livro (§6.1 do desenho), para testar o motor, a
 * conferência, o extrato, os repasses e o relatório sem depender do fluxo do pagamento: a tentativa de pagamento do site
 * que confirmou a reserva, a linha do cancelamento e, quando a parte de algum mês já tinha movimentado dinheiro, os
 * espelhos no mês do cancelamento (o da parte do proprietário é o desconto) e o estorno dos meses que não movimentaram.
 * O fluxo de verdade (prévia, decisão, devolução) é `pagamentos/cancelamento.ts`, que lança os mesmos lançamentos.
 */
import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { cancelamentosReserva, cotacoes, lancamentos, pagamentos, repasseItens, repasses, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { estornar, lancar } from "@/financeiro/ledger";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { chaveEspelhoDoCancelamento, lancarDescontoDoProprietario, ORIGEM_CANCELAMENTO } from "./descontos";

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
 * cancelada e a conferência dada por resolvida. Devolve o total descontado do proprietário.
 */
export async function espelharCancelamento(db: Db, org: string, d: { reservaId: string; cancelamentoId: string; competencia: string; codigo: string }): Promise<{ desconto: number }> {
  return db.transaction(async (tx) => {
    await travarMotorDaReserva(tx, org, d.reservaId);
    const ativos = await tx
      .select()
      .from(lancamentos)
      .where(and(eq(lancamentos.organizacaoId, org), eq(lancamentos.reservaId, d.reservaId), eq(lancamentos.origem, "motor"), isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`));
    const pagos = ativos.length
      ? await tx
          .select({ lancamentoId: repasseItens.lancamentoId })
          .from(repasseItens)
          .innerJoin(repasses, eq(repasses.id, repasseItens.repasseId))
          .where(and(inArray(repasseItens.lancamentoId, ativos.map((a) => a.id)), isNull(repasseItens.liberadoEm), isNull(repasses.estornadoEm), isNotNull(repasses.dataPagamento)))
      : [];
    const mesDe = (c: string) => c.slice(0, 7);
    const movidos = new Set(ativos.filter((a) => a.estado === "realizado" || a.estado === "conciliado" || pagos.some((p) => p.lancamentoId === a.id)).map((a) => mesDe(a.competencia)));
    let desconto = 0;
    for (const a of ativos) {
      if (!movidos.has(mesDe(a.competencia))) {
        await estornar(tx, org, a.id, "Reserva cancelada com devolução integral ao hóspede", null);
        continue;
      }
      const descricao = `Reserva ${d.codigo} cancelada com devolução integral ao hóspede: espelho de ${mesDe(a.competencia)}`;
      const chave = chaveEspelhoDoCancelamento(d.cancelamentoId, a.id);
      if (a.tipo === "direito_proprietario" && a.proprietarioId && a.imovelId) {
        await lancarDescontoDoProprietario(tx, org, { chave, proprietarioId: a.proprietarioId, imovelId: a.imovelId, reservaId: d.reservaId, valor: a.valor, competencia: d.competencia, descricao }, null);
        desconto += a.valor;
      } else
        await lancar(
          tx,
          org,
          [{ tipo: a.tipo, descricao, valor: -a.valor, efeitoSaldo: -a.efeitoSaldo, montante: a.montante === null ? null : -a.montante, competencia: d.competencia, estado: "previsto", imovelId: a.imovelId, reservaId: d.reservaId, proprietarioId: a.proprietarioId, origem: ORIGEM_CANCELAMENTO, chaveOrigem: chave }],
          null,
        );
    }
    const agora = new Date();
    await tx.update(reservas).set({ estado: "cancelada", canceladaEm: agora, confirmadaEm: null, conferenciaResolvidaEm: movidos.size ? agora : null, valorRetido: null }).where(eq(reservas.id, d.reservaId));
    if (movidos.size) await tx.update(cancelamentosReserva).set({ espelhado: true }).where(eq(cancelamentosReserva.id, d.cancelamentoId));
    return { desconto };
  });
}
