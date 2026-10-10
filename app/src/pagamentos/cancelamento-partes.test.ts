/**
 * M8.2d — o cancelamento pela política de uma reserva alterada ou devolvida em parte: uma devolução por pagamento do
 * dinheiro da reserva (o que a confirmou e a diferença), o restante com o valor explícito, o caixa de cada uma (o que
 * entrou menos as saídas de antes), a devolução da alteração que ainda esperava absorvida (substituída), o valor retido, o
 * que recusa (chave em voo, a menor sem o restante, alteração com a diferença em andamento, devolução de fora do sistema)
 * e o que a alteração segurada vira. Exemplos E, F, G e H do desenho. Nada usa rede; o Mercado Pago é o falso.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { alteracoesReserva, auditoria, cancelamentosReserva, devolucoesPagamento, lancamentos, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { cancelarReservaPaga, previaDoCancelamento, TEXTO_ALTERACAO_EM_ANDAMENTO, TEXTO_DEVOLUCAO_A_MENOR, TEXTO_DEVOLUCAO_EM_VOO, TEXTO_FORA_SEM_VALOR } from "./cancelamento";
import { conferirTentativa } from "./conferencia";
import { pagamentosDaReserva, vistaDaCotacaoParaHospede } from "./consultas";
import { confirmarDevolucaoVistaNoProvedor, devolverPeloProvedor, pedirRestanteDaDevolucao, registrarDevolucaoPorFora, registrarTaxaPerdida, tentarDevolucao } from "./devolucao";
import { pessimista } from "./falso";
import { registrarLiberacaoManual } from "./liberacao";
import { TEXTO_CAIXA_COM_DEVOLVIDO_FORA } from "./situacoes";
import { conferirPendentes } from "./rotina";
import {
  alteracaoSeguradaDeTeste,
  aumentarDeTeste,
  type Cenario,
  cancelar,
  entradaPadrao,
  minutos,
  montarCenario,
  pagarEConfirmar,
  reduzirDeTeste,
  semDadosDoHospede,
  TOTAL,
  usuarioDeTeste,
} from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});

const longe = { entrada: "2026-11-20", saida: "2026-11-23" };
const empresa = (over: Parameters<typeof entradaPadrao>[0] = {}) => entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior", ...over });
/** O hóspede pede em 10/10 uma reserva de 12/10: fora do prazo da política (nenhum). */
const PEDIDO_TARDE = new Date("2026-10-10T10:00:00-03:00");
const DECIDIDO_TARDE = new Date("2026-10-10T11:00:00-03:00");
const retida = () => entradaPadrao({ recebidoEm: PEDIDO_TARDE, canal: "email" });
const pedidos = () => c.provedor.chamadas.filter((ch) => ch.metodo === "devolver");
const devolucoesDe = async (pagamentoId: string) => (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, pagamentoId))).sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime());
const devolucao = async (id: string) => (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.id, id)))[0];
const cancelamentoDe = async (reservaId: string) => (await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, reservaId)))[0];
const saidas = async (reservaId: string) =>
  (await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), eq(lancamentos.tipo, "devolucao")))).map((l) => l.montante ?? 0).sort((a, b) => b - a);

