import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { complementarAjuste, type DadosAjuste, esclarecerAjuste, registrarAjuste } from "@/ajustes/ajustes";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, lancamentos, organizacoes, proprietarioImoveis, proprietarios, proprietarioUsuarios, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { registrarDespesa } from "@/despesas/despesas";
import type { DadosReserva } from "@/reservas/regras";
import { aplicarMotor } from "@/financeiro/aplicar";
import { cancelarReserva, criarReserva } from "@/reservas/repositorio";
import { proprietariosDoUsuario, resumoDoProprietario } from "./resumo";

let db: Db;
let close: () => Promise<void>;
let org: string;
let a: string;
let b: string;
let dona: string;
let outro: string;
let categoria: string;
const periodo = { inicio: "2026-10-01", fim: "2026-11-01" };

const reserva = (imovelId: string): DadosReserva => ({
  imovelId,
  origem: "booking",
  estado: "confirmada",
  checkin: "2026-10-10",
  checkout: "2026-10-13",
  hospedes: 2,
  hospedeNome: "Hóspede Fictício",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 100000,
  taxaCanal: 15000,
  valorLiquido: null,
  codigoCanal: "",
  observacoes: "",
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: a }, { id: b }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro" },
      { organizacaoId: org, codigo: "102", nome: "Um" },
    ])
    .returning();
  [{ id: dona }, { id: outro }] = await db
    .insert(proprietarios)
    .values([
      { organizacaoId: org, nome: "Dona", chavePix: "dona@example.com" },
      { organizacaoId: org, nome: "Outro" },
    ])
    .returning();
  // Donos desde 2025 (data do vínculo fixa: os testes não dependem do relógio).
  const desde = new Date("2025-01-01T12:00:00Z");
  await db.insert(proprietarioImoveis).values([
    { proprietarioId: dona, imovelId: a, criadoEm: desde },
    { proprietarioId: outro, imovelId: b, criadoEm: desde },
  ]);
  for (const i of [a, b]) await criarContrato(db, org, i, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  const c = await criarCategoria(db, org, "Manutenção", null);
  if (!c.ok) throw new Error("categoria");
  categoria = c.categoria.id;
  await criarReserva(db, org, reserva(a), null);
  await criarReserva(db, org, reserva(b), null);
  await registrarDespesa(
    db,
    org,
    { responsavel: "proprietario", pagoPor: "empresa", categoriaId: categoria, descricao: "Reparo", valor: 20000, data: "2026-10-05", imovelId: a, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-06" },
    null,
  );
});
afterEach(() => close());

