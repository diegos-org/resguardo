import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lancamentos, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { classificarParte, partesDoProprietario } from "@/repasses/extrato";
import { preverRepasses } from "@/repasses/repasses";
import { dinheiroComAEmpresa, estornarRecebimento, recebidoPorReserva, registrarRecebimento } from "@/repasses/recebimentos";
import { aplicarNaTransacao, conferirTentativa } from "./conferencia";
import { chaveRecebimento, estornarLiberacaoManual, registrarLiberacaoManual } from "./liberacao";
import { type Cenario, minutos, montarCenario, TOTAL } from "./testes";

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

  it("liberação só com o sinal explícito: a data prevista (mesmo passada) não lança nada; o sinal lança o recebimento conciliado uma vez", async () => {
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
    expect(rec).toMatchObject({ estado: "conciliado", origem: "sincronizacao", montante: LIQUIDO, valor: 0, dataCaixa: "2026-10-05", competencia: "2026-10-05", chaveOrigem: chaveRecebimento(x.pagamentoId) });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ liberacaoOrigem: "provedor" });
    expect((await c.tentativa(x.pagamentoId)).liberacaoConfirmadaEm).not.toBeNull();
  });

  it("liberação registrada à mão: deriva a taxa, recebimento realizado com a chave do pagamento; o provedor igual concilia, diferente vira aviso", async () => {
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

    // Outro pagamento: manual com data diferente da que o provedor informa → aviso, nada muda.
    const y = await paga({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" }, {});
    await registrarLiberacaoManual(db, c.org, y.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, minutos(10));
    c.provedor.atualizarFinanceiro(y.idProvedor, { liquido: LIQUIDO, liberado: true, liberacaoPrevista: new Date("2026-09-30T18:00:00Z") });
    await conferir(y.pagamentoId, minutos(600));
    expect((await recebimentos(y.reservaId)).map((l) => [l.estado, l.dataCaixa])).toEqual([["realizado", "2026-10-01"]]);
    expect((await c.tentativa(y.pagamentoId)).avisos).toContain("liberacao_divergente");
  });

  it("estorno da liberação manual: só pelo quadro do pagamento; registrar de novo usa a chave seguinte (#2); a do provedor não se estorna", async () => {
    const x = await paga({}, {});
    await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, minutos(10));
    const [rec] = await recebimentos(x.reservaId);
    expect(await estornarRecebimento(db, c.org, rec.id, "data errada", null)).toMatchObject({ ok: false, erro: expect.stringContaining("Pagamento no site") });
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "", null)).toMatchObject({ ok: false });
    expect(await estornarLiberacaoManual(db, c.org, x.pagamentoId, "data errada", null)).toEqual({ ok: true });
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
    const lida = (liquido: number) => ({ financeiro: { taxa: null, liquido, liberacaoPrevista: new Date("2026-10-02T18:00:00Z"), liberado: true, idPagamento: null } });
    await aplicarNaTransacao(db, c.org, { id: x.pagamentoId, cotacaoId: x.cotacaoId }, lida(TOTAL - 3000), new Date("2026-10-04T12:00:00Z"));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ taxa: 2500, liquido: NOVO });
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual(expect.arrayContaining(["taxa_divergente", "liberacao_divergente"]));
    expect((await recebidos(x.reservaId)).map((l) => [l.estado, l.montante])).toEqual([["conciliado", NOVO]]);
    expect(await c.reserva(x.reservaId)).toMatchObject({ taxaCanal: 2500 });
    // Voltando a bater, os avisos saem.
    await aplicarNaTransacao(db, c.org, { id: x.pagamentoId, cotacaoId: x.cotacaoId }, lida(NOVO), new Date("2026-10-04T13:00:00Z"));
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual([]);
  });

  it("liberado sem o líquido: aviso, nada lançado; data da liberação à mão antes da aprovação: recusada", async () => {
    const x = await paga({}, {});
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, liberacaoPrevista: new Date("2026-10-02T18:00:00Z") });
    await conferir(x.pagamentoId, new Date("2026-10-03T12:00:00Z"));
    expect(await recebimentos(x.reservaId)).toEqual([]);
    expect((await c.tentativa(x.pagamentoId)).avisos).toEqual(["liberacao_sem_valor"]);
    // Aprovado em 1/10 (São Paulo): liberação em 30/9 não existe.
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-09-30", liquido: LIQUIDO }, null, new Date("2026-10-03T12:00:00Z"))).toEqual({ ok: false, erro: "A data da liberação não pode ser antes da aprovação do pagamento (01/10/2026)." });
    expect(await registrarLiberacaoManual(db, c.org, x.pagamentoId, { data: "2026-10-01", liquido: LIQUIDO }, null, new Date("2026-10-03T12:00:00Z"))).toEqual({ ok: true });
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