describe("cancelamento depois de uma alteração (M8.2d)", () => {
  it("depois de um aumento (exemplo E): uma devolução por pagamento, as duas integrais de pagamento intocado (corpo vazio); o caixa de cada uma é o que entrou dela", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const inc = await aumentarDeTeste(c, x, TOTAL + 40000, { quando: minutos(15) });
    const { previa, resultado } = await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(previa.ok && previa.previa).toMatchObject({
      direito: "integral",
      valorADevolver: TOTAL + 40000,
      pagamentos: [
        { pagamentoId: x.pagamentoId, valor: TOTAL, rota: "pedida", substitui: [], foraReconhecido: 0 },
        { pagamentoId: inc.pagamentoId, valor: 40000, rota: "pedida", substitui: [], foraReconhecido: 0 },
      ],
    });
    expect(resultado).toMatchObject({ ok: true, direito: "integral", devolucoes: ["confirmada", "confirmada"] });
    expect(pedidos().map((p) => p.valor)).toEqual([null, null]);
    const [d1] = await devolucoesDe(x.pagamentoId);
    const [d2] = await devolucoesDe(inc.pagamentoId);
    const canc = await cancelamentoDe(x.reservaId);
    for (const d of [d1, d2]) expect(d).toMatchObject({ origem: "cancelamento", cancelamentoId: canc.id, situacao: "confirmada", corpoIntegral: true });
    // O que entrou do primeiro sai inteiro; o da diferença nunca foi liberado: nada entrou, nada sai.
    expect(await saidas(x.reservaId)).toEqual([TOTAL - 1824]);
    expect(canc.caixaLancadoEm).not.toBeNull();
    for (const d of [d1, d2]) expect(d.caixaLancadoEm).not.toBeNull();
    // A taxa que não voltou: o teto de cada uma é a taxa do pagamento dela.
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: d2.id }, 401, null, minutos(61))).toMatchObject({ ok: false });
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: d2.id }, 400, null, minutos(61))).toEqual({ ok: true });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "cancelada" });
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("depois de uma redução (exemplo F): o restante com o valor explícito; o caixa = o que entrou menos a saída de antes; o teto da taxa = o devolvido menos o que saiu", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const red = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    expect(await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(20))).toBe("confirmada");
    const { previa, resultado } = await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(previa.ok && previa.previa).toMatchObject({ valorADevolver: TOTAL - 30000, pagamentos: [{ pagamentoId: x.pagamentoId, valor: TOTAL - 30000 }] });
    expect(resultado).toMatchObject({ ok: true, devolucoes: ["confirmada"] });
    expect(pedidos().map((p) => p.valor)).toEqual([30000, TOTAL - 30000]);
    // 180576 entrou: 29700 saiu na redução, 150876 agora; a soma é o que entrou.
    expect(await saidas(x.reservaId)).toEqual([150876, 29700]);
    const d = (await devolucoesDe(x.pagamentoId)).find((y) => y.origem === "cancelamento")!;
    expect(d).toMatchObject({ situacao: "confirmada", valor: TOTAL - 30000, corpoIntegral: false });
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: d.id }, 1525, null, minutos(61))).toMatchObject({ ok: false });
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: d.id }, 1524, null, minutos(61))).toEqual({ ok: true });
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("devolvido");
  });

  it("cartão com juros pagos pelo hóspede (exemplo G): a redução devolve o principal; o cancelamento, o principal restante e os juros; o teto da taxa por pagamento é a taxa mais os juros", async () => {
    const x = await pagarEConfirmar(c, { ...longe, cartaoComJuros: 15000, liberar: true });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ valor: TOTAL, valorPago: TOTAL + 15000, taxa: 1824 });
    const red = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    expect(await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(20))).toBe("confirmada");
    expect(await devolucao(red.devolucaoIds[0])).toMatchObject({ taxaAtribuida: 300 });
    const { previa, resultado } = await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(previa.ok && previa.previa).toMatchObject({ valorADevolver: TOTAL + 15000 - 30000 });
    expect(resultado).toMatchObject({ ok: true, devolucoes: ["confirmada"] });
    expect(pedidos().at(-1)).toMatchObject({ valor: TOTAL + 15000 - 30000 });
    expect(await saidas(x.reservaId)).toEqual([150876, 29700]);
    const d = (await devolucoesDe(x.pagamentoId)).find((y) => y.origem === "cancelamento")!;
    // A − X = 167400 − 150876 = 16524 (a taxa 1524 mais os juros 15000); por pagamento: 1824 + 15000 − 300.
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: red.devolucaoIds[0] }, 300, null, minutos(61))).toEqual({ ok: true });
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: d.id }, 16525, null, minutos(61))).toMatchObject({ ok: false });
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: d.id }, 16524, null, minutos(61))).toEqual({ ok: true });
  });

  it("cartão que espera a liberação (exemplo H): a devolução da redução que nunca saiu é substituída; o cancelamento devolve o integral (corpo vazio); nada entrou, nada sai", async () => {
    const x = await pagarEConfirmar(c, { ...longe, forma: "cartao" });
    const red = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    expect(await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(20))).toBe("pedida");
    expect(await devolucao(red.devolucaoIds[0])).toMatchObject({ tentativas: 0, ultimoCodigo: "aguardando_liberacao" });
    const { previa, resultado } = await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(previa.ok && previa.previa.pagamentos).toEqual([{ pagamentoId: x.pagamentoId, forma: "cartao", valor: TOTAL, rota: "pedida", substitui: [red.devolucaoIds[0]], foraReconhecido: 0 }]);
    expect(resultado).toMatchObject({ ok: true, devolucoes: ["confirmada"] });
    expect(await devolucao(red.devolucaoIds[0])).toMatchObject({ situacao: "substituida" });
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0]).toMatchObject({ valor: null });
    const d = (await devolucoesDe(x.pagamentoId)).find((y) => y.origem === "cancelamento")!;
    expect(d).toMatchObject({ situacao: "confirmada", valor: TOTAL, corpoIntegral: true });
    expect(await saidas(x.reservaId)).toEqual([]);
    expect(await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, x.pagamentoId), eq(auditoria.acao, "pagamento.devolucao_substituida")))).toHaveLength(1);
  });

  it("sem devolução pela política depois de uma redução: o valor retido é o que ficou; a devolução da alteração continua dela (a recusada pode ser pedida de novo)", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    const red = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    for (const m of [20, 31, 42]) await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(m));
    expect(await devolucao(red.devolucaoIds[0])).toMatchObject({ situacao: "recusada" });
    c.provedor.respostaDevolucao = "confirmada";
    const { resultado } = await cancelar(c, x.reservaId, retida(), equipe, DECIDIDO_TARDE);
    expect(resultado).toMatchObject({ ok: true, direito: "nenhum" });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "cancelada", valorRetido: TOTAL - 30000 });
    expect(await devolucao(red.devolucaoIds[0])).toMatchObject({ situacao: "recusada", origem: "alteracao" });
    expect(await devolverPeloProvedor(db, c.org, { devolucaoId: red.devolucaoIds[0] }, equipe, c.provedor, new Date("2026-10-10T12:00:00-03:00"))).toEqual({ ok: true, situacao: "confirmada" });
    expect(await saidas(x.reservaId)).toEqual([29700]);
  });
});

