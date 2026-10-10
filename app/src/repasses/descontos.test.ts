/**
 * M8.2c — o lado do proprietário quando uma reserva é cancelada com devolução integral depois de a parte dele já ter
 * sido repassada: o mês repassado não muda; o desconto (parte negativa) nasce no mês do cancelamento, fica disponível
 * na hora e o próximo repasse, de qualquer tipo, o desconta. O livro do cancelamento é montado por
 * `espelharCancelamento` (testes-cancelamento.ts), igual ao que o cancelamento pela política lança.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import * as schema from "@/db/schema";
import { contratos, imoveis, lancamentos, organizacoes, proprietarioImoveis, proprietarios, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import { lancar, mudarEstado, saldoAcerto } from "@/financeiro/ledger";
import { carregarDashboard } from "@/painel/dashboard";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { rotinaDeRepasses } from "./cron";
import { textoDoEmailDoRepasse } from "./email";
import { avisosDeDescontos, chaveEspelhoDoCancelamento, descontosDoProprietario, lancarDescontoDoProprietario } from "./descontos";
import { partesDoProprietario, resumirPartes } from "./extrato";
import { escolherPeriodicidade } from "./proprietario";
import { recebidoPorReserva } from "./recebimentos";
import { descricaoDoItem, estornarRepasse, fecharMes, gerarAntecipado, itensDoRepasse, marcarRepassePago, obterRepasse, preverRepasses, separarAntecipado, travarDono } from "./repasses";
import { formatBRL } from "@/lib/money";
import { cancelamentoDeTeste, espelharCancelamento, pagamentoDoSiteDeTeste } from "./testes-cancelamento";
import { receberTudo } from "./testes";

let db: Db, close: () => Promise<void>, org: string, a: string, dono: string;

// Booking (a empresa recebe): bruto 1.000, taxa 150, comissão 15% de 850 = 127,50 → parte 722,50.
const reserva = (checkin: string, checkout: string, over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId: a, origem: "booking", estado: "confirmada", checkin, checkout, hospedes: 2, hospedeNome: "Hóspede Fictício", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL",
  valorBruto: 100000, taxaCanal: 15000, valorLiquido: null, codigoCanal: "", observacoes: "", ...over,
});
const criar = async (dados: DadosReserva, receberEm?: string) => {
  const r = await criarReserva(db, org, dados, null);
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  if (receberEm) await receberTudo(db, org, r.reserva.id, receberEm);
  return r.reserva;
};
const partes = (hoje: string) => partesDoProprietario(db, org, dono, new Date(`${hoje}T12:00:00-03:00`));
const saldo = (fim: string) => saldoAcerto(db, org, { proprietarioId: dono, fim });
const id = (r: { ok: boolean } & ({ id: string } | { erro: string })) => {
  if (!r.ok || !("id" in r)) throw new Error("erro" in r ? r.erro : "falhou");
  return r.id;
};

/** A parte de outubro repassada (antecipado de 11/10, pago em 12/10) e a reserva cancelada com devolução integral em novembro. */
async function repassadaECancelada() {
  const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
  const antecipado = id(await gerarAntecipado(db, org, dono, "2026-10-11", null));
  id(await marcarRepassePago(db, org, antecipado, "2026-10-12", "2026-10-12", null));
  const { desconto } = await espelharCancelamento(db, org, { reservaId: r.id, cancelamentoId: randomUUID(), competencia: "2026-11-01", codigo: r.codigo });
  return { r, antecipado, desconto };
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: a }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Quatro" }).returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Exemplo", email: "dona@example.com", chavePix: "dona@example.com" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: a, criadoEm: new Date("2025-01-01T12:00:00Z") });
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
});
afterEach(() => close());

