/**
 * M8.2c — a reserva que o motor calcula (gêmeos TS e SQL) e a reserva cujo pagamento do site o Mercado Pago mostra
 * devolvido fora da política (D21): o que fica em conferência, o que não fica, e o que a equipe pode dar por resolvido.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { devolucoesPagamento, imoveis, lancamentos, organizacoes, pagamentos, proprietarioImoveis, proprietarios, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { devolvidaNoProvedor } from "@/pagamentos/consultas";
import { partesDisponiveis } from "@/repasses/extrato";
import { gerarAntecipado, marcarRepassePago, preverRepasses } from "@/repasses/repasses";
import { cancelamentoDeTeste, espelharCancelamento, pagamentoDoSiteDeTeste } from "@/repasses/testes-cancelamento";
import { receberTudo } from "@/repasses/testes";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva, devolvidaNoProvedorDaReserva, resolverConferencia } from "@/reservas/repositorio";
import { devolvidaNoProvedorSql, lancamentoEmConferencia, lancamentoEmVigor, reservaCalculadaSql } from "./posse";
import { reservasDoPortal } from "./reservas";

let db: Db, close: () => Promise<void>, org: string, a: string, dono: string;
const OUTUBRO = { inicio: "2026-10-01", fim: "2026-11-01" };

const reserva = (checkin: string, checkout: string, over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId: a, origem: "site", estado: "confirmada", checkin, checkout, hospedes: 2, hospedeNome: "Hóspede Fictício", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL",
  valorBruto: 100000, taxaCanal: 1000, valorLiquido: null, codigoCanal: "", observacoes: "", ...over,
});
const criar = async (dados: DadosReserva) => {
  const r = await criarReserva(db, org, dados, null);
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.reserva;
};
/** Lançamentos em conferência (e em vigor) da reserva: a regra única do portal, do PDF, do fechamento e do Início. */
const emConferencia = async (reservaId: string) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), lancamentoEmConferencia(), lancamentoEmVigor(db))))[0].n;
const devolvidaSql = async (reservaId: string) => (await db.select({ d: sql<boolean>`coalesce(${devolvidaNoProvedorSql()}, false)` }).from(reservas).where(eq(reservas.id, reservaId)))[0].d;
const pagamento = async (pagamentoId: string) => (await db.select().from(pagamentos).where(eq(pagamentos.id, pagamentoId)))[0];

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: a }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Quatro" }).returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Exemplo", chavePix: "dona@example.com" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: a, criadoEm: new Date("2025-01-01T12:00:00Z") });
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
});
afterEach(() => close());

describe("reserva calculada pelo motor (M8.2c)", () => {
  it("o gêmeo SQL diz o mesmo que a regra TS (confirmada; cancelada com e sem retido; pendente)", async () => {
    const casos: [Partial<DadosReserva>, number | null][] = [
      [{ estado: "confirmada" }, null],
      [{ estado: "cancelada" }, 100000],
      [{ estado: "cancelada" }, null],
      [{ estado: "cancelada" }, 0],
      [{ estado: "pendente" }, 100000],
    ];
    for (const [i, [over, valorRetido]] of casos.entries()) {
      const r = await criar(reserva(`2026-10-${String(i + 1).padStart(2, "0")}`, `2026-10-${String(i + 2).padStart(2, "0")}`, { ...over, estado: "confirmada" }));
      await db.update(reservas).set({ estado: over.estado, valorRetido }).where(eq(reservas.id, r.id));
    }
    const linhas = await db.select({ estado: reservas.estado, valorRetido: reservas.valorRetido, sql: sql<boolean>`${reservaCalculadaSql()}` }).from(reservas).where(eq(reservas.organizacaoId, org));
    expect(linhas).toHaveLength(5);
    for (const l of linhas) expect(l.sql).toBe(reservaCalculadaPeloMotor(l));
    expect(linhas.filter((l) => l.sql)).toHaveLength(2);
  });
});