describe("o prazo do cancelamento depois de uma alteração (M8.2d)", () => {
  /** A reserva como uma alteração aplicada a deixa: as datas novas na reserva, a cotação com as originais. */
  const mudarDatas = (reservaId: string, checkin: string, checkout: string) => db.update(reservas).set({ checkin, checkout }).where(eq(reservas.id, reservaId));
  const pedidoEm = (iso: string) => entradaPadrao({ recebidoEm: new Date(iso), canal: "email" });

  it("conta da entrada que conta (a menor entre a original e a atual): mudar para depois não estende o prazo; mudar para antes o encurta; a estadia começa pela atual", async () => {
    const pedido = "2026-11-01T12:00:00-03:00";
    const decidido = new Date("2026-11-01T13:00:00-03:00");
    // Original 10/11 (integral até 27/10), mudada para 26/11 (que daria até 12/11). Pedido em 01/11: pela original, sem devolução.
    const x = await pagarEConfirmar(c, { entrada: "2026-11-10", saida: "2026-11-13" });
    await mudarDatas(x.reservaId, "2026-11-26", "2026-11-29");
    const depois = await previaDoCancelamento(db, c.org, x.reservaId, pedidoEm(pedido), c.provedor, decidido);
    if (!depois.ok) throw new Error(depois.erro);
    expect(depois.previa).toMatchObject({ direito: "nenhum", base: "fora_do_prazo", decisao: { integralAte: "2026-10-27" } });

    // Original 20/11 (integral até 06/11), mudada para 14/11 (integral até 31/10). Pedido em 01/11: pela atual (a menor), sem devolução.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", email: "y@example.com" });
    await mudarDatas(y.reservaId, "2026-11-14", "2026-11-17");
    const antes = await previaDoCancelamento(db, c.org, y.reservaId, pedidoEm(pedido), c.provedor, decidido);
    if (!antes.ok) throw new Error(antes.erro);
    expect(antes.previa).toMatchObject({ direito: "nenhum", base: "fora_do_prazo", decisao: { integralAte: "2026-10-31" } });
    // E no meio da estadia nova (exemplo C′): a estadia começou pela entrada atual (14/11, 15:00); não é cancelamento.
    expect(await previaDoCancelamento(db, c.org, y.reservaId, pedidoEm("2026-11-15T10:00:00-03:00"), c.provedor, new Date("2026-11-15T11:00:00-03:00"))).toMatchObject({
      ok: false,
      codigo: "estadia_iniciada",
    });
    // Sem a alteração, o mesmo pedido de 01/11 numa reserva de 20/11 recebe tudo (integral até 06/11).
    const z = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", email: "z@example.com" });
    const semMudar = await previaDoCancelamento(db, c.org, z.reservaId, pedidoEm(pedido), c.provedor, decidido);
    expect(semMudar.ok && semMudar.previa).toMatchObject({ direito: "integral", decisao: { integralAte: "2026-11-06" } });
  });
});