describe("resumo do portal", () => {
  it("só os números da própria dona: reservas, bruto, taxa, comissão, parte dela, despesas e acerto", async () => {
    const r = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo });
    // Bruto 1.000; taxa 150; comissão 15% de 850 = 127,50; parte dela 722,50; reparo 200 pago pela empresa.
    expect(r).toEqual({ reservas: 1, receitaBruta: 100000, taxasCanais: 15000, comissao: 12750, suaParte: 72250, despesas: 20000, acerto: 72250 - 20000, acertoPendente: 0, emConferencia: false });
  });

  it("só reservas confirmadas: pendente não entra e cancelada sai da contagem", async () => {
    await criarReserva(db, org, { ...reserva(a), checkin: "2026-10-20", checkout: "2026-10-22", estado: "pendente" }, null);
    const r = await criarReserva(db, org, { ...reserva(a), checkin: "2026-10-25", checkout: "2026-10-27" }, null);
    if (!r.ok) throw new Error("reserva");
    expect((await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo })).reservas).toBe(2);
    // Ajuste com a dona ligado a essa reserva continua valendo depois do cancelamento.
    await registrarAjuste(
      db,
      org,
      { data: "2026-10-26", imovelId: null, reservaId: r.reserva.id, proprietarioId: null, motivo: "Dano no imóvel", origem: "desconhecida", origemComprovada: false, evidencia: "Vistoria", comprovante: "", valor: 5000, direcao: "proprietario_credito" },
      null,
    );
    await cancelarReserva(db, org, r.reserva.id, null);
    const depois = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo });
    // O ajuste ainda não esclarecido fica à parte, como pendente (não entra no acerto definitivo).
    expect(depois).toMatchObject({ reservas: 1, receitaBruta: 100000, suaParte: 72250, acerto: 72250 - 20000, acertoPendente: 5000, emConferencia: true });
  });

  it("cancelada depois de dinheiro movimentado: os lançamentos protegidos continuam, como no livro", async () => {
    const [r] = await db.select({ id: reservas.id }).from(reservas).where(eq(reservas.imovelId, a));
    await db
      .update(lancamentos)
      .set({ estado: "realizado" })
      .where(and(eq(lancamentos.reservaId, r.id), eq(lancamentos.origem, "motor")));
    await cancelarReserva(db, org, r.id, null);
    const depois = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo });
    // Os valores continuam (o livro manda), mas a parte dela fica em conferência até alguém decidir (M4.8).
    expect(depois).toMatchObject({ reservas: 0, receitaBruta: 100000, comissao: 12750, suaParte: 72250, acerto: -20000, acertoPendente: 72250, emConferencia: true });
  });

  it("reserva confirmada ainda sem cálculo no financeiro conta como reserva", async () => {
    await criarReserva(db, org, { ...reserva(a), checkin: "2026-10-20", checkout: "2026-10-22", valorBruto: null, taxaCanal: null }, null);
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo })).toMatchObject({ reservas: 2, receitaBruta: 100000, suaParte: 72250 });
  });

  it("reserva sem cálculo de antes da troca de dono não aparece para o novo dono", async () => {
    await criarReserva(db, org, { ...reserva(a), checkin: "2026-10-20", checkout: "2026-10-22", valorBruto: null, taxaCanal: null }, null);
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    // O novo dono passou a ter o imóvel depois da entrada (25/10): a estada era do anterior.
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a, criadoEm: new Date("2026-10-25T12:00:00Z") });
    expect((await resumoDoProprietario(db, org, { proprietarioIds: [outro], imovelIds: [a], periodo })).reservas).toBe(0);
  });

  it("imóvel A→B (recalculado) e de volta a A: a reserva é de quem tem a parte em vigor", async () => {
    const [r] = await db.select({ id: reservas.id }).from(reservas).where(eq(reservas.imovelId, a));
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a });
    await aplicarMotor(db, org, r.id, null);
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [outro], imovelIds: [a], periodo })).toMatchObject({ reservas: 1, receitaBruta: 100000, suaParte: 72250 });
    // Volta para a dona sem recalcular: a parte dela está estornada, a reserva segue do outro.
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: a });
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo })).toMatchObject({ reservas: 0, receitaBruta: 0, comissao: 0, suaParte: 0 });
  });

  it("com todos os imóveis dele, entra o acerto sem imóvel; com filtro de imóvel, não", async () => {
    await db.insert(lancamentos).values({ organizacaoId: org, tipo: "ajuste", descricao: "Acerto geral fictício", valor: 0, efeitoSaldo: 3000, competencia: "2026-10-20", estado: "realizado", imovelId: null, proprietarioId: dona, origem: "manual" });
    await db.insert(lancamentos).values({ organizacaoId: org, tipo: "ajuste", descricao: "De outra pessoa", valor: 0, efeitoSaldo: 9000, competencia: "2026-10-20", estado: "realizado", imovelId: null, proprietarioId: outro, origem: "manual" });
    expect((await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], semImovel: true, periodo })).acerto).toBe(72250 - 20000 + 3000);
    expect((await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo })).acerto).toBe(72250 - 20000);
  });

  it("ajuste sem valor ou pendências que se anulam: continua 'em conferência'", async () => {
    await registrarAjuste(
      db,
      org,
      { data: "2026-10-26", imovelId: a, reservaId: null, proprietarioId: null, motivo: "Vidro quebrado", origem: "desconhecida", origemComprovada: false, evidencia: "", comprovante: "", valor: null, direcao: "proprietario_debito" },
      null,
    );
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo })).toMatchObject({ acertoPendente: 0, emConferencia: true });
    // De outro imóvel/dono, não.
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [outro], imovelIds: [b], periodo })).toMatchObject({ emConferencia: false });
  });

  it("ajuste complementado e esclarecido: o pendente estornado não deixa 'em conferência' para sempre", async () => {
    const dados: DadosAjuste = { data: "2026-10-26", imovelId: a, reservaId: null, proprietarioId: null, motivo: "Dano no imóvel", origem: "desconhecida", origemComprovada: false, evidencia: "Vistoria", comprovante: "", valor: 5000, direcao: "proprietario_credito" };
    const r = await registrarAjuste(db, org, dados, null);
    if (!r.ok) throw new Error("ajuste");
    expect((await complementarAjuste(db, org, r.id, { ...dados, valor: 6000 }, null)).ok).toBe(true);
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo })).toMatchObject({ acertoPendente: 6000, emConferencia: true });
    expect((await esclarecerAjuste(db, org, r.id, null)).ok).toBe(true);
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo })).toMatchObject({ acerto: 72250 - 20000 + 6000, acertoPendente: 0, emConferencia: false });
  });

  it("reserva calculada antes de o imóvel ter dono (parte sem proprietário, pendente) deixa 'em conferência'", async () => {
    const [c] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "999", nome: "Sem dono" }).returning();
    await criarContrato(db, org, c.id, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await criarReserva(db, org, reserva(c.id), null);
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: c.id });
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a, c.id], periodo })).toMatchObject({ emConferencia: true });
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], periodo })).toMatchObject({ emConferencia: false });
  });

  it("não vê imóvel de outro dono, nem 'todos' quando a lista vem vazia", async () => {
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [b], periodo })).toMatchObject({ reservas: 0, receitaBruta: 0, suaParte: 0 });
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [], periodo })).toMatchObject({ reservas: 0, receitaBruta: 0 });
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [], imovelIds: [a], periodo })).toMatchObject({ reservas: 0 });
  });

  it("imóvel que passou para outro dono: o novo não vê o histórico do anterior", async () => {
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a });
    expect(await resumoDoProprietario(db, org, { proprietarioIds: [outro], imovelIds: [a], periodo })).toMatchObject({ reservas: 0, receitaBruta: 0, suaParte: 0, despesas: 0, acerto: 0 });
  });

  it("proprietários do usuário: só os ativos ligados a ele", async () => {
    const [u] = await db.insert(usuarios).values({ organizacaoId: org, email: "dona@example.com", nome: "Dona", papel: "proprietario" }).returning();
    await db.insert(proprietarioUsuarios).values({ proprietarioId: dona, usuarioId: u.id });
    expect(await proprietariosDoUsuario(db, org, u.id)).toEqual([{ id: dona, nome: "Dona", chavePix: "dona@example.com" }]);
    await db.update(proprietarios).set({ ativo: false }).where(eq(proprietarios.id, dona));
    expect(await proprietariosDoUsuario(db, org, u.id)).toEqual([]);
  });
});
