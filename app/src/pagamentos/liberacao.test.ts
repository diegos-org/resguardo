import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditoria, devolucoesPagamento, lancamentos, pagamentos, reservas } from "@/db/schema";
import { ERRO_DADOS_PESSOAIS } from "@/lib/dados-pessoais";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { classificarParte, partesDoProprietario } from "@/repasses/extrato";
import { preverRepasses } from "@/repasses/repasses";
import { dinheiroComAEmpresa, estornarRecebimento, recebidoPorReserva, registrarRecebimento } from "@/repasses/recebimentos";
import { aplicarNaTransacao, conferirTentativa } from "./conferencia";
import { lancar } from "@/financeiro/ledger";
import { liberacoesDoSite, temRecebimentoManual } from "./andamento";
import { tentarDevolucao } from "./devolucao";
import { chaveRecebimento, estornarLiberacaoManual, registrarLiberacaoManual, taxaDaReserva } from "./liberacao";
import { lerCotacaoSemTravar } from "./travas";
import { conferirPendentes } from "./rotina";
import { pagamentosDaReserva } from "./consultas";
import { aumentarDeTeste, type Cenario, cancelar, entradaPadrao, liberar, minutos, montarCenario, pagarEConfirmar, pedir, reduzirDeTeste, repassar, TOTAL, usuarioDeTeste } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const recebimentos = (reservaId: string) => db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), eq(lancamentos.tipo, "recebimento"))).orderBy(lancamentos.criadoEm);
// Taxa "fracionada" de propósito: 0,99% de 1.824,00 = 18,0576 → o provedor informa o líquido 1.805,94.
const TAXA = 1806;
const LIQUIDO = TOTAL - TAXA;

async function paga(over: Parameters<Cenario["segurar"]>[0] = {}, financeiro: Parameters<Cenario["provedor"]["aprovar"]>[1] = { liquido: LIQUIDO }) {
  const s = await c.segurar(over);
  const p = await c.pix(s.cotacaoId);
  c.provedor.aprovar(p.idProvedor, financeiro);
  await conferir(p.pagamentoId, minutos(3));
  return { ...s, ...p };
}