describe("o restante do cancelamento depois de uma redução (M8.2d)", () => {
  it("o restante recusado pelo Mercado Pago depois de uma redução confirmada: a página e o quadro mostram a devolução pedida, depois com a equipe (Pix) — nunca em conferência; feita por fora, devolvida", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const red = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    expect(await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(20))).toBe("confirmada");
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    const { resultado } = await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true, direito: "integral", devolucoes: ["pedida"] });
    const d = (await devolucoesDe(x.pagamentoId)).find((y) => y.origem === "cancelamento")!;
    expect(d).toMatchObject({ situacao: "pedida", falhas: 1, valor: TOTAL - 30000, ultimoCodigo: "saldo_insuficiente" });
    const vista = async (quando: Date) => (await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, quando, { comAutorizacao: true, oferecido: true }))?.estado;
    const noQuadro = async (quando: Date) => (await pagamentosDaReserva(db, c.org, x.reservaId, quando)).find((q) => q.id === x.pagamentoId)?.cancelada?.estado;
    // O pagamento está devolvido em parte pela redução (nossa): nada a conferir.
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("devolvido_parcial");
    expect(await vista(minutos(61))).toBe("cancelada_devolucao_pedida");
    expect(await noQuadro(minutos(61))).toBe("cancelada_devolucao_pedida");
    for (const m of [71, 82]) await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(m));
    expect(await devolucao(d.id)).toMatchObject({ situacao: "recusada", avisos: expect.arrayContaining(["devolucao_falhou"]) });
    // Pix recusado: com a equipe (que devolve por fora).
    expect(await vista(minutos(83))).toBe("cancelada_com_a_equipe");
    expect(await noQuadro(minutos(83))).toBe("cancelada_com_a_equipe");
    c.provedor.respostaDevolucao = "confirmada";
    expect(await registrarDevolucaoPorFora(db, c.org, { devolucaoId: d.id }, { data: "2026-10-01", valor: TOTAL - 30000, nota: "Pix da conta da empresa" }, equipe, c.provedor, minutos(90))).toEqual({
      ok: true,
      situacao: "por_fora",
    });
    const v = await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, minutos(91), { comAutorizacao: true, oferecido: true });
    expect(v).toMatchObject({ estado: "cancelada_devolvida", cancelamento: { valor: TOTAL - 30000, porFora: true } });
    expect(await noQuadro(minutos(91))).toBe("cancelada_devolvida");
  });

  it("o restante que espera a liberação numa reserva cancelada com devolução integral: a liberação à mão destrava (só registrada no pagamento, nada no livro) e a devolução sai", async () => {
    // Não liberado, com R$ 10,00 devolvidos pelo painel do Mercado Pago: o pagamento não está intocado, o restante espera (D13).
    const x = await pagarEConfirmar(c, longe);
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    const { resultado } = await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true, direito: "integral", devolucoes: ["pedida"] });
    const [d] = (await devolucoesDe(x.pagamentoId)).filter((y) => y.origem === "cancelamento");
    expect(d).toMatchObject({ situacao: "pedida", tentativas: 0, valor: TOTAL - 1000, ultimoCodigo: "aguardando_liberacao" });
    expect(pedidos()).toEqual([]);
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(61));
    expect(q.acoes.registrarLiberacao).toBe(true);
    expect(q.devolucoes!.find((y) => y.id === d.id)).toMatchObject({ aguardandoLiberacao: true });
    expect((await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, minutos(61), { comAutorizacao: true, oferecido: true }))?.cancelamento?.aguardandoLiberacao).toEqual({ previstaEm: null });

    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: TOTAL - 1824 }, equipe, minutos(70))).toEqual({ ok: true });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ liberacaoOrigem: "manual", taxa: 1824, liquido: TOTAL - 1824 });
    expect(await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.tipo, "recebimento")))).toEqual([]);
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "cancelada" });
    expect((await devolucao(d.id)).proximaTentativaEm).toEqual(minutos(70));
    expect(await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(71))).toBe("confirmada");
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0]).toMatchObject({ valor: TOTAL - 1000 });
    // Nada entrou no livro, nada sai; o caixa da devolução e o do cancelamento ficam acertados.
    expect(await saidas(x.reservaId)).toEqual([]);
    expect((await devolucao(d.id)).caixaLancadoEm).not.toBeNull();
    expect((await cancelamentoDe(x.reservaId)).caixaLancadoEm).not.toBeNull();
    const [depois] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(72));
    expect(depois.acoes.registrarLiberacao).toBe(false);

    // Sem uma devolução esperando a liberação (a integral de um pagamento intocado sai na hora: aqui, pedida e ainda sem
    // confirmação), a reserva cancelada com devolução integral continua sem liberação à mão.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com" });
    c.provedor.respostaDevolucao = "pedida";
    await cancelar(c, y.reservaId, empresa(), equipe, minutos(80));
    expect((await c.tentativa(y.pagamentoId)).situacao).toBe("aprovado");
    expect(await registrarLiberacaoManual(db, c.org, y.pagamentoId, { data: "2026-10-01", liquido: (await c.tentativa(y.pagamentoId)).valor - 1824 }, equipe, minutos(81))).toMatchObject({
      ok: false,
      erro: expect.stringContaining("volta ao hóspede"),
    });
  });

  it("a liberação lida do Mercado Pago sem o líquido, numa reserva cancelada com devolução integral: a equipe informa o líquido (a taxa) e o restante que esperava sai", async () => {
    const x = await pagarEConfirmar(c, { ...longe, financeiro: { taxa: null } });
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    const [d] = (await devolucoesDe(x.pagamentoId)).filter((y) => y.origem === "cancelamento");
    expect(d).toMatchObject({ situacao: "pedida", tentativas: 0, ultimoCodigo: "aguardando_liberacao" });
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, liberacaoPrevista: minutos(60) });
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, minutos(65), { origem: "rotina", forcar: true });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ liberacaoOrigem: "provedor", taxa: null });
    // Liberado, mas sem a taxa: a devolução de parte do valor continua esperando; a equipe informa o líquido.
    expect(await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(66))).toBe("pedida");
    expect(pedidos()).toEqual([]);
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(67));
    expect(q.acoes.registrarLiberacao).toBe(true);
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: TOTAL - 1824 }, equipe, minutos(68))).toEqual({ ok: true });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ liberacaoOrigem: "provedor", taxa: 1824 });
    expect(await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(69))).toBe("confirmada");
    expect(pedidos()).toMatchObject([{ valor: TOTAL - 1000 }]);
    expect(await saidas(x.reservaId)).toEqual([]);
  });

  it("o restante que completa um pagamento com parte devolvida pelo painel do Mercado Pago leva todo o caixa, com o aviso para conferir a data", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    const { resultado } = await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true, devolucoes: ["confirmada"] });
    // A parte do painel não tem saída própria: o que entrou (o líquido) sai todo nesta devolução.
    expect(await saidas(x.reservaId)).toEqual([TOTAL - 1824]);
    const [d] = await devolucoesDe(x.pagamentoId);
    expect(d.avisos).toContain("devolucao_data_a_conferir");
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(61));
    expect(q.avisos).toContain(TEXTO_CAIXA_COM_DEVOLVIDO_FORA);
  });
});

