/**
 * M8.2d — o lado do proprietário de uma alteração de reserva paga pelo site (desenho §6.3 e §7): depois de um aumento, toda
 * a parte espera a liberação do pagamento da diferença (uma regra de dinheiro por reserva), e o recebido fecha com o devido
 * quando ele entra; numa redução, o recebido fecha com o devido depois da saída da devolução, e a parte nunca volta de
 * disponível para "a liberar"; numa redução retida, o total do proprietário não muda e os meses seguem as noites novas.
 * Dados fictícios; nada de rede.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { beds24Calendario, lancamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { conferirTentativa } from "@/pagamentos/conferencia";
import { alteracaoGravada, alterar, type Cenario, liberar, minutos, montarCenario, pagarDiferenca, pagarEConfirmar, TOTAL, usuarioDeTeste } from "@/pagamentos/testes";
import { partesDoProprietario } from "./extrato";
import { recebidoPorReserva } from "./recebimentos";
import { preverRepasses } from "./repasses";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});

/** Um instante no horário de São Paulo ("AAAA-MM-DD HH:MM"). */
const sp = (dataHora: string) => new Date(`${dataHora.replace(" ", "T")}:00-03:00`);
/** As partes da dona nesta reserva (as em vigor), classificadas em `agora`. */
const partes = (reservaId: string, agora: Date) => partesDoProprietario(db, c.org, c.dono, agora, { reservaIds: [reservaId] });
const recebido = async (reservaId: string) => (await recebidoPorReserva(db, c.org, [reservaId])).get(reservaId)!;
const soma = (ps: { valor: number }[]) => ps.reduce((t, p) => t + p.valor, 0);