describe("taxa, liberação e recebimento do pagamento no site (M8.2a)", () => {
  it("'Conferir agora' de tudo (forçado): lê agora o que a rotina só releria depois (taxa e liberação a cada 6 h, releitura diária); a rotina continua com os intervalos", async () => {
    const x = await paga({}, { liquido: LIQUIDO });
    const leituras = () => c.provedor.chamadas.filter((ch) => ch.metodo === "consultar" && ch.id === x.idProvedor).length;
    // Dois dias depois da aprovação, a rotina relê (6 h da liberação que não chegou)...
    const t = new Date(minutos(3).getTime() + 2 * 86_400_000);
    await conferirPendentes(db, c.org, c.provedor, t);
    const antes = leituras();
    // ...e uma hora depois não relê de novo (intervalo de 6 h)...
    await conferirPendentes(db, c.org, c.provedor, new Date(t.getTime() + 3_600_000));
    expect(leituras()).toBe(antes);
    // ...mas o "Conferir agora" lê.
    expect(await conferirPendentes(db, c.org, c.provedor, new Date(t.getTime() + 3_660_000), { forcar: true })).toMatchObject({ conferidas: 1 });
    expect(leituras()).toBe(antes + 1);
  });

  it("liberação ou taxa que nunca chegam: a rotina relê a cada 6 h só até o prazo do provedor (85 dias); depois para, e fica para a equipe", async () => {
    // Aprovado sem a taxa e sem a liberação (o sinal nunca chega).
    const x = await paga({}, { liquido: null });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ taxa: null, desfecho: "reserva", liberacaoConfirmadaEm: null });
    const leituras = () => c.provedor.chamadas.filter((ch) => ch.metodo === "consultar" && ch.id === x.idProvedor).length;
    const dia = (n: number) => new Date(minutos(3).getTime() + n * 86_400_000);
    const antes = leituras();
    await conferirPendentes(db, c.org, c.provedor, dia(84));
    expect(leituras()).toBe(antes + 1);
    for (const n of [86, 86.5, 120]) await conferirPendentes(db, c.org, c.provedor, dia(n));
    expect(leituras()).toBe(antes + 1);
    // Continua à espera da equipe (registrar a liberação à mão).
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ taxa: null, liberacaoConfirmadaEm: null });
  });

  it("taxa = valor − líquido numa leitura só, em reservas.taxaCanal antes do motor; recebido == devido, ao centavo", async () => {
    const x = await paga();
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ taxa: TAXA, liquido: LIQUIDO });
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: TAXA, valorLiquido: LIQUIDO, recebimento: "empresa" });
    const motor = await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.origem, "motor")));
    // Com a taxa já conhecida na confirmação, o motor roda uma vez só (nada estornado).
    expect(motor.map((l) => [l.tipo, l.valor]).sort()).toEqual([["comissao", 27089], ["direito_proprietario", 153505], ["receita_bruta", TOTAL], ["taxa_canal", -TAXA]].sort());
    const devido = (await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!;
    expect(devido.devido).toBe(LIQUIDO);
    // Liberação explícita → recebimento conciliado = líquido: o dinheiro fica com a empresa, sem centavo de diferença.
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, liberacaoPrevista: new Date("2026-10-02T13:00:00Z") });
    await conferir(x.pagamentoId, new Date("2026-10-02T20:00:00Z"));
    const r = (await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!;
    expect(r).toMatchObject({ recebido: LIQUIDO, devido: LIQUIDO, dataCompleto: "2026-10-02" });
    expect(dinheiroComAEmpresa(r)).toBe(true);
  });

  it("order de outra referência: nada do financeiro dela entra (taxa, líquido, liberação), só o aviso", async () => {
    const x = await paga({}, {});
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "reserva", taxa: null, liquido: null });
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    const outra = { ...order, referencia: "scl-outra" };
    await aplicarNaTransacao(db, c.org, { id: x.pagamentoId, cotacaoId: x.cotacaoId }, { cobranca: outra, financeiro: { taxa: 900, liquido: TOTAL - 900, liberacaoPrevista: new Date("2026-10-02T13:00:00Z"), liberado: true, idPagamento: "999", liberacaoEmParcelas: false, custoParcelasVendedor: null } }, minutos(10));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ taxa: null, liquido: null, liberacaoPrevistaEm: null, liberacaoConfirmadaEm: null, financeiroConsultadoEm: expect.any(Date), avisos: ["referencia_divergente"] });
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: null });
    expect(await recebimentos(x.reservaId)).toEqual([]);
  });

  it("taxa conhecida depois da confirmação: entra na reserva e o motor recalcula; taxa inválida vira aviso", async () => {
    const x = await paga({}, {});
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada", taxaCanal: null });
    c.provedor.atualizarFinanceiro(x.idProvedor, { liquido: LIQUIDO });
    await conferir(x.pagamentoId, minutos(10));
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: TAXA, valorLiquido: LIQUIDO });
    expect((await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!.devido).toBe(LIQUIDO);
    const y = await paga({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" }, { liquido: TOTAL + 1 });
    expect(await c.tentativa(y.pagamentoId)).toMatchObject({ taxa: null, avisos: ["taxa_invalida"] });
  });

  it("liberação só com o sinal explícito: a data prevista (mesmo passada) não lança nada; o sinal lança o recebimento conciliado uma vez, com o caixa no dia em que o sinal foi visto (nunca na data prevista)", async () => {
    const x = await paga({}, { liquido: LIQUIDO, liberado: false, liberacaoPrevista: new Date("2026-10-05T12:00:00Z") });
    expect((await c.tentativa(x.pagamentoId)).liberacaoPrevistaEm?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    await conferir(x.pagamentoId, new Date("2026-10-08T12:00:00Z"));
    expect(await recebimentos(x.reservaId)).toEqual([]);
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: null });
    await conferir(x.pagamentoId, new Date("2026-10-09T12:00:00Z"));
    expect(await recebimentos(x.reservaId)).toEqual([]);
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true });
    await conferir(x.pagamentoId, new Date("2026-10-09T13:00:00Z"));
    await conferir(x.pagamentoId, new Date("2026-10-09T14:00:00Z"));
    const [rec, ...resto] = await recebimentos(x.reservaId);
    expect(resto).toEqual([]);
    // A prevista era 05/10, mas o dinheiro só saiu depois (retenção): o caixa fica em 09/10, o dia em que o sinal veio.
    expect(rec).toMatchObject({ estado: "conciliado", origem: "sincronizacao", montante: LIQUIDO, valor: 0, dataCaixa: "2026-10-09", competencia: "2026-10-09", chaveOrigem: chaveRecebimento(x.pagamentoId) });
    expect((await c.tentativa(x.pagamentoId)).liberacaoPrevistaEm?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ liberacaoOrigem: "provedor" });
    expect((await c.tentativa(x.pagamentoId)).liberacaoConfirmadaEm).not.toBeNull();
  });

  it("liberação registrada à mão: deriva a taxa, recebimento realizado com a chave do pagamento; o provedor com o mesmo líquido concilia (a data da equipe fica), outro líquido vira aviso", async () => {
    const x = await paga({}, {});
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-02", liquido: LIQUIDO }, null, minutos(10))).toMatchObject({ ok: false, erro: expect.stringContaining("futuro") });
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: TOTAL + 1 }, null, minutos(10))).toMatchObject({ ok: false });
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, minutos(10))).toEqual({ ok: true });
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: TAXA, valorLiquido: LIQUIDO });
    const [rec] = await recebimentos(x.reservaId);
    expect(rec).toMatchObject({ estado: "realizado", montante: LIQUIDO, dataCaixa: "2026-10-01", chaveOrigem: chaveRecebimento(x.pagamentoId) });
    expect(dinheiroComAEmpresa((await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!)).toBe(true);
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, minutos(10))).toMatchObject({ ok: false, erro: expect.stringContaining("já está registrada") });
    // O provedor confirma com os mesmos valores: o mesmo lançamento passa a conciliado.
    c.provedor.atualizarFinanceiro(x.idProvedor, { liquido: LIQUIDO, liberado: true, liberacaoPrevista: new Date("2026-10-01T18:00:00Z") });
    await conferir(x.pagamentoId, minutos(600));
    expect((await recebimentos(x.reservaId)).map((l) => l.estado)).toEqual(["conciliado"]);

    // Outro pagamento: a data prevista do provedor é outra, mas o líquido bate → concilia, com a data que a equipe viu.
    const y = await paga({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" }, {});
    await registrarLiberacaoManual(db, c.org, y.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, minutos(10));
    c.provedor.atualizarFinanceiro(y.idProvedor, { liquido: LIQUIDO, liberado: true, liberacaoPrevista: new Date("2026-09-30T18:00:00Z") });
    await conferir(y.pagamentoId, minutos(600));
    expect((await recebimentos(y.reservaId)).map((l) => [l.estado, l.dataCaixa])).toEqual([["conciliado", "2026-10-01"]]);
    expect((await c.tentativa(y.pagamentoId)).avisos).not.toContain("liberacao_divergente");
  });

  it("estorno da liberação manual: só pelo quadro do pagamento; registrar de novo usa a chave seguinte (#2); a do provedor não se estorna", async () => {
    const x = await paga({}, {});
    await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, minutos(10));
    const [rec] = await recebimentos(x.reservaId);
    expect(await estornarRecebimento(db, c.org, rec.id, "data errada", null)).toMatchObject({ ok: false, erro: expect.stringContaining("Pagamento no site") });
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "", null)).toMatchObject({ ok: false });
    // O motivo vai para a descrição do estorno no livro: dado pessoal é recusado, como em toda nota (e a auditoria não o copia).
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "cliente pediu, CPF 123.456.789-09", null)).toEqual({ ok: false, erro: ERRO_DADOS_PESSOAIS });
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "tel (21) 99999-0000", null)).toEqual({ ok: false, erro: ERRO_DADOS_PESSOAIS });
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "data errada", null)).toEqual({ ok: true });
    const [aud] = await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, x.pagamentoId), eq(auditoria.acao, "pagamento.liberacao_estornar")));
    expect(Object.keys(aud.mudancas as object)).not.toContain("motivo");
    expect(dinheiroComAEmpresa((await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!)).toBe(false);
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, minutos(10))).toEqual({ ok: true });
    const chaves = (await db.select({ chave: lancamentos.chaveOrigem }).from(lancamentos).where(like(lancamentos.chaveOrigem, `${chaveRecebimento(x.pagamentoId)}%`))).map((l) => l.chave).sort();
    expect(chaves).toEqual([chaveRecebimento(x.pagamentoId), `${chaveRecebimento(x.pagamentoId)}#2`]);
    expect(dinheiroComAEmpresa((await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!)).toBe(true);
    // Depois de estornada a manual, o sinal do provedor lança a versão seguinte.
    await estornarLiberacaoManual(db, c.org, x.pagamentoId, "de novo", null);
    c.provedor.atualizarFinanceiro(x.idProvedor, { liquido: LIQUIDO, liberado: true, liberacaoPrevista: new Date("2026-10-01T18:00:00Z") });
    await conferir(x.pagamentoId, minutos(600));
    const emVigor = (await recebidos(x.reservaId)).filter((l) => l.estado === "conciliado");
    expect(emVigor.map((l) => l.chaveOrigem)).toEqual([`${chaveRecebimento(x.pagamentoId)}#3`]);
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "não", null)).toMatchObject({ ok: false, erro: expect.stringContaining("confirmada pelo Mercado Pago") });
  });

  it("liberação à mão com o líquido errado e a data certa: o provedor confirma com outro líquido → aviso, nada conciliado, nada apagado", async () => {
    const x = await paga({}, {});
    const ERRADO = LIQUIDO - 10000;
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: ERRADO }, null, minutos(10))).toEqual({ ok: true });
    c.provedor.atualizarFinanceiro(x.idProvedor, { liquido: LIQUIDO, liberado: true, liberacaoPrevista: new Date("2026-10-01T18:00:00Z") });
    await conferir(x.pagamentoId, minutos(600));
    expect((await recebimentos(x.reservaId)).map((l) => [l.estado, l.montante, l.dataCaixa])).toEqual([["realizado", ERRADO, "2026-10-01"]]);
    const t = await c.tentativa(x.pagamentoId);
    expect(t).toMatchObject({ taxa: TOTAL - ERRADO, liquido: ERRADO, liberacaoOrigem: "manual" });
    expect(t.avisos).toEqual(["liberacao_divergente"]);
    // Ler de novo não apaga o aviso (a mesma leitura liga e nunca desliga o que ligou).
    await conferir(x.pagamentoId, minutos(601));
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual(["liberacao_divergente"]);
    // A manual ainda se estorna (não ficou "conciliada").
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "líquido digitado errado", null, minutos(602))).toEqual({ ok: true });
  });

  it("estorno da manual errada: a taxa volta ao que o provedor tinha informado (ou a nada), a reserva e o motor também; o sinal seguinte lança o líquido certo", async () => {
    // Sem taxa do provedor antes: volta a desconhecida.
    const x = await paga({}, {});
    const ERRADO = LIQUIDO - 10000;
    await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: ERRADO }, null, minutos(10));
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: TOTAL - ERRADO, valorLiquido: ERRADO });
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "valor errado", null, minutos(20))).toEqual({ ok: true });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ taxa: null, liquido: null, liberacaoOrigem: null, liberacaoConfirmadaEm: null, financeiroConsultadoEm: null });
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: null, valorLiquido: null });
    const motor = async () => (await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.origem, "motor")))).filter((l) => l.tipo === "taxa_canal" && l.estornoDe === null);
    c.provedor.atualizarFinanceiro(x.idProvedor, { liquido: LIQUIDO, liberado: true, liberacaoPrevista: new Date("2026-10-02T18:00:00Z") });
    await conferir(x.pagamentoId, new Date("2026-10-03T12:00:00Z"));
    expect((await recebidos(x.reservaId)).map((l) => [l.estado, l.montante, l.chaveOrigem])).toEqual([["conciliado", LIQUIDO, `${chaveRecebimento(x.pagamentoId)}#2`]]);
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ taxa: TAXA, liquido: LIQUIDO, liberacaoOrigem: "provedor", avisos: [] });
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: TAXA, valorLiquido: LIQUIDO });
    expect((await motor()).map((l) => l.valor)).toContain(-TAXA);
    expect(dinheiroComAEmpresa((await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!)).toBe(true);

    // Com a taxa já informada pelo provedor antes da manual: o estorno volta a ela.
    const y = await paga({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" }, { liquido: LIQUIDO });
    await registrarLiberacaoManual(db, c.org, y.pagamentoId, { data: "2026-10-01", liquido: ERRADO }, null, minutos(10));
    expect(await c.reserva(y.reservaId)).toMatchObject({ taxaCanal: TOTAL - ERRADO });
    await estornarLiberacaoManual(db, c.org, y.pagamentoId, "valor errado", null, minutos(20));
    expect(await c.tentativa(y.pagamentoId)).toMatchObject({ taxa: TAXA, liquido: LIQUIDO });
    expect(await c.reserva(y.reservaId)).toMatchObject({ taxaCanal: TAXA, valorLiquido: LIQUIDO });
  });

  it("o provedor muda o líquido antes de qualquer recebimento: taxa e motor atualizados primeiro, depois o recebimento com o líquido novo; com recebimento já lançado, aviso sem mexer", async () => {
    const x = await paga({}, { liquido: LIQUIDO });
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: TAXA });
    const NOVO = TOTAL - 2500;
    c.provedor.atualizarFinanceiro(x.idProvedor, { liquido: NOVO, liberado: true, liberacaoPrevista: new Date("2026-10-02T18:00:00Z") });
    await conferir(x.pagamentoId, new Date("2026-10-03T12:00:00Z"));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ taxa: 2500, liquido: NOVO, liberacaoOrigem: "provedor", avisos: [] });
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: 2500, valorLiquido: NOVO });
    expect((await recebidos(x.reservaId)).map((l) => [l.estado, l.montante])).toEqual([["conciliado", NOVO]]);
    expect(dinheiroComAEmpresa((await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!)).toBe(true);
    // Uma leitura depois, com outro líquido: o recebimento conciliado e a taxa ficam; aviso.
    const lida = (liquido: number) => ({ financeiro: { taxa: null, liquido, liberacaoPrevista: new Date("2026-10-02T18:00:00Z"), liberado: true, idPagamento: null, liberacaoEmParcelas: false, custoParcelasVendedor: null } });
    await aplicarNaTransacao(db, c.org, { id: x.pagamentoId, cotacaoId: x.cotacaoId }, lida(TOTAL - 3000), new Date("2026-10-04T12:00:00Z"));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ taxa: 2500, liquido: NOVO });
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual(expect.arrayContaining(["taxa_divergente", "liberacao_divergente"]));
    expect((await recebidos(x.reservaId)).map((l) => [l.estado, l.montante])).toEqual([["conciliado", NOVO]]);
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: 2500 });
    // Voltando a bater, os avisos saem.
    await aplicarNaTransacao(db, c.org, { id: x.pagamentoId, cotacaoId: x.cotacaoId }, lida(NOVO), new Date("2026-10-04T13:00:00Z"));
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual([]);
  });

  it("liberado sem o líquido: aviso, nada lançado; data da liberação à mão antes da criação do pagamento: recusada", async () => {
    const x = await paga({}, {});
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, liberacaoPrevista: new Date("2026-10-02T18:00:00Z") });
    await conferir(x.pagamentoId, new Date("2026-10-03T12:00:00Z"));
    expect(await recebimentos(x.reservaId)).toEqual([]);
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual(["liberacao_sem_valor"]);
    // Pix criado em 1/10 (São Paulo): liberação em 30/9 não existe.
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-09-30", liquido: LIQUIDO }, null, new Date("2026-10-03T12:00:00Z"))).toEqual({ ok: false, erro: "A data da liberação não pode ser antes da criação do pagamento (01/10/2026)." });
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, new Date("2026-10-03T12:00:00Z"))).toEqual({ ok: true });
  });

  it("liberação à mão: o limite de baixo é o dia da criação do Pix, não a hora em que o sistema leu a aprovação (lida depois da meia-noite, a data real do dia anterior vale)", async () => {
    // Pix criado em 1/10 às 12:00 (São Paulo), pago no mesmo dia e só lido em 2/10 às 00:05 (São Paulo).
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    c.provedor.aprovar(p.idProvedor, {});
    await conferir(p.pagamentoId, new Date("2026-10-02T03:05:00Z"));
    expect(await c.tentativa(p.pagamentoId)).toMatchObject({ desfecho: "reserva", aprovadoEm: new Date("2026-10-02T03:05:00Z") });
    const depois = new Date("2026-10-02T15:00:00Z");
    expect(await registrarLiberacaoManual(db, c.org, p.pagamentoId, { data: "2026-09-30", liquido: LIQUIDO }, null, depois)).toEqual({ ok: false, erro: "A data da liberação não pode ser antes da criação do pagamento (01/10/2026)." });
    expect(await registrarLiberacaoManual(db, c.org, p.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, depois)).toEqual({ ok: true });
    expect((await recebimentos(s.reservaId)).map((l) => [l.estado, l.montante, l.dataCaixa])).toEqual([["realizado", LIQUIDO, "2026-10-01"]]);
  });

  it("liberação divergente: estornar e registrar de novo o valor certo apaga o aviso, mesmo sem o sinal de liberado (como nas prévias)", async () => {
    const x = await paga();
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO - 10000 }, null, minutos(10))).toEqual({ ok: true });
    await conferir(x.pagamentoId, minutos(20));
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual(["liberacao_divergente"]);
    // O estorno leva o aviso junto: o recebimento a que ele se referia saiu.
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "digitei errado", null, minutos(30))).toEqual({ ok: true });
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual([]);
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, minutos(40))).toEqual({ ok: true });
    await conferir(x.pagamentoId, minutos(50));
    await conferirPendentes(db, c.org, c.provedor, minutos(60 * 30));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ taxa: TAXA, liquido: LIQUIDO, liberacaoOrigem: "manual", avisos: [] });
    expect((await recebidos(x.reservaId)).map((l) => [l.estado, l.montante])).toEqual([["realizado", LIQUIDO]]);
    // Aviso que ficou de uma leitura antiga: a leitura cujo líquido bate com o registrado à mão o apaga.
    await db.update(pagamentos).set({ avisos: ["liberacao_divergente"] }).where(eq(pagamentos.id, x.pagamentoId));
    await conferir(x.pagamentoId, minutos(60 * 31));
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual([]);
    // O sinal de liberado com o mesmo líquido (e outra data prevista) concilia o registrado à mão, sem aviso.
    c.provedor.atualizarFinanceiro(x.idProvedor, { liquido: LIQUIDO, liberado: true, liberacaoPrevista: new Date("2026-09-30T18:00:00Z") });
    await conferir(x.pagamentoId, minutos(60 * 32));
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual([]);
    expect((await recebidos(x.reservaId)).map((l) => [l.estado, l.montante, l.dataCaixa])).toEqual([["conciliado", LIQUIDO, "2026-10-01"]]);
  });

  it("só o pagamento que confirmou a reserva lança recebimento: o segundo, liberado, fica só na tentativa", async () => {
    const z = await c.segurar();
    const a = await c.pix(z.cotacaoId);
    const extra = await c.provedor.criarPix({ referencia: "scl-extra-lib", chaveIdempotencia: "extra-lib", valor: TOTAL, email: "test@testuser.com", nome: "", validadeMinutos: 30, descricao: "", descricaoFatura: null });
    if (!extra.ok) throw new Error("extra");
    const [segunda] = await db.insert(pagamentos).values({ organizacaoId: c.org, cotacaoId: z.cotacaoId, reservaId: z.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-extra-lib", chaveIdempotencia: "extra-lib", situacao: "pendente", idProvedor: extra.cobranca.idProvedor, valor: TOTAL }).returning();
    c.provedor.aprovar(a.idProvedor, { liquido: LIQUIDO });
    c.provedor.aprovar(extra.cobranca.idProvedor, { liquido: LIQUIDO, liberado: true });
    await conferir(a.pagamentoId, minutos(3));
    await conferir(segunda.id, minutos(4));
    expect(await c.tentativa(segunda.id)).toMatchObject({ motivoSemReserva: "outra_tentativa", liberacaoOrigem: "provedor" });
    expect(await recebimentos(z.reservaId)).toEqual([]);
    expect(await registrarLiberacaoManual(db, c.org, segunda.id, { data: "2026-10-01", liquido: LIQUIDO }, null, minutos(5))).toMatchObject({ ok: false, erro: expect.stringContaining("Só o pagamento que confirmou") });
  });

  it("recebimento à mão é recusado em reserva com Pix em andamento ou paga pelo site; o extrato diz quando o Mercado Pago libera", async () => {
    const s = await c.segurar();
    await c.pix(s.cotacaoId);
    expect(await registrarRecebimento(db, c.org, { reservaId: s.reservaId, data: "2026-10-01", valor: 100, nota: "" }, null, "2026-10-01")).toMatchObject({ ok: false, erro: expect.stringContaining("Pagamento no site") });
    const x = await paga({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" }, { liquido: LIQUIDO, liberado: false, liberacaoPrevista: new Date("2026-11-06T12:00:00Z") });
    expect(await registrarRecebimento(db, c.org, { reservaId: x.reservaId, data: "2026-10-01", valor: 100, nota: "" }, null, "2026-10-01")).toMatchObject({ ok: false });
    const depois = await partesDoProprietario(db, c.org, c.dono, new Date("2026-11-05T15:00:00Z"));
    const parte = depois.find((p) => p.reservaId === x.reservaId)!;
    expect(parte).toMatchObject({ situacao: "a_liberar", motivo: expect.stringContaining("o Mercado Pago libera em 06/11/2026") });
    // Sem data prevista: "liberação a confirmar".
    expect(classificarParte({ ...parte, liberacaoSite: { prevista: null } }).motivo).toContain("liberação do Mercado Pago a confirmar");
    const [r] = await db.select({ estado: reservas.estado }).from(reservas).where(eq(reservas.id, x.reservaId));
    expect(r.estado).toBe("confirmada");
  });

  it("fechamento do mês: a reserva paga pelo site que ainda não liberou fica fora, com 'o Mercado Pago libera em dd/mm' (nada de registrar à mão)", async () => {
    const x = await paga({}, { liquido: LIQUIDO, liberado: false, liberacaoPrevista: new Date("2026-11-06T12:00:00Z") });
    const [prev] = await preverRepasses(db, c.org, "2026-10", "2026-11-01", [c.dono]);
    const aviso = prev.avisos.find((a) => a.includes("ficam fora deste repasse"))!;
    expect(aviso).toContain(`${(await c.reserva(x.reservaId)).codigo}, o Mercado Pago libera em 06/11/2026`);
    expect(aviso).not.toContain("Registre o recebimento");
  });
});

const recebidos = (reservaId: string) =>
  db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), eq(lancamentos.tipo, "recebimento"), like(lancamentos.chaveOrigem, "mercadopago:%"))).then(async (ls) => {
    const estornados = new Set((await db.select({ de: lancamentos.estornoDe }).from(lancamentos)).map((l) => l.de));
    return ls.filter((l) => !estornados.has(l.id));
  });

