import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { bloqueios, imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { bloqueiosDoPortal, reservasDoPortal } from "./reservas";

let db: Db;
let close: () => Promise<void>;
let org: string;
let a: string;
let b: string;
let dona: string;
let outro: string;
const periodo = { inicio: "2026-10-01", fim: "2026-11-01" };

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
  [{ id: dona }, { id: outro }] = await db
    .insert(proprietarios)
    .values([
      { organizacaoId: org, nome: "Dona" },
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
});
afterEach(() => close());

const lista = (donos = [dona], imovelIds = [a]) => reservasDoPortal(db, org, { proprietarioIds: donos, imovelIds, periodo });

describe("reservas do portal", () => {
  it("só as dele, por entrada, com bruto e parte dele no período; origem não informada fica vazia", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-20", "2026-10-23", { hospedeNome: "Bia Fictícia", hospedeOrigem: "Lisboa, Portugal" }), null);
    await criarReserva(db, org, reserva(a, "2026-10-05", "2026-10-08", { origem: "airbnb" }), null);
    await criarReserva(db, org, reserva(b, "2026-10-05", "2026-10-08"), null);
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-12", { estado: "pendente" }), null);
    const r = await lista();
    expect(r.map((x) => [x.checkin, x.imovelCodigo, x.canal, x.hospede, x.origemHospede, x.bruto, x.suaParte, x.situacao, x.confirmada])).toEqual([
      ["2026-10-05", "403", "airbnb", "Hóspede Fictício", "", 100000, 72250, "definido", true],
      ["2026-10-20", "403", "booking", "Bia Fictícia", "Lisboa, Portugal", 100000, 72250, "definido", true],
    ]);
    expect(await lista([dona], [b])).toEqual([]);
    expect(await lista([], [a])).toEqual([]);
  });

  it("estada entre meses: só a parte das noites do período", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-30", "2026-11-03"), null); // 2 noites em outubro, 2 em novembro
    const [r] = await lista();
    expect(r).toMatchObject({ bruto: 50000, suaParte: 36125 });
  });

  it("sem cálculo (sem valor) e em conferência (calculada antes de o imóvel ter dono)", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-05", "2026-10-08", { valorBruto: null, taxaCanal: null }), null);
    const [c] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "999", nome: "Sem dono" }).returning();
    await criarContrato(db, org, c.id, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await criarReserva(db, org, reserva(c.id, "2026-10-10", "2026-10-12"), null);
    // O vínculo num dia fixo antes da entrada (com o dia de hoje, uma entrada já passada ficaria do dono anterior).
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: c.id, criadoEm: new Date("2026-10-01T12:00:00Z") });
    const r = await lista([dona], [a, c.id]);
    expect(r.map((x) => [x.imovelCodigo, x.situacao, x.bruto, x.suaParte])).toEqual([
      ["403", "sem_calculo", 0, 0],
      ["999", "em_conferencia", 100000, 0],
    ]);
  });

  it("reserva sem cálculo de antes da troca, num imóvel sem nada no livro: o novo dono não vê", async () => {
    const [c] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "888", nome: "Sem contrato" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: c.id, criadoEm: new Date("2025-01-01T12:00:00Z") });
    await criarReserva(db, org, reserva(c.id, "2026-10-05", "2026-10-08", { valorBruto: null, taxaCanal: null }), null);
    expect((await lista([dona], [c.id])).map((x) => x.situacao)).toEqual(["sem_calculo"]);
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, c.id));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: c.id, criadoEm: new Date("2026-10-10T12:00:00Z") });
    expect(await lista([outro], [c.id])).toEqual([]);
    // Entrada depois do vínculo: é do dono atual, mesmo sem cálculo.
    await criarReserva(db, org, reserva(c.id, "2026-10-20", "2026-10-22", { valorBruto: null, taxaCanal: null }), null);
    expect((await lista([outro], [c.id])).map((x) => x.checkin)).toEqual(["2026-10-20"]);
  });

  it("imóvel que mudou de dono: o novo não vê as reservas do anterior; recalculada, passa a ver", async () => {
    const r = await criarReserva(db, org, reserva(a, "2026-10-05", "2026-10-08"), null);
    if (!r.ok) throw new Error("reserva");
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a });
    expect(await lista([outro], [a])).toEqual([]);
    await aplicarMotor(db, org, r.reserva.id, null);
    expect((await lista([outro], [a])).map((x) => x.suaParte)).toEqual([72250]);
    expect(await lista([dona], [a])).toEqual([]);
  });

  it("bloqueios: só do tempo em que o imóvel é dele; o que atravessa a troca aparece a partir do vínculo", async () => {
    await db.insert(bloqueios).values([
      { organizacaoId: org, imovelId: a, inicio: "2026-10-02", fim: "2026-10-05", motivo: "uso da dona" },
      { organizacaoId: org, imovelId: a, inicio: "2026-10-08", fim: "2026-10-14", motivo: "obra" },
      { organizacaoId: org, imovelId: a, inicio: "2026-10-20", fim: "2026-10-22", motivo: "uso do novo" },
    ]);
    const blq = (donos: string[]) => bloqueiosDoPortal(db, org, { proprietarioIds: donos, imovelIds: [a], periodo });
    expect((await blq([dona])).map((b) => [b.inicio, b.fim])).toEqual([
      ["2026-10-02", "2026-10-05"],
      ["2026-10-08", "2026-10-14"],
      ["2026-10-20", "2026-10-22"],
    ]);
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a, criadoEm: new Date("2026-10-10T12:00:00Z") });
    expect((await blq([outro])).map((b) => [b.inicio, b.fim])).toEqual([
      ["2026-10-10", "2026-10-14"],
      ["2026-10-20", "2026-10-22"],
    ]);
    expect(await blq([dona])).toEqual([]);
  });

  it("imóvel com histórico do dono anterior no livro: o novo dono vê a reserva sem cálculo do período dele", async () => {
    // A dona teve reservas calculadas no 403 (lançamentos dela no livro).
    await criarReserva(db, org, reserva(a, "2026-09-05", "2026-09-08"), null);
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a, criadoEm: new Date("2026-10-10T12:00:00Z") });
    await criarReserva(db, org, reserva(a, "2026-10-20", "2026-10-22", { valorBruto: null, taxaCanal: null }), null);
    expect((await lista([outro], [a])).map((x) => [x.checkin, x.situacao])).toEqual([["2026-10-20", "sem_calculo"]]);
    // A reserva de setembro (calculada para a dona) continua só dela.
    expect((await lista([dona], [a])).map((x) => x.checkin)).toEqual([]);
  });
});