describe("pagamento do site devolvido no Mercado Pago fora da política (D21, M8.2c)", () => {
  it("confirmada com o pagamento devolvido: em conferência, fora dos repasses e do fechamento, até a equipe dar por resolvida", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"));
    await receberTudo(db, org, r.id, "2026-10-10");
    const pagamentoId = await pagamentoDoSiteDeTeste(db, org, r);
    const agora = new Date("2026-10-20T12:00:00-03:00");
    expect(await partesDisponiveis(db, org, dono, agora)).toHaveLength(1);
    expect(await emConferencia(r.id)).toBe(0);
    expect(await devolvidaSql(r.id)).toBe(false);
    expect(devolvidaNoProvedor([await pagamento(pagamentoId)], [], null)).toBe(false);
    // M8.2d: o aviso `devolvido_por_fora` é saída da regra, nunca entrada — sozinho, não põe a reserva em conferência.
    await db.update(pagamentos).set({ avisos: ["devolvido_por_fora"] }).where(eq(pagamentos.id, pagamentoId));
    expect(await devolvidaSql(r.id)).toBe(false);
    expect(devolvidaNoProvedor([await pagamento(pagamentoId)], [], null)).toBe(false);
    // Cada forma de o Mercado Pago mostrar a devolução: os dois gêmeos concordam.
    for (const leitura of [{ situacao: "devolvido" as const }, { situacao: "devolvido_parcial" as const }, { devolvidoLido: 500 }]) {
      await db.update(pagamentos).set({ situacao: "aprovado", devolvidoLido: 0, avisos: [], ...leitura }).where(eq(pagamentos.id, pagamentoId));
      expect(await devolvidaSql(r.id)).toBe(true);
      expect(devolvidaNoProvedor([await pagamento(pagamentoId)], [], null)).toBe(true);
      // A ficha (quadro "Em conferência") lê a mesma regra, só da própria organização.
      expect(await devolvidaNoProvedorDaReserva(db, org, r.id)).toBe(true);
      expect(await emConferencia(r.id)).toBe(4);
    }
    const [{ id: outraOrg }] = await db.insert(organizacoes).values({ nome: "B" }).returning();
    expect(await devolvidaNoProvedorDaReserva(db, outraOrg, r.id)).toBe(false);
    expect(await devolvidaNoProvedorDaReserva(db, org, "nao-e-uuid")).toBe(false);
    // A parte sai do disponível: nenhum antecipado a paga; o fechamento de outubro trava; o portal mostra em conferência.
    expect(await partesDisponiveis(db, org, dono, agora)).toEqual([]);
    expect(await gerarAntecipado(db, org, dono, "2026-10-20", null)).toMatchObject({ ok: false, erro: "Nada disponível para repassar agora." });
    expect((await preverRepasses(db, org, "2026-10", "2026-11-10", [dono]))[0].bloqueios.join(" ")).toContain("acerto pendente");
    expect((await reservasDoPortal(db, org, { proprietarioIds: [dono], imovelIds: [a], periodo: OUTUBRO })).find((x) => x.id === r.id)?.situacao).toBe("em_conferencia");
    // A equipe faz o ajuste e dá por resolvida: sai da conferência.
    expect(await resolverConferencia(db, org, r.id, null)).toBe(true);
    expect(await resolverConferencia(db, org, r.id, null)).toBe(false);
    expect(await emConferencia(r.id)).toBe(0);
    expect((await preverRepasses(db, org, "2026-10", "2026-11-10", [dono]))[0].bloqueios.join(" ")).not.toContain("acerto pendente");
    expect((await reservasDoPortal(db, org, { proprietarioIds: [dono], imovelIds: [a], periodo: OUTUBRO })).find((x) => x.id === r.id)?.situacao).toBe("definido");
  });

  it("confirmada sem devolução no Mercado Pago não tem o que resolver", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"));
    await pagamentoDoSiteDeTeste(db, org, r);
    expect(await resolverConferencia(db, org, r.id, null)).toBe(false);
  });

  it("cancelada pela política com devolução integral não é D21; a cancelada com valor retido e devolvida no Mercado Pago é", async () => {
    const integral = await criar(reserva("2026-10-10", "2026-10-13"));
    const p1 = await pagamentoDoSiteDeTeste(db, org, integral, { situacao: "devolvido" });
    await cancelamentoDeTeste(db, org, { reservaId: integral.id, pagamentoId: p1, direito: "integral" });
    expect(await devolvidaSql(integral.id)).toBe(false);
    expect(devolvidaNoProvedor([await pagamento(p1)], [], { situacao: "cancelada", direito: "integral" })).toBe(false);

    const retida = await criar(reserva("2026-10-20", "2026-10-23"));
    const p2 = await pagamentoDoSiteDeTeste(db, org, retida);
    await cancelamentoDeTeste(db, org, { reservaId: retida.id, pagamentoId: p2, direito: "nenhum" });
    await db.update(reservas).set({ estado: "cancelada", valorRetido: 100000 }).where(eq(reservas.id, retida.id));
    expect(await aplicarMotor(db, org, retida.id, null)).toMatchObject({ criados: 0, estornados: 0, mantidos: 4 });
    // Retida: calculada como uma confirmada, fora da conferência.
    expect(await emConferencia(retida.id)).toBe(0);
    // O Mercado Pago mostra o pagamento dela devolvido (fora do sistema): em conferência.
    await db.update(pagamentos).set({ situacao: "devolvido" }).where(eq(pagamentos.id, p2));
    expect(await devolvidaSql(retida.id)).toBe(true);
    expect(devolvidaNoProvedor([await pagamento(p2)], [], { situacao: "cancelada", direito: "nenhum" })).toBe(true);
    expect(await emConferencia(retida.id)).toBe(4);
  });

  it("cancelada com devolução integral depois do repasse: sai da conferência na hora (o acerto lançado no mês do cancelamento)", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"));
    await receberTudo(db, org, r.id, "2026-10-10");
    const antecipado = await gerarAntecipado(db, org, dono, "2026-10-11", null);
    if (!antecipado.ok) throw new Error(antecipado.erro);
    await marcarRepassePago(db, org, antecipado.id, "2026-10-12", "2026-10-12", null);
    const pagamentoId = await pagamentoDoSiteDeTeste(db, org, r, { situacao: "devolvido" });
    const cancelamentoId = await cancelamentoDeTeste(db, org, { reservaId: r.id, pagamentoId, direito: "integral" });
    await espelharCancelamento(db, org, { reservaId: r.id, cancelamentoId, competencia: "2026-11-01", codigo: r.codigo });
    expect(await emConferencia(r.id)).toBe(0);
    expect(await resolverConferencia(db, org, r.id, null)).toBe(false);
    for (const mes of ["2026-10", "2026-11"]) expect((await preverRepasses(db, org, mes, "2026-12-02", [dono], true))[0].bloqueios.join(" ")).not.toContain("acerto pendente");
  });
});