describe("o que o cancelamento recusa ou resolve antes (M8.2d)", () => {
  it("uma devolução com o pedido já enviado e sem confirmação recusa; a devolvida a menos sem o restante também, até a equipe pedir o restante", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const red = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    c.provedor.respostaDevolucao = "pedida";
    await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(20));
    expect(await previaDoCancelamento(db, c.org, x.reservaId, empresa(), c.provedor, minutos(60))).toEqual({ ok: false, codigo: "em_andamento", erro: TEXTO_DEVOLUCAO_EM_VOO });
    c.provedor.respostaDevolucao = "confirmada";

    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com", liberar: true });
    const valorY = (await c.reserva(y.reservaId)).valorBruto!;
    const redY = await reduzirDeTeste(c, y, valorY - 30000, { quando: minutos(15) });
    c.provedor.devolverAMenos(25000);
    await tentarDevolucao(db, c.org, redY.devolucaoIds[0], c.provedor, minutos(20));
    expect(await previaDoCancelamento(db, c.org, y.reservaId, empresa(), c.provedor, minutos(60))).toEqual({ ok: false, codigo: "devolucao_a_menor", erro: TEXTO_DEVOLUCAO_A_MENOR });
    expect(await pedirRestanteDaDevolucao(db, c.org, redY.devolucaoIds[0], equipe, c.provedor, minutos(61))).toMatchObject({ ok: true, situacao: "confirmada" });
    const p = await previaDoCancelamento(db, c.org, y.reservaId, empresa(), c.provedor, minutos(62));
    expect(p.ok && p.previa).toMatchObject({ valorADevolver: valorY - 30000 });
  });

  it("sem devolução pela política com dinheiro devolvido pelo painel do Mercado Pago fora do sistema: recusado (a equipe decide)", async () => {
    const x = await pagarEConfirmar(c);
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    expect(await previaDoCancelamento(db, c.org, x.reservaId, retida(), c.provedor, DECIDIDO_TARDE)).toMatchObject({
      ok: false,
      codigo: "decisao_obrigatoria",
      erro: expect.stringContaining("R$ 10,00 devolvidos pelo painel"),
    });
  });

  it("parte devolvida pelo painel sem o valor na leitura: recusado sem o valor digitado; com ele, o restante certo e o devolvido fora reconhecido", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    c.provedor.listaNaLeitura = false;
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    expect(await previaDoCancelamento(db, c.org, x.reservaId, empresa(), c.provedor, minutos(60))).toMatchObject({ ok: false, codigo: "devolvido_fora_sem_valor", erro: TEXTO_FORA_SEM_VALOR });
    const com = await previaDoCancelamento(db, c.org, x.reservaId, empresa({ valorForaInformado: 1000 }), c.provedor, minutos(60));
    if (!com.ok) throw new Error(com.erro);
    expect(com.previa).toMatchObject({ valorADevolver: TOTAL - 1000, pagamentos: [{ valor: TOTAL - 1000, foraReconhecido: 1000 }] });
    const r = await cancelarReservaPaga(db, c.org, x.reservaId, empresa({ valorForaInformado: 1000 }), equipe, c.provedor, minutos(60), com.previa.assinatura);
    expect(r).toMatchObject({ ok: true, direito: "integral" });
    expect(pedidos().at(-1)).toMatchObject({ valor: TOTAL - 1000 });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ devolvidoForaReconhecido: 1000, situacao: "devolvido" });
    expect(await devolucoesDe(x.pagamentoId)).toMatchObject([{ situacao: "confirmada", valor: TOTAL - 1000 }]);
  });

  it("alteração segurada: sem o pagamento da diferença, o cancelamento desiste dela; com o Pix da diferença pendente, espera", async () => {
    const x = await pagarEConfirmar(c, longe);
    const a = await alteracaoSeguradaDeTeste(c, x, TOTAL + 20000, { quando: minutos(10) });
    const { resultado } = await cancelar(c, x.reservaId, empresa(), equipe, minutos(20));
    expect(resultado).toMatchObject({ ok: true, direito: "integral" });
    const [alt] = await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.id, a.alteracaoId));
    expect(alt).toMatchObject({ situacao: "desistida", desistidaEm: minutos(20) });
    expect(await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, a.alteracaoId), eq(auditoria.acao, "alteracao.desistir")))).toHaveLength(1);

    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com" });
    await alteracaoSeguradaDeTeste(c, y, TOTAL + 20000, { quando: minutos(10), tentativa: true });
    expect(await previaDoCancelamento(db, c.org, y.reservaId, empresa(), c.provedor, minutos(20))).toEqual({ ok: false, codigo: "ha_alteracao", erro: TEXTO_ALTERACAO_EM_ANDAMENTO });
  });

  it("alteração segurada e o cancelamento sem devolução pela política: desiste dela também (as novas noites não ficam presas até o prazo)", async () => {
    const x = await pagarEConfirmar(c);
    const a = await alteracaoSeguradaDeTeste(c, x, TOTAL + 20000, { quando: minutos(10), holdAte: new Date("2026-10-10T18:00:00-03:00") });
    const { previa, resultado } = await cancelar(c, x.reservaId, retida(), equipe, DECIDIDO_TARDE);
    expect(previa.ok && previa.previa.avisos.join(" ")).toContain("é desfeita pelo cancelamento");
    expect(resultado).toMatchObject({ ok: true, direito: "nenhum" });
    const [alt] = await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.id, a.alteracaoId));
    expect(alt).toMatchObject({ situacao: "desistida", desistidaEm: DECIDIDO_TARDE, desistenciaMotivo: "cancelamento da reserva" });
    expect(await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, a.alteracaoId), eq(auditoria.acao, "alteracao.desistir")))).toHaveLength(1);
  });
});

