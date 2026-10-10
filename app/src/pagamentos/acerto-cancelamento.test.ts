/**
 * M8.2d — o caixa de cada devolução (`acertarCaixaDaDevolucao`): idempotente por devolução, a marca do cancelamento quando
 * todas acertaram, a saída que espera o recebimento (`acertarCaixasPendentes`, pela liberação do Mercado Pago ou à mão), a
 * integral de uma diferença nunca liberada (nada entrou, nada sai) e o por fora antes da liberação seguido do cancelamento
 * integral (tudo acertado sem lançar nada; as taxas sob o teto do pagamento). Nada usa rede; o Mercado Pago é o falso.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cancelamentosReserva, devolucoesPagamento, lancamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { acertarCaixaDaDevolucao } from "./acerto-cancelamento";
import { registrarDevolucaoPorFora, registrarTaxaPerdida, tentarDevolucao } from "./devolucao";
import { aumentarDeTeste, type Cenario, cancelar, entradaPadrao, liberar, minutos, montarCenario, pagarEConfirmar, reduzirDeTeste, TOTAL, usuarioDeTeste } from "./testes";
import { devolucoesDoPagamento, travarCotacao } from "./travas";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
});

const longe = { entrada: "2026-11-20", saida: "2026-11-23" };
const empresa = () => entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" });
const devolucao = async (id: string) => (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, id)))[0];
const saidas = async (reservaId: string) =>
  (await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), eq(lancamentos.tipo, "devolucao")))).map((l) => l.montante ?? 0).sort((a, b) => b - a);
const pedidos = () => c.provedor.chamadas.filter((ch) => ch.metodo === "devolver");

describe("o caixa de cada devolução (M8.2d)", () => {
  it("idempotente por devolução: acertar de novo a mesma não lança outra saída", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const { devolucaoIds } = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    await tentarDevolucao(db, c.org, devolucaoIds[0], c.provedor, minutos(20));
    expect(await saidas(x.reservaId)).toEqual([29700]);
    await db.transaction(async (tx) => {
      const t = (await travarCotacao(tx, c.org, x.cotacaoId))!;
      const p = t.tentativas.find((y) => y.id === x.pagamentoId)!;
      const dev = devolucoesDoPagamento(t, p.id)[0];
      expect(await acertarCaixaDaDevolucao(tx, c.org, t, p, dev, { data: "2026-10-02", estado: "conciliado", origem: "sincronizacao" }, minutos(30))).toEqual({ avisos: [] });
    });
    expect(await saidas(x.reservaId)).toEqual([29700]);
  });

  it("a saída de uma devolução realizada antes da liberação espera o recebimento e sai com a liberação lida do Mercado Pago", async () => {
    const x = await pagarEConfirmar(c, longe);
    const { devolucaoIds } = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    expect(await registrarDevolucaoPorFora(db, c.org, { devolucaoId: devolucaoIds[0] }, { data: "2026-10-01", valor: 30000, nota: "Pix da conta da empresa" }, null, c.provedor, minutos(20))).toEqual({
      ok: true,
      situacao: "por_fora",
    });
    expect(await devolucao(devolucaoIds[0])).toMatchObject({ caixaLancadoEm: null });
    expect(await saidas(x.reservaId)).toEqual([]);
    await liberar(c, x.pagamentoId, { manual: false, quando: minutos(40) });
    expect(await saidas(x.reservaId)).toEqual([29700]);
    const [saida] = await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.tipo, "devolucao")));
    // Por fora: o caixa é o que a equipe registrou (realizado), no dia da liberação.
    expect(saida).toMatchObject({ estado: "realizado", origem: "manual" });
    expect((await devolucao(devolucaoIds[0])).caixaLancadoEm).not.toBeNull();
  });

  it("a integral de alteração de uma diferença nunca liberada: nada entrou, nada sai, a devolução fica acertada", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const inc = await aumentarDeTeste(c, x, TOTAL + 40000, { quando: minutos(15) });
    // Uma redução que devolve a diferença inteira, no pagamento dela (intocado: o pedido integral, corpo vazio).
    const red = await reduzirDeTeste(c, { ...x, pagamentoId: inc.pagamentoId }, TOTAL, { quando: minutos(20), devolucoes: [{ pagamentoId: inc.pagamentoId, valor: 40000 }] });
    expect(await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(25))).toBe("confirmada");
    expect(pedidos().at(-1)).toMatchObject({ valor: null });
    expect(await devolucao(red.devolucaoIds[0])).toMatchObject({ situacao: "confirmada", corpoIntegral: true });
    expect((await devolucao(red.devolucaoIds[0])).caixaLancadoEm).not.toBeNull();
    expect(await saidas(x.reservaId)).toEqual([]);
    expect((await c.tentativa(inc.pagamentoId)).situacao).toBe("devolvido");
  });

  it("por fora antes da liberação e depois o cancelamento integral: o restante espera a liberação (registrada só no pagamento) e tudo acerta sem lançar nada; as taxas sob o teto do pagamento", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    const { devolucaoIds } = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    await registrarDevolucaoPorFora(db, c.org, { devolucaoId: devolucaoIds[0] }, { data: "2026-10-01", valor: 30000, nota: "Pix da conta da empresa" }, null, c.provedor, minutos(20));
    expect(await devolucao(devolucaoIds[0])).toMatchObject({ situacao: "por_fora", taxaPerdida: 300 });
    const { resultado } = await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true, direito: "integral", devolucoes: ["pedida"] });
    // A devolução de parte do valor do cancelamento (o restante) espera a liberação (D13); a por fora ficou acertada.
    const doCancelamento = (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId))).find((d) => d.origem === "cancelamento")!;
    expect(doCancelamento).toMatchObject({ situacao: "pedida", valor: TOTAL - 30000, tentativas: 0, ultimoCodigo: "aguardando_liberacao" });
    expect((await devolucao(devolucaoIds[0])).caixaLancadoEm).not.toBeNull();
    expect(pedidos()).toEqual([]);
    // O Mercado Pago libera: a cancelada com devolução integral nunca recebe no livro; a devolução que esperava sai.
    await liberar(c, x.pagamentoId, { manual: false, quando: minutos(80) });
    expect(await tentarDevolucao(db, c.org, doCancelamento.id, c.provedor, minutos(81))).toBe("confirmada");
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0]).toMatchObject({ valor: TOTAL - 30000 });
    expect(await saidas(x.reservaId)).toEqual([]);
    expect(await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.tipo, "recebimento")))).toEqual([]);
    const [canc] = await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId));
    expect(canc.caixaLancadoEm).not.toBeNull();
    // As taxas que não voltaram: a por fora (300, derivada) e a do restante sob o que sobra da taxa do pagamento (1524).
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: doCancelamento.id }, 1525, null, minutos(82))).toMatchObject({ ok: false });
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: doCancelamento.id }, 1524, null, minutos(82))).toEqual({ ok: true });
  });
});
