import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, limpezas, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import type { DadosReserva } from "@/reservas/regras";
import { cancelarReserva, criarReserva, sincronizarReserva } from "@/reservas/repositorio";
import {
  cancelarLimpeza,
  confirmarLimpeza,
  criarLimpezaAvulsa,
  criarProfissional,
  editarProfissional,
  informarCusto,
  listarLimpezas,
  listarProfissionais,
  realizarLimpeza,
  reabrirLimpeza,
  sincronizarLimpezas,
  validarCusto,
} from "./limpezas";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let a: string;
let b: string;
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
  codigoCanal: "X1",
  observacoes: "",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: a }, { id: b }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro" },
      { organizacaoId: org, codigo: "102", nome: "Um" },
    ])
    .returning();
});
afterEach(() => close());

const lista = (hoje = "2026-10-01") => listarLimpezas(db, org, { ...periodo, hoje });
async function profissional(nome = "Maria Fictícia") {
  await criarProfissional(db, org, { nome, telefone: "", observacoes: "" }, null);
  return (await listarProfissionais(db, org)).find((p) => p.nome === nome)!.id;
}

describe("geração no dia do checkout", () => {
  it("reserva confirmada gera limpeza pedida na saída (inclusive fim de semana); pendente não; idempotente", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-17"), null); // 17/10/2026 é sábado
    await criarReserva(db, org, reserva(b, "2026-10-12", "2026-10-14", { estado: "pendente" }), null);
    expect(await sincronizarLimpezas(db, org, periodo)).toEqual({ criadas: 1, atualizadas: 0, canceladas: 0 });
    expect(await sincronizarLimpezas(db, org, periodo)).toEqual({ criadas: 0, atualizadas: 0, canceladas: 0 });
    const [l] = await lista();
    expect(l).toMatchObject({ imovelCodigo: "403", data: "2026-10-17", estado: "pedida", profissional: null });
    expect(await historicoDe(db, org, "limpeza", l.id)).toHaveLength(1);
  });

  it("saída mudou: acompanha e volta a pedida; cancelada: cancela; já realizada: não mexe e avisa", async () => {
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const maria = await profissional();
    let [l] = await lista();
    expect(await confirmarLimpeza(db, org, l.id, maria, null)).toEqual({ ok: true });

    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-16"), null);
    expect((await sincronizarLimpezas(db, org, periodo)).atualizadas).toBe(1);
    [l] = await lista();
    expect(l).toMatchObject({ data: "2026-10-16", estado: "pedida" });

    expect(await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: 12000 }, "2026-10-16", null)).toEqual({ ok: true });
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-18"), null);
    await sincronizarLimpezas(db, org, periodo);
    [l] = await lista();
    expect(l).toMatchObject({ data: "2026-10-16", estado: "realizada", custo: 12000 });
    expect(l.avisos.join(" ")).toContain("mudou para 18/10/2026");
  });

  it("reserva cancelada cancela a limpeza aberta; realizada fica e avisa", async () => {
    const r1 = await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    const r2 = await criarReserva(db, org, reserva(b, "2026-10-10", "2026-10-12"), null);
    if (!r1.ok || !r2.ok) throw new Error("reserva");
    await sincronizarLimpezas(db, org, periodo);
    const maria = await profissional();
    const feita = (await lista()).find((x) => x.imovelCodigo === "102")!;
    await realizarLimpeza(db, org, feita.id, { profissionalId: maria, custo: null }, "2026-10-12", null);
    await cancelarReserva(db, org, r1.reserva.id, null);
    await cancelarReserva(db, org, r2.reserva.id, null);
    expect((await sincronizarLimpezas(db, org, periodo)).canceladas).toBe(1);
    const ls = await lista("2026-10-20");
    expect(ls.find((x) => x.imovelCodigo === "403")?.estado).toBe("cancelada");
    const r = ls.find((x) => x.imovelCodigo === "102")!;
    expect(r.estado).toBe("realizada");
    expect(r.avisos).toEqual(["A reserva foi cancelada depois da limpeza realizada: confira.", "Custo não informado."]);
  });
});

describe("estados e profissional", () => {
  it("confirmar exige profissional ativa; realizar exige quem fez e só a partir do dia", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const [l] = await lista();
    expect(await confirmarLimpeza(db, org, l.id, "nao-uuid", null)).toMatchObject({ ok: false });
    const maria = await profissional();
    await editarProfissional(db, org, maria, { nome: "Maria Fictícia", telefone: "", observacoes: "", ativo: false }, null);
    expect(await confirmarLimpeza(db, org, l.id, maria, null)).toMatchObject({ ok: false, erro: expect.stringContaining("ativa") });
    await editarProfissional(db, org, maria, { nome: "Maria Fictícia", telefone: "", observacoes: "", ativo: true }, null);
    expect(await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: null }, "2026-10-14", null)).toMatchObject({ ok: false, erro: expect.stringContaining("ainda não chegou") });
    expect(await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: -1 }, "2026-10-15", null)).toMatchObject({ ok: false });
    expect(await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: 15000 }, "2026-10-15", null)).toEqual({ ok: true });
    expect(await cancelarLimpeza(db, org, l.id, "engano", null)).toMatchObject({ ok: false });
    expect(await informarCusto(db, org, l.id, 16000, null)).toEqual({ ok: true });
    expect(await reabrirLimpeza(db, org, l.id, null)).toEqual({ ok: true });
    expect((await lista())[0]).toMatchObject({ estado: "confirmada", custo: 16000 });
  });

  it("data passou sem registro vira aviso (não é marcada como feita)", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    expect((await lista("2026-10-20"))[0]).toMatchObject({ estado: "pedida", avisos: ["A data já passou e a limpeza não foi registrada como realizada."] });
  });

  it("avulsa, cancelar com motivo, custo validado e nome de profissional único", async () => {
    expect(await criarLimpezaAvulsa(db, org, { imovelId: a, data: "2026-10-20", observacao: "Antes do uso do dono" }, null)).toEqual({ ok: true });
    const [l] = await lista();
    expect(l).toMatchObject({ reservaId: null, estado: "pedida", observacao: "Antes do uso do dono" });
    expect(await cancelarLimpeza(db, org, l.id, "", null)).toMatchObject({ ok: false });
    expect(await cancelarLimpeza(db, org, l.id, "Dono desistiu", null)).toEqual({ ok: true });
    expect((await lista())[0].observacao).toContain("Cancelada: Dono desistiu");
    expect(validarCusto(null)).toBeNull();
    expect(validarCusto(10_000_001)).not.toBeNull();
    await profissional("Ana");
    expect(await criarProfissional(db, org, { nome: "ana", telefone: "", observacoes: "" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("Já existe") });
  });

  it("outra organização não vê nem mexe", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const [l] = await lista();
    expect(await listarLimpezas(db, outraOrg, { ...periodo, hoje: "2026-10-01" })).toEqual([]);
    expect(await cancelarLimpeza(db, outraOrg, l.id, "x", null)).toMatchObject({ ok: false });
    expect(await criarLimpezaAvulsa(db, outraOrg, { imovelId: a, data: "2026-10-20", observacao: "" }, null)).toMatchObject({ ok: false });
    expect(await listarLimpezas(db, org, { ...periodo, hoje: "2026-10-01", imovelIds: [] })).toEqual([]);
    const [x] = await db.select().from(limpezas).where(eq(limpezas.id, l.id));
    expect(x.estado).toBe("pedida");
  });
});