describe("liberação à mão e o cancelamento pela política (M8.2c)", () => {
  const longe = { entrada: "2026-11-20", saida: "2026-11-23" };

  it("cancelada com valor retido: a liberação à mão vale (o dinheiro ficou com a empresa); com devolução integral, recusada", async () => {
    const equipe = await usuarioDeTeste(c);
    const retida = await pagarEConfirmar(c);
    const quando = new Date("2026-10-10T11:00:00-03:00");
    await cancelar(c, retida.reservaId, entradaPadrao({ recebidoEm: new Date("2026-10-10T10:00:00-03:00"), canal: "email" }), equipe, quando);
    expect((await c.reserva(retida.reservaId)).valorRetido).toBe(TOTAL);
    expect(await registrarLiberacaoManual(db, c.org, retida.pagamentoId, { data: "2026-10-10", liquido: TOTAL - 1824 }, equipe, quando)).toEqual({ ok: true });
    expect(await recebimentos(retida.reservaId)).toMatchObject([{ montante: TOTAL - 1824 }]);

    const integral = await pagarEConfirmar(c, { ...longe, email: "outro@example.com" });
    c.provedor.respostaDevolucao = "pedida";
    await cancelar(c, integral.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(60));
    expect(await registrarLiberacaoManual(db, c.org, integral.pagamentoId, { data: "2026-10-01", liquido: TOTAL - 1824 }, equipe, minutos(70))).toEqual({
      ok: false,
      erro: "A reserva não está confirmada nem cancelada com valor retido: o dinheiro deste pagamento volta ao hóspede.",
    });
    expect(await recebimentos(integral.reservaId)).toEqual([]);
  });

  it("liberação à mão já espelhada pela saída da devolução ao hóspede: o estorno é recusado (corrige-se com um ajuste)", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    const { resultado } = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true, devolucao: "confirmada" });
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "Lançada por engano", equipe, minutos(70))).toEqual({ ok: false, erro: "A devolução ao hóspede já espelhou esta liberação: corrija com um ajuste." });
    expect(await recebimentos(x.reservaId)).toHaveLength(1);
  });

  it("cancelada com devolução integral e espelhada, devolução ainda pedida: o estorno da liberação à mão é recusado; a conferência resolvida e os fechamentos ficam como estavam", async () => {
    const equipe = await usuarioDeTeste(c);
    const sp = (dataHora: string) => new Date(`${dataHora.replace(" ", "T")}:00-03:00`);
    // O provedor informou a taxa de 18,24; a equipe digitou o líquido errado (taxa 20,00) ao registrar a liberação.
    const x = await pagarEConfirmar(c, { financeiro: { taxa: 1824 } });
    await liberar(c, x.pagamentoId, { quando: minutos(10), liquido: TOTAL - 2000 });
    expect(await pedir(c, x.reservaId, equipe, { recebidoEm: sp("2026-10-05 10:00"), quando: sp("2026-10-05 10:00") })).toEqual({ ok: true });
    await repassar(c, "antecipado", { hoje: "2026-10-13" });
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    const { resultado } = await cancelar(c, x.reservaId, entradaPadrao(), equipe, sp("2026-11-02 10:00"));
    expect(resultado).toMatchObject({ ok: true, direito: "integral", devolucao: "pedida" });
    const antes = await c.reserva(x.reservaId);
    expect(antes.conferenciaResolvidaEm).not.toBeNull();
    expect((await pagamentosDaReserva(db, c.org, x.reservaId, sp("2026-11-02 11:00")))[0].acoes.estornarLiberacao).toBe(false);
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "valor errado", equipe, sp("2026-11-02 11:00"))).toEqual({
      ok: false,
      erro: "A reserva foi cancelada com devolução integral ao hóspede: a liberação não se estorna mais (não poderia ser registrada de novo). Corrija com um ajuste.",
    });
    const depois = await c.reserva(x.reservaId);
    expect([depois.conferenciaResolvidaEm, depois.taxaCanal]).toEqual([antes.conferenciaResolvidaEm, antes.taxaCanal]);
    expect(await recebimentos(x.reservaId)).toHaveLength(1);
    for (const mes of ["2026-10", "2026-11"]) expect((await preverRepasses(db, c.org, mes, "2026-12-02", [c.dono], true))[0].bloqueios.join(" ")).not.toContain("acerto pendente");
  });
});

