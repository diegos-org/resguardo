/**
 * M8.2d — o cancelamento pela política de uma reserva alterada ou devolvida em parte: uma devolução por pagamento do
 * dinheiro da reserva (o que a confirmou e a diferença), o restante com o valor explícito, o caixa de cada uma (o que
 * entrou menos as saídas de antes), a devolução da alteração que ainda esperava absorvida (substituída), o valor retido, o
 * que recusa (chave em voo, a menor sem o restante, alteração com a diferença em andamento, devolução de fora do sistema)
 * e o que a alteração segurada vira. Exemplos E, F, G e H do desenho. Nada usa rede; o Mercado Pago é o falso.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { alteracoesReserva, auditoria, cancelamentosReserva, devolucoesPagamento, lancamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { cancelarReservaPaga, previaDoCancelamento, TEXTO_ALTERACAO_EM_ANDAMENTO, TEXTO_DEVOLUCAO_A_MENOR, TEXTO_DEVOLUCAO_EM_VOO, TEXTO_FORA_SEM_VALOR } from "./cancelamento";
import { conferirTentativa } from "./conferencia";
import { vistaDaCotacaoParaHospede } from "./consultas";
import { confirmarDevolucaoVistaNoProvedor, devolverPeloProvedor, pedirRestanteDaDevolucao, registrarTaxaPerdida, tentarDevolucao } from "./devolucao";
import { pessimista } from "./falso";
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