describe("devoluções nossas não parecem devoluções de fora (D21, M8.2d)", () => {
  type Dev = Partial<typeof devolucoesPagamento.$inferInsert>;
  type Caso = { nome: string; pagamento: Partial<typeof pagamentos.$inferInsert>; devs: Dev[]; esperado: boolean; cancelamento?: "integral" | "nenhum" };
  const enviada: Dev = { situacao: "pedida", tentativas: 1, chaveAtual: "k1", chaveAceita: true };
  const casos: Caso[] = [
    { nome: "parcial nossa confirmada", pagamento: { situacao: "devolvido_parcial", devolvidoLido: 30000 }, devs: [{ valor: 30000, situacao: "confirmada", valorConfirmado: 30000 }], esperado: false },
    { nome: "parcial nossa em dúvida (resposta perdida)", pagamento: { situacao: "devolvido_parcial", devolvidoLido: 30000 }, devs: [{ ...enviada, valor: 30000, chaveAceita: false, chaveEmDuvida: true }], esperado: false },
    { nome: "parcial nossa aceita, ainda não confirmada", pagamento: { situacao: "devolvido_parcial", devolvidoLido: 30000 }, devs: [{ ...enviada, valor: 30000 }], esperado: false },
    { nome: "pedida nunca enviada não explica", pagamento: { situacao: "devolvido_parcial", devolvidoLido: 30000 }, devs: [{ valor: 30000, situacao: "pedida" }], esperado: true },
    { nome: "parcial nossa + outra pelo painel", pagamento: { situacao: "devolvido_parcial", devolvidoLido: 50000 }, devs: [{ valor: 30000, situacao: "confirmada", valorConfirmado: 30000 }], esperado: true },
    { nome: "só pelo painel", pagamento: { situacao: "devolvido_parcial", devolvidoLido: 20000 }, devs: [], esperado: true },
    { nome: "pelo painel, reconhecida", pagamento: { situacao: "devolvido_parcial", devolvidoLido: 20000, devolvidoForaReconhecido: 20000 }, devs: [], esperado: false },
    { nome: "devolvido sem valor e sem nada nosso", pagamento: { situacao: "devolvido", devolvidoLido: 0 }, devs: [], esperado: true },
    { nome: "devolvido sem valor, nossa integral confirmada", pagamento: { situacao: "devolvido", devolvidoLido: 0 }, devs: [{ valor: 100000, situacao: "confirmada" }], esperado: false },
    { nome: "devolvido com a nossa integral", pagamento: { situacao: "devolvido", devolvidoLido: 100000 }, devs: [{ valor: 100000, situacao: "confirmada", valorConfirmado: 100000 }], esperado: false },
    { nome: "a menor: confirmada pelo que voltou", pagamento: { situacao: "devolvido_parcial", devolvidoLido: 25000 }, devs: [{ valor: 30000, situacao: "confirmada", valorConfirmado: 25000 }], esperado: false },
    { nome: "duas parciais nossas", pagamento: { situacao: "devolvido_parcial", devolvidoLido: 50000 }, devs: [{ valor: 30000, situacao: "confirmada", valorConfirmado: 30000 }, { ...enviada, valor: 20000 }], esperado: false },
    { nome: "devolvido na cancelada pela política com integral", pagamento: { situacao: "devolvido", devolvidoLido: 100000 }, devs: [], esperado: false, cancelamento: "integral" },
    { nome: "devolvido de fora na cancelada sem direito", pagamento: { situacao: "devolvido", devolvidoLido: 100000 }, devs: [], esperado: true, cancelamento: "nenhum" },
  ];

  it("o gêmeo SQL diz o mesmo que a regra TS, caso a caso", async () => {
    for (const [i, caso] of casos.entries()) {
      const dia = String(i + 1).padStart(2, "0");
      const r = await criar(reserva(`2026-10-${dia}`, `2026-10-${String(i + 2).padStart(2, "0")}`));
      const pid = await pagamentoDoSiteDeTeste(db, org, r, caso.pagamento);
      for (const d of caso.devs) await db.insert(devolucoesPagamento).values({ organizacaoId: org, pagamentoId: pid, motivo: "Teste", valor: 0, origem: "cancelamento", ...d });
      const canc = caso.cancelamento ? { situacao: "cancelada" as const, direito: caso.cancelamento } : null;
      if (caso.cancelamento) await cancelamentoDeTeste(db, org, { reservaId: r.id, pagamentoId: pid, direito: caso.cancelamento });
      const devs = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, pid));
      const ts = devolvidaNoProvedor([await pagamento(pid)], devs, canc);
      expect({ caso: caso.nome, ts }).toEqual({ caso: caso.nome, ts: caso.esperado });
      expect({ caso: caso.nome, sql: await devolvidaSql(r.id) }).toEqual({ caso: caso.nome, sql: caso.esperado });
    }
  });

  it("a diferença de uma alteração conta como dinheiro da reserva; o pagamento sem reserva não", async () => {
    const r = await criar(reserva("2026-10-20", "2026-10-23"));
    const p0 = await pagamento(await pagamentoDoSiteDeTeste(db, org, r));
    const [{ id: p2 }] = await db
      .insert(pagamentos)
      .values({ organizacaoId: org, cotacaoId: p0.cotacaoId, reservaId: r.id, imovelId: a, ambiente: "teste", forma: "pix", referencia: `${p0.referencia}-2`, chaveIdempotencia: `${p0.chaveIdempotencia}-2`, valor: 20000, desfecho: "alteracao", situacao: "devolvido_parcial", devolvidoLido: 5000, aprovadoEm: new Date("2026-09-02T12:00:00Z") })
      .returning({ id: pagamentos.id });
    expect(await devolvidaSql(r.id)).toBe(true);
    expect(devolvidaNoProvedor(await db.select().from(pagamentos).where(eq(pagamentos.reservaId, r.id)), [], null)).toBe(true);
    await db.update(pagamentos).set({ desfecho: null, motivoSemReserva: "valor_divergente" }).where(eq(pagamentos.id, p2));
    expect(await devolvidaSql(r.id)).toBe(false);
    expect(devolvidaNoProvedor(await db.select().from(pagamentos).where(eq(pagamentos.reservaId, r.id)), [], null)).toBe(false);
  });
});