describe("liberação com vários pagamentos e devoluções de parte (M8.2d)", () => {
  const longe = { entrada: "2026-11-20", saida: "2026-11-23" };

  it("recebimento à mão da equipe: a liberação do Mercado Pago registrada à mão (chave do pagamento) não conta", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    expect((await recebimentos(x.reservaId)).map((l) => l.chaveOrigem)).toEqual([chaveRecebimento(x.pagamentoId)]);
    expect(await temRecebimentoManual(db, c.org, x.reservaId)).toBe(false);
    await lancar(db, c.org, [{ tipo: "recebimento", descricao: "Recebimento fictício à mão", valor: 0, montante: 1000, competencia: "2026-10-01", dataCaixa: "2026-10-01", estado: "realizado", imovelId: c.imovel, reservaId: x.reservaId, origem: "manual" }], null);
    expect(await temRecebimentoManual(db, c.org, x.reservaId)).toBe(true);
  });

  it("a liberação prevista da reserva com dois pagamentos: a mais tardia entre os ainda não recebidos; um sem data, a confirmar; todos recebidos, a do último", async () => {
    const x = await pagarEConfirmar(c, longe);
    const d1 = new Date("2026-10-20T12:00:00Z");
    const d2 = new Date("2026-10-25T12:00:00Z");
    await db.update(pagamentos).set({ liberacaoPrevistaEm: d1 }).where(eq(pagamentos.id, x.pagamentoId));
    const inc = await aumentarDeTeste(c, x, TOTAL + 40000, { quando: minutos(15), liberacaoPrevista: d2 });
    const prevista = async () => (await liberacoesDoSite(db, c.org, [x.reservaId])).get(x.reservaId);
    expect(await prevista()).toEqual(d2);
    await db.update(pagamentos).set({ liberacaoPrevistaEm: null }).where(eq(pagamentos.id, inc.pagamentoId));
    expect(await prevista()).toBeNull();
    await db.update(pagamentos).set({ liberacaoPrevistaEm: d2 }).where(eq(pagamentos.id, inc.pagamentoId));
    await liberar(c, inc.pagamentoId, { quando: minutos(20) });
    expect(await prevista()).toEqual(d1);
    await liberar(c, x.pagamentoId, { quando: minutos(21) });
    expect(await prevista()).toEqual(d2);
  });

  it("a taxa da reserva (uma regra): a soma das taxas conhecidas, menos a atribuída ao principal devolvido; a diferença sem taxa não apaga a conhecida", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const inc = await aumentarDeTeste(c, x, TOTAL + 40000, { quando: minutos(15) });
    expect((await c.reserva(x.reservaId)).taxaCanal).toBe(1824 + 400);
    const red = await reduzirDeTeste(c, { ...x, pagamentoId: x.pagamentoId }, TOTAL + 10000, { quando: minutos(20) });
    expect(await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(25))).toBe("confirmada");
    const t = (await lerCotacaoSemTravar(db, c.org, x.cotacaoId))!;
    expect(taxaDaReserva(t)).toEqual({ taxa: 1824 + 400 - 300, desconhecida: false, conhecida: true });
    expect((await c.reserva(x.reservaId)).taxaCanal).toBe(1824 + 400 - 300);
    await db.update(pagamentos).set({ taxa: null }).where(eq(pagamentos.id, inc.pagamentoId));
    const t2 = (await lerCotacaoSemTravar(db, c.org, x.cotacaoId))!;
    expect(taxaDaReserva(t2)).toEqual({ taxa: 1824 - 300, desconhecida: true, conhecida: true });
  });

  it("liberação à mão de um pagamento devolvido em parte pelas nossas devoluções: vale (e a saída que esperava sai); devolvido em parte por fora do sistema: recusada", async () => {
    const x = await pagarEConfirmar(c, longe);
    const red = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    // Retrato: a nossa devolução confirmada (antes da liberação, sem o caixa) e a order devolvida em parte.
    await db.update(devolucoesPagamento).set({ situacao: "confirmada", tentativas: 1, confirmadaEm: minutos(16), confirmadaPor: "leitura", valorConfirmado: 30000, corpoIntegral: false }).where(eq(devolucoesPagamento.id, red.devolucaoIds[0]));
    await db.update(pagamentos).set({ situacao: "devolvido_parcial", devolvidoLido: 30000 }).where(eq(pagamentos.id, x.pagamentoId));
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: TOTAL - 1824 }, null, minutos(20))).toEqual({ ok: true });
    expect((await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.tipo, "devolucao")))).map((l) => l.montante)).toEqual([29700]);
    // Por fora do sistema (nada nosso explica): recusada.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com" });
    await db.update(pagamentos).set({ situacao: "devolvido_parcial", devolvidoLido: 1000 }).where(eq(pagamentos.id, y.pagamentoId));
    expect(await registrarLiberacaoManual(db, c.org, y.pagamentoId, { data: "2026-10-01", liquido: 1000 }, null, minutos(20))).toMatchObject({ ok: false });
  });

  it("estorno da liberação à mão recusado: com a saída de uma devolução, com uma devolução de parte já pedida ao Mercado Pago, ou realizada à espera do caixa", async () => {
    const motivo = "Lançada por engano";
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const red = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(20));
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, motivo, null, minutos(30))).toMatchObject({ ok: false, erro: expect.stringContaining("espelhou") });

    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com", liberar: true });
    const valorY = (await c.reserva(y.reservaId)).valorBruto!;
    const redY = await reduzirDeTeste(c, y, valorY - 30000, { quando: minutos(15) });
    c.provedor.respostaDevolucao = "pedida";
    await tentarDevolucao(db, c.org, redY.devolucaoIds[0], c.provedor, minutos(20));
    expect(await estornarLiberacaoManual(db, c.org, y.pagamentoId, motivo, null, minutos(30))).toMatchObject({ ok: false, erro: expect.stringContaining("já pedida ao Mercado Pago") });

    const z = await pagarEConfirmar(c, { entrada: "2026-11-05", saida: "2026-11-07", email: "z@example.com", liberar: true });
    const valorZ = (await c.reserva(z.reservaId)).valorBruto!;
    const redZ = await reduzirDeTeste(c, z, valorZ - 30000, { quando: minutos(15) });
    await db.update(devolucoesPagamento).set({ situacao: "por_fora", porForaValor: 30000, porForaData: "2026-10-01" }).where(eq(devolucoesPagamento.id, redZ.devolucaoIds[0]));
    expect(await estornarLiberacaoManual(db, c.org, z.pagamentoId, motivo, null, minutos(30))).toMatchObject({ ok: false, erro: expect.stringContaining("esperando a liberação") });
  });
});