describe("desconto da parte já repassada (M8.2c)", () => {
  it("o mês repassado não muda; o desconto nasce no mês do cancelamento, disponível na hora; a conferência fica resolvida", async () => {
    const { r, desconto } = await repassadaECancelada();
    expect(desconto).toBe(72250);
    // Outubro: os quatro lançamentos do motor continuam como estavam (nenhum estorno), e o acerto de outubro segue zerado.
    const doMotor = await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, r.id), eq(lancamentos.origem, "motor")));
    expect(doMotor).toHaveLength(4);
    expect(doMotor.every((l) => l.competencia === "2026-10-01")).toBe(true);
    expect(await saldo("2026-11-01")).toBe(0);
    // Novembro: os espelhos, com o desconto (parte negativa, prevista, para quem recebeu).
    const espelhos = await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, r.id), eq(lancamentos.origem, "cancelamento")));
    expect(espelhos.map((l) => [l.tipo, l.valor, l.competencia]).sort()).toEqual([
      ["comissao", -12750, "2026-11-01"],
      ["direito_proprietario", -72250, "2026-11-01"],
      ["receita_bruta", -100000, "2026-11-01"],
      ["taxa_canal", 15000, "2026-11-01"],
    ]);
    expect(espelhos.find((l) => l.tipo === "direito_proprietario")).toMatchObject({ efeitoSaldo: -72250, estado: "previsto", proprietarioId: dono });
    expect(await saldo("2026-12-01")).toBe(-72250);
    const [outubro, novembro] = await partes("2026-11-03");
    expect(outubro).toMatchObject({ competencia: "2026-10-01", situacao: "repassado", valor: 72250 });
    expect(novembro).toMatchObject({
      competencia: "2026-11-01",
      situacao: "disponivel",
      valor: -72250,
      motivo: `Desconto da sua parte já repassada da reserva ${r.codigo} (cancelada com devolução integral ao hóspede): sai do próximo repasse.`,
    });
    expect(resumirPartes(await partes("2026-11-03"))).toMatchObject({ disponivel: -72250, repassadoPago: 72250 });
    expect(await descontosDoProprietario(db, org, dono)).toEqual([{ lancamentoId: novembro.lancamentoId, competencia: "2026-11-01", reservaCodigo: r.codigo, valor: 72250, criadoEm: expect.any(Date), situacao: { tipo: "a_descontar" } }]);
    expect(await descontosDoProprietario(db, org, dono, { periodo: { inicio: "2026-10-01", fim: "2026-11-01" } })).toEqual([]);
    // A reserva cancelada não trava o fechamento de nenhum dos meses.
    for (const mes of ["2026-10", "2026-11"]) expect((await preverRepasses(db, org, mes, "2026-12-02", [dono], true))[0].bloqueios.join(" ")).not.toContain("acerto pendente");
  });

  it("antecipado: sem partes que cubram, espera (a rotina segue em silêncio); com outras partes, desconta e vincula o item negativo", async () => {
    const { r } = await repassadaECancelada();
    expect(await gerarAntecipado(db, org, dono, "2026-11-03", null)).toEqual({
      ok: false,
      erro: `As partes disponíveis (R$ 0,00) não cobrem o desconto de R$ 722,50 (reserva ${r.codigo} cancelada com devolução): ficam para o próximo repasse.`,
    });
    await escolherPeriodicidade(db, org, dono, "disponivel", null);
    expect(await rotinaDeRepasses(db, org, null, new Date("2026-11-03T11:00:00Z"))).toMatchObject({ gerados: 0, semDisponivel: 1, falhas: [] });
    // Outra reserva de novembro, já recebida: bruto 2.000, taxa 300 → parte 1.445,00.
    const outra = await criar(reserva("2026-11-01", "2026-11-04", { valorBruto: 200000, taxaCanal: 30000 }), "2026-11-01");
    const rep = id(await gerarAntecipado(db, org, dono, "2026-11-05", null));
    expect(await obterRepasse(db, org, rep)).toMatchObject({ tipo: "antecipado", valor: 72250, saldo: 72250, antecipado: 72250 });
    const itens = await itensDoRepasse(db, org, rep);
    expect(itens.map((i) => [i.reservaId, i.valor, i.parcial, descricaoDoItem(i)]).sort()).toEqual(
      [
        [outra.id, 144500, false, "integral"],
        [r.id, -72250, false, "desconto da parte já repassada (reserva cancelada com devolução ao hóspede)"],
      ].sort(),
    );
    // Um lançamento "repasse" líquido em novembro: o mês fecha zerado.
    const doRepasse = await db.select().from(lancamentos).where(sql`${lancamentos.chaveOrigem} like ${`repasse:${rep}:%`}`);
    expect(doRepasse.map((l) => [l.competencia, l.efeitoSaldo, l.montante])).toEqual([["2026-11-01", -72250, 72250]]);
    expect(await saldo("2026-12-01")).toBe(0);
    const descontado = await descontosDoProprietario(db, org, dono);
    expect(descontado[0].situacao).toEqual({ tipo: "descontado", repasse: rep, data: "2026-11-05" });
    expect((await partes("2026-11-06")).find((p) => p.valor < 0)).toMatchObject({
      situacao: "repassado",
      motivo: `Desconto da sua parte já repassada da reserva ${r.codigo} (cancelada com devolução integral ao hóspede): descontado no repasse de 05/11/2026 (a pagar).`,
    });
    // Estornar esse repasse (o item da parte nunca foi espelhado) é permitido: o desconto volta a ficar a descontar.
    id(await estornarRepasse(db, org, rep, "lançado por engano", "2026-11-06", null));
    expect((await descontosDoProprietario(db, org, dono))[0].situacao).toEqual({ tipo: "a_descontar" });
    expect((await partes("2026-11-06")).find((p) => p.valor < 0)?.situacao).toBe("disponivel");
  });

  it("estornar o repasse que pagou a parte já descontada pelo cancelamento é recusado", async () => {
    const { r, antecipado } = await repassadaECancelada();
    expect(await estornarRepasse(db, org, antecipado, "engano", "2026-11-03", null)).toEqual({
      ok: false,
      erro: `A parte da reserva ${r.codigo} deste repasse já foi descontada pelo cancelamento da reserva (devolução integral ao hóspede): estornar o repasse deixaria o desconto sem o pagamento. Corrija com um ajuste.`,
    });
    expect((await obterRepasse(db, org, antecipado))?.estornadoEm).toBeNull();
  });

  it("fechamento: o desconto da competência entra e desconta; sem partes que cubram, nada a repassar e o proprietário deve", async () => {
    const { r } = await repassadaECancelada();
    const [sem] = await preverRepasses(db, org, "2026-11", "2026-12-02", [dono]);
    expect(sem).toMatchObject({ valor: 0, deve: 72250, bloqueios: [] });
    expect(sem.avisos.join(" ")).toContain(`As partes disponíveis não cobrem o desconto de cancelamento de R$ 722,50 (reservas ${r.codigo}): nada a repassar; o proprietário fica devendo e o desconto passa para o próximo repasse.`);
    expect(await fecharMes(db, org, dono, "2026-11", "2026-12-02", null)).toEqual({ ok: false, erro: "Nada a repassar neste mês." });
    // Com outra parte de novembro disponível, o fechamento vincula as duas e paga a diferença.
    const outra = await criar(reserva("2026-11-10", "2026-11-13", { valorBruto: 200000, taxaCanal: 30000 }), "2026-11-10");
    const [com] = await preverRepasses(db, org, "2026-11", "2026-12-02", [dono]);
    expect(com).toMatchObject({ valor: 72250, deve: 0 });
    expect(com.avisos.join(" ")).toContain(`R$ 722,50 de desconto de cancelamento (reservas ${r.codigo}, canceladas com devolução integral ao hóspede depois do repasse) saem deste repasse.`);
    const rep = id(await fecharMes(db, org, dono, "2026-11", "2026-12-02", null));
    expect((await itensDoRepasse(db, org, rep)).map((i) => [i.reservaId, i.valor]).sort()).toEqual([[outra.id, 144500], [r.id, -72250]].sort());
    expect(await saldo("2026-12-01")).toBe(0);
    expect((await descontosDoProprietario(db, org, dono))[0].situacao).toEqual({ tipo: "descontado", repasse: rep, data: "2026-12-02" });
  });

  it("fechamento de um mês anterior leva o desconto de mês seguinte como antecipado (negativo); os dois meses fecham zerados", async () => {
    const { r } = await repassadaECancelada();
    const outra = await criar(reserva("2026-10-20", "2026-10-23", { valorBruto: 200000, taxaCanal: 30000 }), "2026-10-20");
    const [p] = await preverRepasses(db, org, "2026-10", "2026-11-02", [dono]);
    expect(p).toMatchObject({ saldo: 144500, antecipado: -72250, valor: 72250, bloqueios: [] });
    const rep = id(await fecharMes(db, org, dono, "2026-10", "2026-11-02", null));
    expect((await itensDoRepasse(db, org, rep)).map((i) => [i.reservaId, i.competencia, i.valor]).sort()).toEqual(
      [
        [outra.id, "2026-10-01", 144500],
        [r.id, "2026-11-01", -72250],
      ].sort(),
    );
    const doRepasse = await db.select().from(lancamentos).where(sql`${lancamentos.chaveOrigem} like ${`repasse:${rep}:%`}`);
    expect(doRepasse.map((l) => [l.competencia, l.efeitoSaldo]).sort()).toEqual([["2026-10-31", -144500], ["2026-11-01", 72250]]);
    expect(await saldo("2026-11-01")).toBe(0);
    expect(await saldo("2026-12-01")).toBe(0);
    // O e-mail do fechamento nomeia o desconto (nunca "noites de meses seguintes" negativas).
    const { texto } = textoDoEmailDoRepasse((await obterRepasse(db, org, rep))!, await itensDoRepasse(db, org, rep), "Sua Casa Exemplo");
    expect(texto).toContain("Desconto de reserva cancelada com devolução ao hóspede: − R$ 722,50");
    expect(texto).toContain("desconto da parte já repassada (reserva cancelada com devolução ao hóspede)");
    expect(texto).not.toContain("Noites de meses seguintes já pagas");
  });

  it("fechamento com noites de mês seguinte e um desconto de mês seguinte: o painel e o e-mail mostram os dois, cada um na sua linha (o total gravado fica)", async () => {
    await repassadaECancelada();
    // Estadia de 28/10 a 4/11, recebida: a parte de novembro já está disponível no dia do fechamento de outubro.
    const outra = await criar(reserva("2026-10-28", "2026-11-04", { valorBruto: 200000, taxaCanal: 30000 }), "2026-10-28");
    const [p] = await preverRepasses(db, org, "2026-10", "2026-11-02", [dono]);
    const novembro = (await partes("2026-11-02")).find((x) => x.reservaId === outra.id && x.competencia === "2026-11-01")!;
    expect(p.antecipado).toBe(novembro.valor - 72250);
    expect(p.antecipadoSeparado).toEqual({ noites: novembro.valor, desconto: -72250, estorno: 0 });
    const rep = id(await fecharMes(db, org, dono, "2026-10", "2026-11-02", null));
    const gravado = (await obterRepasse(db, org, rep))!;
    expect(gravado.antecipado).toBe(novembro.valor - 72250);
    const itens = await itensDoRepasse(db, org, rep);
    expect(separarAntecipado(gravado.antecipado, itens, gravado.mes)).toEqual({ noites: novembro.valor, desconto: -72250, estorno: 0 });
    const { texto } = textoDoEmailDoRepasse(gravado, itens, "Sua Casa Exemplo");
    expect(texto).toContain(`Noites de meses seguintes já pagas: ${formatBRL(novembro.valor)}`);
    expect(texto).toContain("Desconto de reserva cancelada com devolução ao hóspede: − R$ 722,50");
  });

  it("cancelada sem devolução (valor retido): a parte segue a regra de uma confirmada, com o motivo próprio antes da entrada original", async () => {
    const r = await criar(reserva("2026-12-10", "2026-12-13"), "2026-11-01");
    await db.update(reservas).set({ estado: "cancelada", valorRetido: 100000 }).where(eq(reservas.id, r.id));
    expect(await aplicarMotor(db, org, r.id, null)).toMatchObject({ criados: 0, estornados: 0, mantidos: 4 });
    expect((await partes("2026-11-03"))[0]).toMatchObject({
      situacao: "a_liberar",
      motivo: "Reserva cancelada sem devolução ao hóspede (política de cancelamento): o valor retido é dividido como uma reserva normal. Libera depois da data de entrada original (10/12/2026), com o dinheiro já com a empresa.",
    });
    expect((await partes("2026-12-11"))[0].situacao).toBe("disponivel");
  });

  it("aviso no Início (financeiro) para o desconto a descontar há mais de 7 dias; some quando descontado", async () => {
    await repassadaECancelada();
    const depois = (dias: number) => new Date(Date.now() + dias * 86_400_000);
    expect(await avisosDeDescontos(db, org, depois(1))).toEqual([]);
    const [aviso] = await avisosDeDescontos(db, org, depois(8));
    expect(aviso).toMatchObject({ nivel: "atencao", link: "/painel/financeiro/repasses", texto: expect.stringMatching(/^Proprietário Dona Exemplo tem R\$ 722,50 de desconto de cancelamento a descontar desde \d{2}\/\d{2}\/\d{4} \(as partes disponíveis não cobriram\)\.$/) });
    const base = { imoveis: [], todos: false, periodo: { inicio: "2026-11-01", fim: "2026-12-01" }, ano: 2026, hoje: "2026-11-10", verFinanceiro: true, agora: depois(8) };
    expect((await carregarDashboard(db, org, { ...base, verPagamentos: true })).alertas).toContainEqual(aviso);
    expect((await carregarDashboard(db, org, { ...base, verPagamentos: false })).alertas).not.toContainEqual(aviso);
    await criar(reserva("2026-11-01", "2026-11-04", { valorBruto: 200000, taxaCanal: 30000 }), "2026-11-01");
    id(await gerarAntecipado(db, org, dono, "2026-11-05", null));
    expect(await avisosDeDescontos(db, org, depois(8))).toEqual([]);
  });

  it("cancelada com o acerto no mês do cancelamento: o motor não recalcula mais (nem com contrato novo)", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13", { origem: "site" }), "2026-10-10");
    id(await marcarRepassePago(db, org, id(await gerarAntecipado(db, org, dono, "2026-10-11", null)), "2026-10-12", "2026-10-12", null));
    const pagamentoId = await pagamentoDoSiteDeTeste(db, org, r);
    const cancelamentoId = await cancelamentoDeTeste(db, org, { reservaId: r.id, pagamentoId, direito: "integral" });
    await espelharCancelamento(db, org, { reservaId: r.id, cancelamentoId, competencia: "2026-11-01", codigo: r.codigo });
    const livro = async () => (await db.select({ id: lancamentos.id }).from(lancamentos)).length;
    const antes = await livro();
    await db.update(contratos).set({ comissaoBp: 2500 }).where(eq(contratos.imovelId, a));
    expect(await aplicarMotor(db, org, r.id, null)).toEqual({ criados: 0, estornados: 0, mantidos: 4, avisos: ["Reserva cancelada com o acerto lançado no mês do cancelamento: o cálculo não muda."] });
    expect(await livro()).toBe(antes);
    const [depois] = await db.select().from(reservas).where(eq(reservas.id, r.id));
    expect(depois).toMatchObject({ divergenciaEm: null, estado: "cancelada" });
    expect(depois.conferenciaResolvidaEm).not.toBeNull();
  });

  it("a parte negativa só nasce com valor positivo, competência no mês corrente (nunca um mês passado) e chave; é idempotente pela chave", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"));
    const d = { chave: chaveEspelhoDoCancelamento(randomUUID(), randomUUID()), proprietarioId: dono, imovelId: a, reservaId: r.id, valor: 1000, competencia: "2026-11-01", descricao: "Desconto fictício" };
    const agora = new Date("2026-11-02T13:00:00Z");
    for (const over of [{ valor: 0 }, { valor: -1 }, { valor: 1.5 }, { competencia: "2026-11-02" }, { chave: " " }]) await expect(lancarDescontoDoProprietario(db, org, { ...d, ...over }, null, agora)).rejects.toThrow();
    // O mês já pode ter sido fechado e enviado (outubro) ou ainda não chegou (dezembro): recusado, nada lançado.
    await expect(lancarDescontoDoProprietario(db, org, { ...d, competencia: "2026-10-01" }, null, agora)).rejects.toThrow("A competência do desconto é o mês corrente (01/11/2026): nunca um mês que já pode ter sido fechado.");
    await expect(lancarDescontoDoProprietario(db, org, { ...d, competencia: "2026-12-01" }, null, agora)).rejects.toThrow("mês corrente");
    // O mês corrente é o de São Paulo: 31/10 às 23h30 em Brasília ainda é outubro (já é 1º/11 em UTC).
    await expect(lancarDescontoDoProprietario(db, org, d, null, new Date("2026-11-01T02:30:00Z"))).rejects.toThrow("(01/10/2026)");
    expect(await db.select().from(lancamentos).where(eq(lancamentos.origem, "cancelamento"))).toEqual([]);
    const l = await lancarDescontoDoProprietario(db, org, d, null, agora);
    expect(l).toMatchObject({ tipo: "direito_proprietario", valor: -1000, efeitoSaldo: -1000, origem: "cancelamento", estado: "previsto", competencia: "2026-11-01" });
    expect((await lancarDescontoDoProprietario(db, org, d, null, agora)).id).toBe(l.id);
  });

  it("o dinheiro que voltou ao hóspede (devolução realizada) sai do recebido; a data do pagamento continua a do recebimento", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    expect((await recebidoPorReserva(db, org, [r.id])).get(r.id)).toEqual({ recebido: 85000, devido: 85000, dataCompleto: "2026-10-10" });
    await lancar(db, org, [{ tipo: "devolucao", descricao: "Devolução fictícia ao hóspede", valor: 0, montante: 85000, competencia: "2026-10-20", dataCaixa: "2026-10-20", estado: "realizado", imovelId: a, reservaId: r.id, origem: "manual" }], null);
    await lancar(db, org, [{ tipo: "devolucao", descricao: "Devolução prevista não conta", valor: 0, montante: 1, competencia: "2026-10-21", estado: "previsto", imovelId: a, reservaId: r.id, origem: "manual" }], null);
    expect((await recebidoPorReserva(db, org, [r.id])).get(r.id)).toEqual({ recebido: 0, devido: 85000, dataCompleto: "2026-10-10" });
    // A parte de outubro (sem repasse) volta a esperar o dinheiro, mas a data em que o hóspede pagou não some.
    const [parte] = await partes("2026-10-25");
    expect(parte).toMatchObject({ situacao: "a_liberar", pagamento: { data: "2026-10-10", fonte: "recebimento" } });
  });

  it("os espelhos do cancelamento (receita e taxa no mês do cancelamento) não mexem no devido: a parte repassada continua paga pelo canal na data dela", async () => {
    const { r } = await repassadaECancelada();
    expect((await recebidoPorReserva(db, org, [r.id])).get(r.id)).toEqual({ recebido: 85000, devido: 85000, dataCompleto: "2026-10-10" });
    const [outubro] = await partes("2026-11-03");
    expect(outubro).toMatchObject({ competencia: "2026-10-01", situacao: "repassado", pagamento: { data: "2026-10-10", fonte: "recebimento" } });
    // Depois da devolução realizada (o lado do caixa), a data continua a mesma.
    await lancar(db, org, [{ tipo: "devolucao", descricao: "Devolução fictícia ao hóspede", valor: 0, montante: 85000, competencia: "2026-11-05", dataCaixa: "2026-11-05", estado: "conciliado", imovelId: a, reservaId: r.id, origem: "sincronizacao" }], null);
    expect((await recebidoPorReserva(db, org, [r.id])).get(r.id)).toEqual({ recebido: 0, devido: 85000, dataCompleto: "2026-10-10" });
    expect((await partes("2026-11-06"))[0].pagamento).toEqual({ data: "2026-10-10", fonte: "recebimento" });
  });

  it("a trava do proprietário é NO KEY UPDATE (fechamento, antecipado e estorno do repasse): lançamento novo dele não espera", async () => {
    const consultas: string[] = [];
    const comLog = drizzle((db as unknown as { $client: PGlite }).$client, { schema, logger: { logQuery: (q) => void consultas.push(q) } }) as unknown as Db;
    await comLog.transaction((tx) => travarDono(tx, org, dono));
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const rep = id(await gerarAntecipado(db, org, dono, "2026-10-11", null));
    id(await estornarRepasse(comLog, org, rep, "teste", "2026-10-12", null));
    const doDono = consultas.filter((q) => /from "proprietarios"/.test(q) && /\bfor (no key )?update\b/i.test(q));
    expect(doDono.length).toBe(2);
    expect(doDono.every((q) => /for no key update/i.test(q))).toBe(true);
    expect(r.id).toBeTruthy();
  });
});