describe("o hóspede depois do cancelamento de uma reserva alterada (M8.2d)", () => {
  it("duas devoluções: a página mostra a devolução pedida até as duas se realizarem, depois devolvida, com o total", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const inc = await aumentarDeTeste(c, x, TOTAL + 40000, { quando: minutos(15) });
    c.provedor.respostaDevolucao = "pedida";
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    const vista = (quando: Date) => vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, quando, { comAutorizacao: true, oferecido: true });
    expect((await vista(minutos(61)))?.estado).toBe("cancelada_devolucao_pedida");
    c.provedor.confirmarDevolucoes(x.idProvedor);
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, minutos(70), { origem: "rotina", forcar: true });
    expect((await vista(minutos(71)))?.estado).toBe("cancelada_devolucao_pedida");
    expect((await cancelamentoDe(x.reservaId)).caixaLancadoEm).toBeNull();
    c.provedor.confirmarDevolucoes(inc.idProvedor);
    await conferirTentativa(db, c.org, inc.pagamentoId, c.provedor, minutos(80), { origem: "rotina", forcar: true });
    const v = await vista(minutos(81));
    expect(v).toMatchObject({ estado: "cancelada_devolvida", cancelamento: { valor: TOTAL + 40000 } });
    expect((await cancelamentoDe(x.reservaId)).caixaLancadoEm).not.toBeNull();
  });
});