describe("o lado do proprietário de uma alteração (M8.2d)", () => {
  it("aumento: toda a parte espera a liberação do pagamento da diferença (com a data prevista dela), antes e depois do check-in; com ela, recebido = devido e disponível", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const pix = await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25), aprovar: false });
    c.provedor.aprovar(pix.idProvedor, { taxa: 528, liberacaoPrevista: new Date("2026-11-15T15:00:00Z") });
    await conferirTentativa(db, c.org, pix.pagamentoId, c.provedor, minutos(27), { origem: "rotina", forcar: true });
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "aplicada" });
    // O pagamento da reserva já entrou (L1); falta o da diferença (L2).
    expect(await recebido(x.reservaId)).toMatchObject({ recebido: TOTAL - 1824, devido: 235200 - 2352 });
    const antes = await partes(x.reservaId, minutos(30));
    expect(antes.length).toBeGreaterThan(0);
    for (const p of antes) expect(p).toMatchObject({ situacao: "a_liberar", motivo: "Libera depois do check-in (12/10/2026) e da liberação do pagamento da diferença pelo Mercado Pago (prevista para 15/11/2026)." });
    const depoisDoCheckin = sp("2026-10-13 12:00");
    for (const p of await partes(x.reservaId, depoisDoCheckin))
      expect(p).toMatchObject({ situacao: "a_liberar", motivo: "Reserva paga pelo site: o Mercado Pago libera o pagamento da diferença em 15/11/2026; nunca se repassa o que ainda não entrou." });
    // O fechamento de outubro deixa a parte de fora, dizendo que falta a liberação do pagamento da diferença.
    const [previsto] = await preverRepasses(db, c.org, "2026-10", "2026-11-01", [c.dono]);
    expect(previsto.avisos.find((a) => a.includes("ficam fora deste repasse"))).toContain(`${x.reservaCodigo}, o Mercado Pago libera o pagamento da diferença em 15/11/2026`);
    // O Mercado Pago libera a diferença: o recebimento dela entra e a conta fecha (L1 + L2 = devido).
    await liberar(c, pix.pagamentoId, { manual: false, quando: depoisDoCheckin });
    expect(await recebido(x.reservaId)).toMatchObject({ recebido: 235200 - 2352, devido: 235200 - 2352 });
    const disponiveis = await partes(x.reservaId, depoisDoCheckin);
    for (const p of disponiveis) expect(p.situacao).toBe("disponivel");
    expect(soma(disponiveis)).toBe(soma(antes));
  });

  it("redução: entre a aplicação e a saída da devolução o recebido passa do devido (a parte nunca volta para 'a liberar'); depois da saída, recebido = devido", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    c.provedor.respostaDevolucao = "pedida";
    const valor = { origem: "digitado" as const, valor: TOTAL - 20_000, motivo: "acordo_com_hospede" as const, nota: "Saída um dia antes" };
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-14", valor }, minutos(20), { autorId: equipe, aplicar: true });
    expect(resultado).toMatchObject({ ok: true, situacao: "aplicada", devolucoes: ["pedida"] });
    const depoisDoCheckin = sp("2026-10-13 12:00");
    // A devolução foi pedida e ainda não saiu: recebido (L1) > devido (B2 − T); a parte já está disponível depois do check-in.
    const meio = await recebido(x.reservaId);
    expect(meio.recebido).toBe(TOTAL - 1824);
    expect(meio.recebido).toBeGreaterThan(meio.devido);
    const disponiveis = await partes(x.reservaId, depoisDoCheckin);
    expect(disponiveis.length).toBeGreaterThan(0);
    for (const p of disponiveis) expect(p.situacao).toBe("disponivel");
    // O Mercado Pago conclui a devolução; a leitura confirma e lança a saída (o devolvido menos a taxa atribuída).
    c.provedor.confirmarDevolucoes(x.idProvedor);
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, minutos(40), { origem: "rotina", forcar: true });
    const saidas = await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.tipo, "devolucao")));
    expect(saidas).toHaveLength(1);
    const fim = await recebido(x.reservaId);
    expect(fim.recebido).toBe(fim.devido);
    expect(fim.recebido).toBe(TOTAL - 1824 - (saidas[0].montante ?? 0));
    for (const p of await partes(x.reservaId, depoisDoCheckin)) expect(p.situacao).toBe("disponivel");
  });

  it("redução retida: o total do proprietário não muda e os meses seguem as noites novas (outubro → novembro)", async () => {
    // 29/10–01/11 (três noites de outubro), paga em 01/10; em 20/10 (depois do prazo integral), muda para 01/11–03/11 por menos.
    const x = await pagarEConfirmar(c, { entrada: "2026-10-29", saida: "2026-11-01" });
    const antes = await partes(x.reservaId, minutos(10));
    expect(new Set(antes.map((p) => p.competencia.slice(0, 7)))).toEqual(new Set(["2026-10"]));
    const quando = sp("2026-10-20 11:00");
    // A agenda do Beds24 lida pouco antes (as noites novas continuam livres).
    await db.update(beds24Calendario).set({ observadoEm: sp("2026-10-20 10:30") }).where(eq(beds24Calendario.organizacaoId, c.org));
    const valor = { origem: "digitado" as const, valor: TOTAL - 50_000, motivo: "acordo_com_hospede" as const, nota: "Uma noite a menos, em novembro" };
    const { previa, resultado } = await alterar(c, x.reservaId, { checkin: "2026-11-01", checkout: "2026-11-03", recebidoEm: sp("2026-10-20 10:00"), valor }, quando, { autorId: equipe, aplicar: true });
    if (!previa.ok) throw new Error(previa.erro);
    expect(previa.previa).toMatchObject({ rumo: "reducao", direito: "nenhum", valorNovo: TOTAL });
    expect(resultado).toMatchObject({ ok: true, situacao: "aplicada", devolucoes: [] });
    const depois = await partes(x.reservaId, quando);
    expect(new Set(depois.map((p) => p.competencia.slice(0, 7)))).toEqual(new Set(["2026-11"]));
    expect(soma(depois)).toBe(soma(antes));
    expect(await recebido(x.reservaId)).toMatchObject({ devido: TOTAL - 1824 });
  });
});