describe("mês que movimentou dinheiro sem a parte ter sido paga ao proprietário (M8.2c): o espelho anula a parte", () => {
  /** Outubro "movimentou" só porque a receita foi dada como realizada; a parte do proprietário nunca saiu. Cancelada em novembro. */
  async function movidaSemRepasse() {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const [receita] = await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, r.id), eq(lancamentos.tipo, "receita_bruta")));
    await mudarEstado(db, org, receita.id, "realizado", null, "2026-10-10");
    const { desconto } = await espelharCancelamento(db, org, { reservaId: r.id, cancelamentoId: randomUUID(), competencia: "2026-11-01", codigo: r.codigo });
    return { r, desconto };
  }

  it("a parte e o estorno ficam disponíveis juntos (mesmo depois da devolução), não são desconto, e nada é cobrado do proprietário", async () => {
    const { r, desconto } = await movidaSemRepasse();
    expect(desconto).toBe(72250);
    const textos = {
      anulada: `Reserva ${r.codigo} cancelada com devolução integral ao hóspede antes de esta parte ser repassada: ela e o estorno no mês do cancelamento se anulam no próximo repasse (nada a receber).`,
      estorno: `Estorno da sua parte da reserva ${r.codigo} (cancelada com devolução integral ao hóspede antes de a parte ser repassada): anula a parte no próximo repasse (nada a descontar).`,
    };
    const confere = async (hoje: string) => {
      const [outubro, novembro] = await partes(hoje);
      expect(outubro).toMatchObject({ competencia: "2026-10-01", valor: 72250, situacao: "disponivel", anulacao: "anulada", motivo: textos.anulada });
      expect(novembro).toMatchObject({ competencia: "2026-11-01", valor: -72250, situacao: "disponivel", anulacao: "estorno", motivo: textos.estorno });
      expect(resumirPartes(await partes(hoje))).toMatchObject({ disponivel: 0, aLiberar: 0 });
    };
    await confere("2026-11-03");
    // Não é desconto: nem na lista, nem no aviso do Início.
    expect(await descontosDoProprietario(db, org, dono)).toEqual([]);
    expect(await avisosDeDescontos(db, org, new Date(Date.now() + 8 * 86_400_000))).toEqual([]);
    // O dinheiro volta ao hóspede (devolução realizada): a parte original não fica "a liberar" sozinha — os dois seguem juntos.
    await lancar(db, org, [{ tipo: "devolucao", descricao: "Devolução fictícia ao hóspede", valor: 0, montante: 85000, competencia: "2026-11-05", dataCaixa: "2026-11-05", estado: "realizado", imovelId: a, reservaId: r.id, origem: "manual" }], null);
    await confere("2026-11-06");
    // Só o par, somando zero: o antecipado não tem o que repassar (e não diz que falta cobrir desconto nenhum).
    expect(await gerarAntecipado(db, org, dono, "2026-11-06", null)).toEqual({ ok: false, erro: "Nada disponível para repassar agora." });
    // O fechamento de outubro leva os dois (a parte da competência e o estorno como antecipado) e fecha zerado: o proprietário não deve nada.
    const [outubro] = await preverRepasses(db, org, "2026-10", "2026-11-06", [dono], true);
    expect(outubro).toMatchObject({ valor: 0, deve: 0, antecipado: -72250, bloqueios: [] });
    // O antecipado negativo é o estorno (que anula a parte do saldo): nem noites de meses seguintes, nem desconto.
    expect(outubro.antecipadoSeparado).toEqual({ noites: 0, desconto: 0, estorno: -72250 });
    expect(outubro.avisos.join(" ")).toContain(`A parte de R$ 722,50 (reservas ${r.codigo}, canceladas com devolução integral ao hóspede antes de a parte ser repassada) e o estorno dela entram juntos neste repasse e se anulam.`);
    expect(outubro.avisos.join(" ")).not.toContain("desconto de cancelamento");
  });

  it("o próximo repasse leva a parte e o estorno juntos (somam zero) com as outras partes; estornar esse repasse devolve os dois juntos", async () => {
    const { r } = await movidaSemRepasse();
    const outra = await criar(reserva("2026-11-01", "2026-11-04", { valorBruto: 200000, taxaCanal: 30000 }), "2026-11-01");
    const rep = id(await gerarAntecipado(db, org, dono, "2026-11-05", null));
    // Paga só a outra reserva: o proprietário nunca perde a parte que não recebeu, nem recebe o que voltou ao hóspede.
    expect(await obterRepasse(db, org, rep)).toMatchObject({ valor: 144500 });
    const itens = await itensDoRepasse(db, org, rep);
    expect(itens.map((i) => [i.reservaId, i.competencia, i.valor, descricaoDoItem(i)]).sort()).toEqual(
      [
        [outra.id, "2026-11-01", 144500, "integral"],
        [r.id, "2026-10-01", 72250, "integral"],
        [r.id, "2026-11-01", -72250, "estorno da parte desta reserva neste repasse (cancelada com devolução ao hóspede antes de a parte ser repassada): as duas se anulam"],
      ].sort(),
    );
    // Cada mês fecha zerado no acerto.
    expect(await saldo("2026-11-01")).toBe(0);
    expect(await saldo("2026-12-01")).toBe(0);
    expect((await partes("2026-11-06")).filter((p) => p.reservaId === r.id).map((p) => [p.situacao, p.motivo])).toEqual([
      ["repassado", "Repasse de 05/11/2026 (a pagar)."],
      ["repassado", `Estorno da sua parte da reserva ${r.codigo} (cancelada com devolução integral ao hóspede antes de a parte ser repassada): anulou a parte no repasse de 05/11/2026 (a pagar).`],
    ]);
    // Pago o repasse (os dois itens passam a realizados), o estorno continua sendo estorno — nunca vira desconto.
    id(await marcarRepassePago(db, org, rep, "2026-11-06", "2026-11-06", null));
    expect((await partes("2026-11-07")).filter((p) => p.reservaId === r.id).map((p) => [p.situacao, p.anulacao, p.motivo])).toEqual([
      ["repassado", "anulada", "Repasse de 05/11/2026 (pago em 06/11/2026)."],
      ["repassado", "estorno", `Estorno da sua parte da reserva ${r.codigo} (cancelada com devolução integral ao hóspede antes de a parte ser repassada): anulou a parte no repasse de 05/11/2026 (pago em 06/11/2026).`],
    ]);
    expect(await descontosDoProprietario(db, org, dono)).toEqual([]);
    // A parte e o espelho que a anula estão no mesmo repasse: estornar é permitido, e os dois voltam juntos a disponíveis.
    id(await estornarRepasse(db, org, rep, "lançado por engano", "2026-11-07", null));
    expect((await partes("2026-11-07")).filter((p) => p.reservaId === r.id).map((p) => [p.situacao, p.anulacao])).toEqual([
      ["disponivel", "anulada"],
      ["disponivel", "estorno"],
    ]);
  });

  it("a parte paga à mão (realizada sem repasse) é paga: o espelho dela é desconto de verdade", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const [parte] = await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, r.id), eq(lancamentos.tipo, "direito_proprietario")));
    await mudarEstado(db, org, parte.id, "realizado", null, "2026-10-12");
    await espelharCancelamento(db, org, { reservaId: r.id, cancelamentoId: randomUUID(), competencia: "2026-11-01", codigo: r.codigo });
    const [, novembro] = await partes("2026-11-03");
    expect(novembro).toMatchObject({ valor: -72250, situacao: "disponivel", motivo: expect.stringContaining("Desconto da sua parte já repassada") });
    expect(novembro.anulacao).toBeUndefined();
    expect(await descontosDoProprietario(db, org, dono)).toHaveLength(1);
  });
});