describe("revisão do M8.2d: como o dinheiro volta com pagamentos por meios diferentes", () => {
  it("reserva paga no Pix e diferença no cartão: o cancelamento devolve cada um pelo seu meio, e a página não diz que tudo volta pelo Pix", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const inc = await aumentarDeTeste(c, x, TOTAL + 40000, { quando: minutos(15) });
    await db.update(pagamentos).set({ forma: "cartao" }).where(eq(pagamentos.id, inc.pagamentoId));
    c.provedor.respostaDevolucao = "pedida";
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    const v = await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, minutos(61), { comAutorizacao: true, oferecido: true });
    expect(v).toMatchObject({ estado: "cancelada_devolucao_pedida", cancelamento: { forma: null } });
    // Só o Pix: continua "pix".
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-28", liberar: true });
    await aumentarDeTeste(c, y, TOTAL + 40000, { quando: minutos(65) });
    await cancelar(c, y.reservaId, empresa(), equipe, minutos(70));
    expect((await vistaDaCotacaoParaHospede(db, c.org, y.cotacaoId, minutos(71), { comAutorizacao: true, oferecido: true }))?.cancelamento?.forma).toBe("pix");
  });
});

describe("provedor pessimista: redução e depois o cancelamento (M8.2d)", () => {
  it("sem o id da devolução nem a lista na leitura: cada passo para num estado que a equipe resolve (confirmar o que vê no painel), sem nada pedido em dobro", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const red = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    pessimista(c.provedor);
    expect(await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(20))).toBe("pedida");
    // O cancelamento espera a devolução aceita (a chave em voo).
    expect(await previaDoCancelamento(db, c.org, x.reservaId, empresa(), c.provedor, minutos(25))).toMatchObject({ ok: false, codigo: "em_andamento" });
    for (const m of [31, 42, 53]) await conferirPendentes(db, c.org, c.provedor, minutos(m));
    expect((await devolucao(red.devolucaoIds[0])).avisos).toContain("devolucao_sem_confirmacao");
    expect(await confirmarDevolucaoVistaNoProvedor(db, c.org, { devolucaoId: red.devolucaoIds[0] }, { data: "2026-10-01", nota: "Painel mostra R$ 300,00 devolvidos", valor: 30000 }, equipe, c.provedor, minutos(54))).toEqual({
      ok: true,
      situacao: "confirmada",
    });
    // Agora o cancelamento: o restante, pedido com o valor explícito. Aceito sem o id e lido sem a lista, mas a order fica
    // inteira devolvida e esta é a que faltava: confirmada por completar o pagamento.
    const { resultado } = await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true, direito: "integral", devolucoes: ["confirmada"] });
    expect(pedidos().map((p) => p.valor)).toEqual([30000, TOTAL - 30000]);
    const d = (await devolucoesDe(x.pagamentoId)).find((y) => y.origem === "cancelamento")!;
    expect(d).toMatchObject({ situacao: "confirmada", confirmadaPor: "leitura", idProvedor: null });
    await conferirPendentes(db, c.org, c.provedor, minutos(71));
    expect(pedidos()).toHaveLength(2);
    expect(await saidas(x.reservaId)).toEqual([150876, 29700]);
    expect((await cancelamentoDe(x.reservaId)).caixaLancadoEm).not.toBeNull();
    expect((await c.tentativa(x.pagamentoId)).valorPago).toBe(TOTAL);
  });
});

