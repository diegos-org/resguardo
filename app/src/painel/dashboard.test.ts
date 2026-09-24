import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { bloqueios, imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { listarImoveis } from "@/imoveis/repositorio";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { carregarDashboard } from "./dashboard";

let db: Db;
let close: () => Promise<void>;
let org: string;
let a: string;
let b: string;

const reserva = (imovelId: string, checkin: string, checkout: string, over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId,
  origem: "booking",
  estado: "confirmada",
  checkin,
  checkout,
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
  ...over,
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
  const [dono] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono.id, imovelId: a });
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
});
afterEach(() => close());

const carregar = async (verFinanceiro = true, so?: string) => {
  const lista = await listarImoveis(db, org);
  const sel = so ? lista.filter((i) => i.codigo === so) : lista;
  return carregarDashboard(db, org, { imoveis: sel, todos: !so, periodo: { inicio: "2026-10-01", fim: "2026-11-01" }, ano: 2026, hoje: "2026-10-09", verFinanceiro });
};

describe("painel inicial", () => {
  it("ocupação, próximas entradas/saídas, financeiro e alertas", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-01", "2026-10-09"), null); // sai hoje
    await criarReserva(db, org, reserva(a, "2026-10-12", "2026-10-15"), null); // entra em 3 dias
    await criarReserva(db, org, reserva(b, "2026-10-20", "2026-10-22", { valorBruto: null }), null); // sem valor, sem contrato
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: b, inicio: "2026-10-01", fim: "2026-10-11" });

    const d = await carregar();
    expect(d.ocupacao.map((x) => [x.codigo, x.vendidas, x.disponiveis])).toEqual([
      ["102", 2, 21],
      ["403", 11, 31],
    ]);
    expect(d.ocupacaoTotal).toEqual({ vendidas: 13, disponiveis: 52, taxa: 13 / 52 });
    expect(d.proximasEntradas.map((r) => r.checkin)).toEqual(["2026-10-12"]);
    expect(d.proximasSaidas.map((r) => r.checkout)).toEqual(["2026-10-09", "2026-10-15"]);
    // 2 reservas do 403 com valor: bruto 2 × 1.000; comissão 15% sobre 850 cada.
    expect(d.financeiro).toMatchObject({ receitaBruta: 200000, taxasCanais: 30000, comissoes: 25500, resultadoEmpresa: 25500 });
    expect(d.porMes?.[9]).toEqual({ mes: 10, receitaBruta: 200000, comissoes: 25500 });
    const textos = d.alertas.map((x) => x.texto).join(" | ");
    expect(textos).toContain("Sem contrato vigente: 102");
    expect(textos).toContain("Sem proprietário: 102");
    expect(textos).toContain("1 reserva(s) do período sem valor");
  });

  it("sem permissão financeira: só operação (ocupação e movimento), sem valores", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-12", "2026-10-15"), null);
    const d = await carregar(false);
    expect(d.financeiro).toBeNull();
    expect(d.porMes).toBeNull();
    expect(d.alertas.some((x) => x.texto.includes("contrato"))).toBe(false);
    expect(d.proximasEntradas).toHaveLength(1);
  });

  it("filtro de imóvel: números só do imóvel escolhido; sobreposição vira alerta", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-12", "2026-10-15"), null);
    await criarReserva(db, org, reserva(a, "2026-10-14", "2026-10-16"), null);
    await criarReserva(db, org, reserva(b, "2026-10-12", "2026-10-15"), null);
    const d = await carregar(true, "403");
    expect(d.ocupacao.map((x) => x.codigo)).toEqual(["403"]);
    expect(d.reservasNoPeriodo).toBe(2);
    expect(d.alertas[0]).toMatchObject({ nivel: "atencao", texto: expect.stringContaining("sobreposta") });
    expect(d.alertas.some((x) => x.texto.includes("102"))).toBe(false);
  });
});
