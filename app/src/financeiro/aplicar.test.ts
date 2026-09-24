import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import type { DadosReserva } from "@/reservas/regras";
import { cancelarReserva, criarReserva, sincronizarReserva } from "@/reservas/repositorio";
import { aplicarMotor } from "./aplicar";
import { listarLancamentos, saldoAcerto, totaisPorTipo } from "./ledger";

let db: Db;
let close: () => Promise<void>;
let org: string;
let im: string;
let dono: string;

const dados = (over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId: im,
  origem: "booking",
  estado: "confirmada",
  checkin: "2026-10-10",
  checkout: "2026-10-13",
  hospedes: 2,
  hospedeNome: "Teste",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 150000,
  taxaCanal: 22500,
  valorLiquido: null,
  codigoCanal: "",
  observacoes: "",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "t1", nome: "Um" }).returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
  await criarContrato(db, org, im, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
});
afterEach(() => close());

const sinc = async (over: Partial<DadosReserva> = {}) => {
  const r = await sincronizarReserva(db, org, "beds24", "1", dados(over));
  if (!r.ok) throw new Error("falhou");
  return r.reserva.id;
};
const ativosDoMotor = async (id: string) => {
  const todos = await listarLancamentos(db, org, { reservaId: id });
  const estornados = new Set(todos.map((l) => l.estornoDe).filter(Boolean));
  return todos.filter((l) => l.origem === "motor" && !estornados.has(l.id));
};

describe("aplicarMotor", () => {
  it("a sincronização já lança; rodar de novo não duplica", async () => {
    const id = await sinc();
    expect(await ativosDoMotor(id)).toHaveLength(4);
    expect(await aplicarMotor(db, org, id, null)).toMatchObject({ criados: 0, estornados: 0, mantidos: 4 });
    await sinc(); // mesma reserva de novo
    expect(await listarLancamentos(db, org, { reservaId: id })).toHaveLength(4);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
    expect((await totaisPorTipo(db, org, {})).comissao).toBe(19125);
  });

  it("reserva alterada: estorna o que mudou e lança o novo; totais corretos", async () => {
    const id = await sinc();
    await sinc({ valorBruto: 200000, taxaCanal: 30000 });
    expect(await listarLancamentos(db, org, { reservaId: id })).toHaveLength(12); // 4 + 4 estornos + 4 novos
    const t = await totaisPorTipo(db, org, {});
    expect(t.receita_bruta).toBe(200000);
    expect(t.comissao).toBe(25500);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(144500);
  });

  it("valor volta ao cálculo anterior (A → B → A): lança de novo em vez de reaproveitar o estornado", async () => {
    const id = await sinc();
    await sinc({ valorBruto: 200000, taxaCanal: 30000 });
    await sinc();
    expect(await ativosDoMotor(id)).toHaveLength(4);
    const t = await totaisPorTipo(db, org, {});
    expect(t.receita_bruta).toBe(150000);
    expect(t.comissao).toBe(19125);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
    // E ainda assim idempotente.
    expect(await aplicarMotor(db, org, id, null)).toMatchObject({ criados: 0, estornados: 0, mantidos: 4 });
  });

  it("reserva muda de imóvel (mesmo dono e valores): lançamentos passam para o novo imóvel", async () => {
    const [{ id: im2 }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "t2", nome: "Dois" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im2 });
    await criarContrato(db, org, im2, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    const id = await sinc();
    await sinc({ imovelId: im2 });
    const ativos = await ativosDoMotor(id);
    expect(ativos).toHaveLength(4);
    expect(ativos.every((l) => l.imovelId === im2)).toBe(true);
    expect((await totaisPorTipo(db, org, { imovelIds: [im] })).receita_bruta ?? 0).toBe(0);
  });

  it("imóvel com dois proprietários: acerto pendente, sem escolher um deles", async () => {
    const [{ id: outro }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Outro" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: im });
    const id = await sinc();
    const direito = (await ativosDoMotor(id)).find((l) => l.tipo === "direito_proprietario");
    expect(direito).toMatchObject({ proprietarioId: null, efeitoSaldo: 0, estado: "pendente" });
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(0);
  });

  it("Airbnb: split por padrão (fora do acerto); se a reserva disser que a empresa recebeu, entra no acerto", async () => {
    const id = await sinc({ origem: "airbnb" });
    expect((await ativosDoMotor(id)).find((l) => l.tipo === "direito_proprietario")).toMatchObject({ estado: "previsto", efeitoSaldo: 0 });
    await sinc({ origem: "airbnb", recebimento: "empresa" });
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
  });

  it("cancelamento estorna tudo e o acerto volta a zero", async () => {
    const id = await sinc();
    await sinc({ estado: "cancelada" });
    expect(await ativosDoMotor(id)).toHaveLength(0);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(0);
    expect(await listarLancamentos(db, org, { reservaId: id })).toHaveLength(8); // histórico preservado
  });

  it("reserva lançada à mão e cancelada no painel: financeiro acompanha na mesma transação", async () => {
    const r = await criarReserva(db, org, dados(), null);
    const id = r.ok ? r.reserva.id : "";
    expect(await ativosDoMotor(id)).toHaveLength(4);
    expect(await cancelarReserva(db, org, id, null)).toBe(true);
    expect(await ativosDoMotor(id)).toHaveLength(0);
  });

  it("reserva de outra organização ou id inválido: nada acontece", async () => {
    expect(await aplicarMotor(db, org, "lixo", null)).toBeNull();
    expect(await aplicarMotor(db, org, "00000000-0000-4000-8000-000000000999", null)).toBeNull();
  });
});
