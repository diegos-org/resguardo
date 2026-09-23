import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { bloqueios, imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import type { DadosReserva } from "./regras";
import { cancelarReserva, criarReserva, listarBloqueios, listarReservas, obterReserva, sincronizarReserva } from "./repositorio";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outra: string;
let im: string;
let im2: string;

const dados = (over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId: im,
  origem: "airbnb",
  estado: "confirmada",
  checkin: "2026-10-10",
  checkout: "2026-10-13",
  hospedes: 2,
  hospedeNome: "Hóspede Teste",
  hospedeEmail: "hospede@example.com",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 150000,
  taxaCanal: 22500,
  valorLiquido: 127500,
  codigoCanal: "HM123",
  observacoes: "",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  org = a.id;
  outra = b.id;
  const [i1, i2] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "t1", nome: "Um" },
      { organizacaoId: org, codigo: "t2", nome: "Dois" },
    ])
    .returning();
  im = i1.id;
  im2 = i2.id;
});
afterEach(() => close());

describe("reservas", () => {
  it("cria reserva manual com código SCL e histórico sem e-mail por extenso", async () => {
    const r = await criarReserva(db, org, dados(), null);
    expect(r.ok && r.reserva.codigo).toMatch(/^SCL-/);
    const id = r.ok ? r.reserva.id : "";
    const h = await historicoDe(db, org, "reserva", id);
    expect(h[0].acao).toBe("reserva.criar");
    expect(JSON.stringify(h)).not.toContain("hospede@example.com");
  });

  it("sincronização é idempotente e registra só mudanças reais", async () => {
    const r1 = await sincronizarReserva(db, org, "beds24", "555", dados());
    expect(r1.ok && r1.criada).toBe(true);
    const r2 = await sincronizarReserva(db, org, "beds24", "555", dados());
    expect(r2.ok && r2.criada).toBe(false);
    const r3 = await sincronizarReserva(db, org, "beds24", "555", dados({ checkout: "2026-10-14", estado: "cancelada" }));
    expect(r3.ok && r3.reserva.checkout).toBe("2026-10-14");
    expect(r3.ok && r3.reserva.canceladaEm).toBeInstanceOf(Date);
    const id = r1.ok ? r1.reserva.id : "";
    expect((await historicoDe(db, org, "reserva", id)).map((h) => h.acao)).toEqual(["reserva.sincronizar", "reserva.importar"]);
    // o mesmo id em outra fonte é outra reserva
    const r4 = await sincronizarReserva(db, org, "csv", "555", dados());
    expect(r4.ok && r4.reserva.id).not.toBe(id);
  });

  it("sincronizações simultâneas da mesma reserva não duplicam nem falham", async () => {
    const resultados = await Promise.all([1, 2, 3].map(() => sincronizarReserva(db, org, "beds24", "777", dados())));
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(resultados.filter((r) => r.ok && r.criada)).toHaveLength(1);
    expect(await listarReservas(db, org, { inicio: "2026-01-01", fim: "2027-01-01", incluirCanceladas: true })).toHaveLength(1);
  });

  it("reserva reativada pela sincronização perde a data de cancelamento", async () => {
    await sincronizarReserva(db, org, "beds24", "999", dados({ estado: "cancelada" }));
    const r = await sincronizarReserva(db, org, "beds24", "999", dados({ estado: "confirmada" }));
    expect(r.ok && r.reserva.canceladaEm).toBeNull();
  });

  it("reserva que já chega cancelada ganha data de cancelamento", async () => {
    const r = await sincronizarReserva(db, org, "beds24", "888", dados({ estado: "cancelada" }));
    expect(r.ok && r.reserva.canceladaEm).toBeInstanceOf(Date);
  });

  it("lista por período (saída exclusiva), filtra imóveis e esconde canceladas", async () => {
    await criarReserva(db, org, dados({ checkin: "2026-09-28", checkout: "2026-10-01" }), null);
    const dentro = await criarReserva(db, org, dados({ checkin: "2026-10-05", checkout: "2026-10-08" }), null);
    await criarReserva(db, org, dados({ imovelId: im2, checkin: "2026-10-20", checkout: "2026-10-22" }), null);
    const cancelada = await criarReserva(db, org, dados({ checkin: "2026-10-25", checkout: "2026-10-27" }), null);
    await cancelarReserva(db, org, cancelada.ok ? cancelada.reserva.id : "", null);

    const outubro = { inicio: "2026-10-01", fim: "2026-11-01" };
    expect((await listarReservas(db, org, outubro)).map((r) => r.checkin)).toEqual(["2026-10-05", "2026-10-20"]);
    expect((await listarReservas(db, org, { ...outubro, imovelIds: [im] })).map((r) => r.id)).toEqual([dentro.ok ? dentro.reserva.id : ""]);
    expect(await listarReservas(db, org, { ...outubro, incluirCanceladas: true })).toHaveLength(3);
    expect(await listarReservas(db, outra, outubro)).toEqual([]);
  });

  it("isolamento: não cria em imóvel de outra organização nem lê/cancela de fora", async () => {
    expect(await criarReserva(db, outra, dados(), null)).toEqual({ ok: false, erros: { imovelId: "Imóvel não encontrado." } });
    const r = await criarReserva(db, org, dados(), null);
    const id = r.ok ? r.reserva.id : "";
    expect(await obterReserva(db, outra, id)).toBeNull();
    expect(await cancelarReserva(db, outra, id, null)).toBe(false);
    expect(await cancelarReserva(db, org, id, null)).toBe(true);
    expect(await cancelarReserva(db, org, id, null)).toBe(false);
  });

  it("recusa dados inválidos sem gravar", async () => {
    const r = await criarReserva(db, org, dados({ checkout: "2026-10-01" }), null);
    expect(r.ok).toBe(false);
    expect(await listarReservas(db, org, { inicio: "2026-01-01", fim: "2027-01-01", incluirCanceladas: true })).toEqual([]);
  });

  it("bloqueios por período", async () => {
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-10-01", fim: "2026-10-03", motivo: "manutenção" });
    expect(await listarBloqueios(db, org, { inicio: "2026-10-02", fim: "2026-10-05" })).toHaveLength(1);
    expect(await listarBloqueios(db, org, { inicio: "2026-10-03", fim: "2026-10-05" })).toHaveLength(0);
  });
});