describe("revisão do M8.2d: a devolução que manda no quadro do pagamento", () => {
  it("é a mais nova pela criação (nunca pela ordem dos ids, que são aleatórios); cada devolução do quadro traz o cancelamento dela (o restante também)", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    c.provedor.devolverAMenos(TOTAL - 5000);
    expect((await cancelar(c, x.reservaId, empresa(), equipe, minutos(60))).resultado).toMatchObject({ ok: true });
    const [d1] = await devolucoesDe(x.pagamentoId);
    expect(d1).toMatchObject({ situacao: "confirmada", valorConfirmado: TOTAL - 5000 });
    expect(await pedirRestanteDaDevolucao(db, c.org, d1.id, equipe, c.provedor, minutos(70))).toMatchObject({ ok: true, situacao: "confirmada" });
    const [, d2] = await devolucoesDe(x.pagamentoId);
    // Os ids são aleatórios: o do restante pode sair antes do da devolução do cancelamento.
    await db.update(devolucoesPagamento).set({ id: "00000000-0000-4000-8000-000000000001" }).where(eq(devolucoesPagamento.id, d2.id));
    const [q] = await pagamentosDaReserva(db, c.org, x.reservaId, minutos(71));
    expect(q.devolucao).toMatchObject({ situacao: "confirmada", valor: 5000 });
    const canc = await cancelamentoDe(x.reservaId);
    expect(q.devolucoes!.filter((d) => d.cancelamentoId === canc.id).map((d) => d.valor).sort((a, b) => b - a)).toEqual([TOTAL, 5000]);
  });
});
