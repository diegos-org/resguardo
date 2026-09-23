import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import type { DadosReserva } from "@/reservas/regras";
import { sincronizarReserva } from "@/reservas/repositorio";
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

describe("aplicarMotor", () => {
  it("gera os lançamentos uma vez só, mesmo rodando de novo", async () => {
    const r = await sincronizarReserva(db, org, "beds24", "1", dados());
    const id = r.ok ? r.reserva.id : "";
    expect(await aplicarMotor(db, org, id, null)).toMatchObject({ criados: 4, estornados: 0 });
    expect(await aplicarMotor(db, org, id, null)).toMatchObject({ criados: 0, estornados: 0, mantidos: 4 });
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
    expect((await totaisPorTipo(db, org, {})).comissao).toBe(19125);
  });

  it("reserva alterada: estorna o que mudou e lança o novo; totais corretos", async () => {
    const r = await sincronizarReserva(db, org, "beds24", "1", dados());
    const id = r.ok ? r.reserva.id : "";
    await aplicarMotor(db, org, id, null);
    await sincronizarReserva(db, org, "beds24", "1", dados({ valorBruto: 200000, taxaCanal: 30000 }));
    const res = await aplicarMotor(db, org, id, null);
    expect(res?.estornados).toBe(4);
    expect(res?.criados).toBe(4);
    const t = await totaisPorTipo(db, org, {});
    expect(t.receita_bruta).toBe(200000);
    expect(t.comissao).toBe(25500);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(144500);
  });

  it("cancelamento estorna tudo e o acerto volta a zero", async () => {
    const r = await sincronizarReserva(db, org, "beds24", "1", dados());
    const id = r.ok ? r.reserva.id : "";
    await aplicarMotor(db, org, id, null);
    await sincronizarReserva(db, org, "beds24", "1", dados({ estado: "cancelada" }));
    const res = await aplicarMotor(db, org, id, null);
    expect(res).toMatchObject({ criados: 0, estornados: 4 });
    expect(res?.avisos[0]).toContain("cancelada");
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(0);
    expect(await listarLancamentos(db, org, { reservaId: id })).toHaveLength(8); // histórico preservado
  });

  it("reserva de outra organização ou id inválido: nada acontece", async () => {
    expect(await aplicarMotor(db, org, "lixo", null)).toBeNull();
    expect(await aplicarMotor(db, org, "00000000-0000-4000-8000-000000000999", null)).toBeNull();
  });
});
